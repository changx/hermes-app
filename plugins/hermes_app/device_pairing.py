"""Local owner-authorized, one-use pairing grants and revocable device credentials.

Only digests of grants and credentials persist in the plugin metadata database.
No core account/session/token service is involved.
"""
import asyncio
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
    # Bound streamed/chunked bodies too; avoid echoing any secrets in errors.
    try:
        raw = await request.content.read(513)
        if len(raw) > 512:
            raise web.HTTPRequestEntityTooLarge(max_size=512, actual_size=len(raw))
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text='JSON object required') from None
    if not isinstance(data, dict) or set(data) != set(keys):
        raise web.HTTPBadRequest(text='invalid pairing fields')
    return data


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

    @contextmanager
    def _db(self):
        # sqlite3 connection context commits/rolls back; closing also releases it.
        with closing(sqlite3.connect(self.path, timeout=10)) as db:
            db.row_factory = sqlite3.Row
            with db:
                yield db

    def issue(self):
        code = '-'.join(''.join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4))
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())
            expires_at = now + 300
            db.execute('DELETE FROM pairing_grants WHERE expires_at<=?', (now,))
            if db.execute('SELECT COUNT(*) FROM pairing_grants').fetchone()[0] >= _MAX_ACTIVE_GRANTS:
                raise web.HTTPTooManyRequests(text='too many active grants')
            db.execute('INSERT INTO pairing_grants(digest,expires_at) VALUES (?,?)',
                       (_digest(code), expires_at))
        return {'code': code, 'expires_at': expires_at}

    def exchange(self, code, name):
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
            raise web.HTTPTooManyRequests(text='pairing temporarily limited')
        if not valid:
            raise web.HTTPBadRequest(text='invalid or expired pairing code')
        digest = _digest(code.upper())
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())  # Check expiry after acquiring the consume lock.
            row = db.execute('SELECT expires_at FROM pairing_grants WHERE digest=?',
                             (digest,)).fetchone()
            if row is None or row['expires_at'] <= now:
                raise web.HTTPBadRequest(text='invalid or expired pairing code')
            # A valid grant is consumed in the same transaction as device creation.
            # Device cap failures leave the grant available until it expires.
            if db.execute('SELECT COUNT(*) FROM paired_devices').fetchone()[0] >= _MAX_DEVICES:
                raise web.HTTPTooManyRequests(text='device limit reached')
            device_id = secrets.token_hex(12)
            token = 'ha_dev_' + device_id + '_' + secrets.token_urlsafe(32)
            db.execute('INSERT INTO paired_devices(id,credential_digest,name,created_at) VALUES (?,?,?,?)',
                       (device_id, _digest(token), name, now))
            db.execute('DELETE FROM pairing_grants WHERE digest=?', (digest,))
        return {'device_id': device_id, 'device_token': token}

    def authenticated_device(self, token):
        if not isinstance(token, str):
            return None
        match = _TOKEN.fullmatch(token)
        if match is None:
            return None
        with self._db() as db:
            row = db.execute('SELECT credential_digest FROM paired_devices WHERE id=?',
                             (match[1],)).fetchone()
        return match[1] if row and hmac.compare_digest(row['credential_digest'], _digest(token)) else None

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
    body = await _json(request, ('code', 'device_name'))
    name = _name(body['device_name'])
    result = await asyncio.to_thread(request.app['pairing'].exchange, body['code'], name)
    return web.json_response(result, status=201, headers={'Cache-Control': 'no-store'})


async def devices(request):
    result = await asyncio.to_thread(request.app['pairing'].list_devices)
    return web.json_response(result, headers={'Cache-Control': 'no-store'})


async def revoke(request):
    await asyncio.to_thread(request.app['pairing'].revoke, request.match_info['id'])
    return web.Response(status=204, headers={'Cache-Control': 'no-store'})
