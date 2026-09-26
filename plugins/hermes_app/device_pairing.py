"""Local owner-authorized pairing grants and revocable device credentials.

Only digests of grants and credentials persist in the plugin metadata database.
No core account/session/token service is involved.
"""
import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from contextlib import closing, contextmanager
from pathlib import Path

from aiohttp import web


_CODE = re.compile(r'[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}\Z')
_TOKEN = re.compile(r'ha_dev_([0-9a-f]{24})_([A-Za-z0-9_-]{43})\Z')
_ID = re.compile(r'[0-9a-f]{24}\Z')
_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
_MAX_ACTIVE_GRANTS = 20
_MAX_DEVICES = 100
_BODY_TIMEOUT = 5


def _digest(value):
    return hashlib.sha256(value.encode('ascii')).hexdigest()


def _name(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 64
            or len(value.encode('utf-8')) > 128
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in value)):
        raise web.HTTPBadRequest(text='invalid device_name')
    return value


async def _json(request, keys):
    if request.content_type != 'application/json':
        raise web.HTTPBadRequest(text='JSON object required')
    if request.content_length is not None and request.content_length > 512:
        raise web.HTTPRequestEntityTooLarge(max_size=512, actual_size=request.content_length)
    # read(n) may return fewer than n bytes for a chunked/slow stream. Require
    # EOF, under one absolute deadline, before parsing even a valid JSON prefix.
    try:
        raw = bytearray()
        async with asyncio.timeout(_BODY_TIMEOUT):
            while chunk := await request.content.read(513 - len(raw)):
                raw.extend(chunk)
                if len(raw) > 512:
                    raise web.HTTPRequestEntityTooLarge(max_size=512, actual_size=len(raw))
        data = json.loads(raw)
    except TimeoutError:
        raise web.HTTPRequestTimeout(text='pairing body timed out') from None
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text='JSON object required') from None
    if not isinstance(data, dict) or set(data) != set(keys):
        raise web.HTTPBadRequest(text='invalid pairing fields')
    return data


def _credential(token):
    if not isinstance(token, str) or not (match := _TOKEN.fullmatch(token)):
        raise web.HTTPBadRequest(text='invalid device_token')
    # 32 bytes have 43 unpadded base64url characters; require canonical form.
    try:
        secret = base64.urlsafe_b64decode(match[2] + '=')
    except (ValueError, binascii.Error):
        raise web.HTTPBadRequest(text='invalid device_token') from None
    if len(secret) != 32 or base64.urlsafe_b64encode(secret).decode('ascii').rstrip('=') != match[2]:
        raise web.HTTPBadRequest(text='invalid device_token')
    return match[1], _digest(token)


class PairingStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS pairing_grants (
                    digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS paired_devices (
                    id TEXT PRIMARY KEY, credential_digest TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS pairing_rate (
                    id INTEGER PRIMARY KEY CHECK (id=1), minute INTEGER NOT NULL,
                    minute_count INTEGER NOT NULL, hour INTEGER NOT NULL,
                    hour_count INTEGER NOT NULL);
            ''')
            # Existing installs have the original two-column grant table. Keep
            # migrations additive; legacy unconsumed grants remain redeemable.
            db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(pairing_grants)')}
            if 'device_id' not in columns:
                db.execute('ALTER TABLE pairing_grants ADD COLUMN device_id TEXT')
            if 'credential_digest' not in columns:
                db.execute('ALTER TABLE pairing_grants ADD COLUMN credential_digest TEXT')
            db.execute('CREATE INDEX IF NOT EXISTS pairing_grants_expiry ON pairing_grants(expires_at)')

    @contextmanager
    def _db(self):
        # sqlite3 connection context commits/rolls back; closing also releases it.
        with closing(sqlite3.connect(self.path, timeout=10)) as db:
            db.row_factory = sqlite3.Row
            with db:
                yield db

    @staticmethod
    def _cleanup(db, now):
        # One small indexed batch per request; expired rows are never usable even
        # when a backlog remains. Never extend a grant's original expiry.
        db.execute('DELETE FROM pairing_grants WHERE digest IN '
                   '(SELECT digest FROM pairing_grants WHERE expires_at<=? LIMIT 100)', (now,))

    def issue(self):
        code = '-'.join(''.join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4))
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())
            expires_at = now + 300
            self._cleanup(db, now)
            active = db.execute('SELECT COUNT(*) FROM pairing_grants WHERE expires_at>? AND device_id IS NULL',
                                (now,)).fetchone()[0]
            if active >= _MAX_ACTIVE_GRANTS:
                earliest = db.execute('SELECT MIN(expires_at) FROM pairing_grants '
                                      'WHERE expires_at>? AND device_id IS NULL', (now,)).fetchone()[0]
                raise web.HTTPTooManyRequests(text='too many active grants',
                                              headers={'Retry-After': str(max(1, earliest - now))})
            db.execute('INSERT INTO pairing_grants(digest,expires_at) VALUES (?,?)',
                       (_digest(code), expires_at))
        return {'code': code, 'expires_at': expires_at}

    def exchange(self, code, name, token):
        # A global durable limiter also bounds random wrong codes and database work,
        # including across restarts. Deployment is loopback-only, with a trusted
        # reverse proxy expected to limit public ingress independently.
        valid = isinstance(code, str) and _CODE.fullmatch(code.upper())
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())
            minute, hour = now // 60, now // 3600
            db.execute('INSERT OR IGNORE INTO pairing_rate VALUES (1, ?, 0, ?, 0)', (minute, hour))
            db.execute('UPDATE pairing_rate SET minute_count=CASE WHEN minute=? THEN MIN(minute_count+1,31) ELSE 1 END, '
                       'minute=?, hour_count=CASE WHEN hour=? THEN MIN(hour_count+1,301) ELSE 1 END, hour=? '
                       'WHERE id=1', (minute, minute, hour, hour))
            counts = db.execute('SELECT minute_count,hour_count FROM pairing_rate WHERE id=1').fetchone()
            # Count rejected requests as well; these changes must commit before raising.
            limited = counts['minute_count'] > 30 or counts['hour_count'] > 300
        if limited:
            retry = max((60 - now % 60 if counts['minute_count'] > 30 else 0),
                        (3600 - now % 3600 if counts['hour_count'] > 300 else 0))
            raise web.HTTPTooManyRequests(text='pairing temporarily limited',
                                          headers={'Retry-After': str(retry)})
        device_id, credential_digest = _credential(token)
        if not valid:
            raise web.HTTPBadRequest(text='invalid or expired pairing code')
        digest = _digest(code.upper())
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())  # Check expiry after acquiring the consume lock.
            self._cleanup(db, now)
            row = db.execute('SELECT expires_at,device_id,credential_digest FROM pairing_grants WHERE digest=?',
                             (digest,)).fetchone()
            if row is None or row['expires_at'] <= now:
                raise web.HTTPBadRequest(text='invalid or expired pairing code')
            if row['device_id'] is not None:
                # Revocation deletes the active device but leaves this binding
                # until expiry; a replay must never resurrect a revoked token.
                existing = db.execute('SELECT credential_digest FROM paired_devices WHERE id=?',
                                      (row['device_id'],)).fetchone()
                if (row['device_id'] != device_id or row['credential_digest'] != credential_digest
                        or existing is None or existing['credential_digest'] != credential_digest):
                    raise web.HTTPBadRequest(text='invalid or expired pairing code')
                return {'device_id': device_id}
            # A valid grant is consumed in the same transaction as device creation.
            # Device cap failures leave the grant available until it expires.
            if db.execute('SELECT COUNT(*) FROM paired_devices').fetchone()[0] >= _MAX_DEVICES:
                raise web.HTTPTooManyRequests(text='device limit reached', headers={'Retry-After': '60'})
            if db.execute('SELECT 1 FROM paired_devices WHERE id=? OR credential_digest=?',
                          (device_id, credential_digest)).fetchone():
                raise web.HTTPBadRequest(text='device credential already registered')
            db.execute('INSERT INTO paired_devices(id,credential_digest,name,created_at) VALUES (?,?,?,?)',
                       (device_id, credential_digest, name, now))
            db.execute('UPDATE pairing_grants SET device_id=?,credential_digest=? WHERE digest=?',
                       (device_id, credential_digest, digest))
        return {'device_id': device_id}

    def authenticated_device(self, token):
        if not isinstance(token, str):
            return None
        try:
            device_id, digest = _credential(token)
        except web.HTTPBadRequest:
            return None
        with self._db() as db:
            row = db.execute('SELECT credential_digest FROM paired_devices WHERE id=?',
                             (device_id,)).fetchone()
        return device_id if row and hmac.compare_digest(row['credential_digest'], digest) else None

    def list_devices(self):
        with self._db() as db:
            return {'devices': [dict(row) for row in db.execute(
                'SELECT id AS device_id,name AS device_name,created_at FROM paired_devices ORDER BY created_at,id')]}

    def revoke(self, device_id):
        if not _ID.fullmatch(device_id):
            raise web.HTTPNotFound()
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute('DELETE FROM paired_devices WHERE id=?', (device_id,)).rowcount
        if not changed:
            raise web.HTTPNotFound()


async def issue(request):
    await _json(request, ())
    result = await asyncio.to_thread(request.app['pairing'].issue)
    return web.json_response(result, status=201, headers={'Cache-Control': 'no-store'})


async def exchange(request):
    body = await _json(request, ('code', 'device_name', 'device_token'))
    name = _name(body['device_name'])
    result = await asyncio.to_thread(request.app['pairing'].exchange, body['code'], name,
                                     body['device_token'])
    return web.json_response(result, status=201, headers={'Cache-Control': 'no-store'})


async def devices(request):
    result = await asyncio.to_thread(request.app['pairing'].list_devices)
    return web.json_response(result, headers={'Cache-Control': 'no-store'})


async def revoke(request):
    await asyncio.to_thread(request.app['pairing'].revoke, request.match_info['id'])
    return web.Response(status=204, headers={'Cache-Control': 'no-store'})
