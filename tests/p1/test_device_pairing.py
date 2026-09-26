"""Synthetic tokens only; exercise the actual aiohttp authentication middleware/routes."""
import asyncio
import json
import secrets
import sqlite3


import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer

from hermes_app import adapter, device_pairing
from hermes_app.storage import Store


ADMIN = 'synthetic-admin-bootstrap-token-32-characters-only'
ADMIN_HEADER = {'Authorization': 'Bearer ' + ADMIN}


def _token():
    return 'ha_dev_' + secrets.token_hex(12) + '_' + secrets.token_urlsafe(32)


def _body(code, token=None, name='Phone'):
    return {'code': code, 'device_name': name, 'device_token': token or _token()}


def _app(tmp_path):
    store = Store(tmp_path / 'metadata.sqlite')
    pairing = device_pairing.PairingStore(store.path)
    owner = object.__new__(adapter.HermesAppAdapter)
    owner._store = store
    owner._pairing = pairing
    owner._sockets = set()
    owner._events_changed = asyncio.Event()
    owner._stopping = False
    owner._reconcile_interactions = lambda: None
    app = web.Application(middlewares=[adapter._authentication])
    app['pairing'] = pairing
    app.router.add_post('/v1/pairing/grants', device_pairing.issue)
    app.router.add_post('/v1/pairing/exchange', device_pairing.exchange)
    app.router.add_get('/v1/pairing/devices', device_pairing.devices)
    app.router.add_delete('/v1/pairing/devices/{id}', device_pairing.revoke)
    app.router.add_get('/v1/capabilities', owner._capabilities)
    app.router.add_get('/v1/threads/{id}/messages', owner._history)
    app.router.add_get('/v1/events', owner._ws)
    return app, pairing


def _run(coro):
    asyncio.run(coro)


def test_exchange_authorization_persistence_and_revocation(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            assert (await client.get('/v1/capabilities')).status == 401
            assert (await client.get('/v1/threads/private/messages')).status == 401
            assert (await client.get('/v1/threads/private/messages', headers={
                'Authorization': 'Bearer wrong'})).status == 401
            assert (await client.get('/v1/pairing/exchange')).status == 401
            assert (await client.post('/v1/pairing/grants', json={})).status == 401
            assert (await client.get('/v1/pairing/devices')).status == 401
            assert (await client.post('/v1/pairing/grants', json={},
                                      headers={'Authorization': 'Bearer wrong'})).status == 403
            assert (await client.post('/v1/pairing/exchange?code=leak',
                                      json=_body('x'))).status == 400
            assert (await client.post('/v1/pairing/exchange',
                                      json=_body('x'),
                                      headers=ADMIN_HEADER)).status == 400
            issued = await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)
            assert issued.status == 201 and issued.headers['Cache-Control'] == 'no-store'
            grant = await issued.json()
            assert set(grant) == {'code', 'expires_at'}
            code = grant['code']
            assert len(code) == 19  # 80 random bits, four groups of four base32 chars.
            wrong = code[:-1] + ('A' if code[-1] != 'A' else 'B')
            credential = _token()
            assert (await client.post('/v1/pairing/exchange', json=_body(wrong, credential))).status == 400
            assert (await client.get('/v1/capabilities')).status == 401
            response = await client.post('/v1/pairing/exchange', json=_body(code, credential))
            assert response.status == 201 and response.headers['Cache-Control'] == 'no-store'
            device = await response.json()
            assert device == {'device_id': credential[7:31]}
            headers = {'Authorization': 'Bearer ' + credential}
            assert (await client.get('/v1/capabilities', headers=headers)).status == 200
            assert (await client.get('/v1/threads/private/messages', headers=headers)).status == 404
            changed = 'A' if credential[-1] != 'A' else 'B'
            assert (await client.get('/v1/capabilities', headers={
                'Authorization': 'Bearer ' + credential[:-1] + changed})).status == 401
            assert (await client.post('/v1/pairing/grants', json={}, headers=headers)).status == 403
            assert (await client.get('/v1/pairing/devices', headers=headers)).status == 403
            assert (await client.delete('/v1/pairing/devices/' + device['device_id'],
                                        headers=headers)).status == 403
            assert (await client.post('/v1/pairing/exchange', json=_body(code, name='Another'))).status == 400
            with sqlite3.connect(pairing.path) as db:
                encoded = ' '.join(str(row) for table in ('pairing_grants', 'paired_devices')
                                   for row in db.execute('SELECT * FROM ' + table))
                assert code not in encoded and credential not in encoded
                assert db.execute('SELECT COUNT(*) FROM pairing_grants').fetchone()[0] == 1
                assert db.execute('SELECT device_id,credential_digest FROM pairing_grants').fetchone() == (
                    device['device_id'], device_pairing._digest(credential))
            # New store object models process restart, using exactly the same file.
            restarted = device_pairing.PairingStore(pairing.path)
            assert restarted.authenticated_device(credential) == device['device_id']
            assert (await client.get('/v1/capabilities', headers=headers)).status == 200
            # Fresh app/store against the persisted DB, not the old in-memory owner.
            restart_app, _ = _app(tmp_path)
            async with TestClient(TestServer(restart_app)) as fresh:
                assert (await fresh.get('/v1/capabilities', headers=headers)).status == 200
                assert (await fresh.get('/v1/pairing/devices', headers=ADMIN_HEADER)).status == 200
            listing = await client.get('/v1/pairing/devices', headers=ADMIN_HEADER)
            listed = (await listing.json())['devices']
            assert len(listed) == 1 and listed[0]['device_id'] == device['device_id']
            assert listed[0]['device_name'] == 'Phone' and isinstance(listed[0]['created_at'], int)
            assert (await client.delete('/v1/pairing/devices/' + device['device_id'],
                                        headers=ADMIN_HEADER)).status == 204
            assert (await client.get('/v1/capabilities', headers=headers)).status == 401
            assert (await client.post('/v1/pairing/exchange', json=_body(code, credential))).status == 400
            assert (await client.get('/v1/threads/private/messages', headers=headers)).status == 401
            assert restarted.authenticated_device(credential) is None
            assert (await client.delete('/v1/pairing/devices/' + device['device_id'],
                                        headers=ADMIN_HEADER)).status == 404
            assert (await client.get('/v1/capabilities', headers=ADMIN_HEADER)).status == 200
    _run(check())


def test_expiry_validation_limits_and_concurrent_duplicates(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)
    clock = [1000000]
    monkeypatch.setattr(device_pairing.time, 'time', lambda: clock[0])

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            for payload in ({'code': 'x'}, dict(_body('x'), owner='other'),
                            _body('x', name='\n'), _body('x' * 4000),
                            _body('x', 'ha_dev_' + 'a' * 24 + '_' + 'A' * 42 + 'B'),
                            _body('x', 'ha_dev_' + 'a' * 24 + '_' + 'x' * 43)):
                assert (await client.post('/v1/pairing/exchange', json=payload)).status in (400, 413)
            assert (await client.post('/v1/pairing/exchange', data=b'x' * 513,
                                      headers={'Content-Type': 'application/json'})).status == 413
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            clock[0] += 300
            assert (await client.post('/v1/pairing/exchange', json=_body(grant['code']))).status == 400
            clock[0] += 3600  # Reset the durable request limiter.
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            body = _body(grant['code'])
            first, second = await asyncio.gather(
                client.post('/v1/pairing/exchange', json=body),
                client.post('/v1/pairing/exchange', json=body))
            assert [first.status, second.status] == [201, 201]
            assert await first.json() == await second.json() == {'device_id': body['device_token'][7:31]}
            assert len(pairing.list_devices()['devices']) == 1
            # Invalid-code attempts consume a durable global quota even after restart.
            for _ in range(28):
                assert (await client.post('/v1/pairing/exchange', json=_body(
                    'AAAA-AAAA-AAAA-AAAA'))).status == 400
            restarted = device_pairing.PairingStore(pairing.path)
            with restarted._db() as db:
                assert db.execute('SELECT minute_count FROM pairing_rate').fetchone()[0] == 30
            limited = await client.post('/v1/pairing/exchange', json=_body('AAAA-AAAA-AAAA-AAAA'))
            assert limited.status == 429 and int(limited.headers['Retry-After']) > 0
            clock[0] += 60
            assert (await client.post('/v1/pairing/exchange', json=_body(
                'AAAA-AAAA-AAAA-AAAA'))).status == 400
            for _ in range(20):
                assert (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).status == 201
            limited = await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)
            assert limited.status == 429 and int(limited.headers['Retry-After']) > 0
    _run(check())


def test_lost_response_retry_different_token_expiry_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)
    clock = [1000000]
    monkeypatch.setattr(device_pairing.time, 'time', lambda: clock[0])

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            token = _token()  # Candidate persisted by mobile before POST.
            body = _body(grant['code'], token)
            lost = await client.post('/v1/pairing/exchange', json=body)
            assert lost.status == 201
            await lost.release()  # Simulate losing the response without observing its body.
            clock[0] += 60
            assert (await client.post('/v1/pairing/exchange', json=_body(
                grant['code'], _token()))).status == 400
            restart_app, restarted = _app(tmp_path)
            async with TestClient(TestServer(restart_app)) as fresh:
                response = await fresh.post('/v1/pairing/exchange', json=_body(
                    grant['code'], token, 'Different name'))
                assert response.status == 201 and await response.json() == {'device_id': token[7:31]}
                assert len(restarted.list_devices()['devices']) == 1
                original_expiry = grant['expires_at']
                with restarted._db() as db:
                    assert db.execute('SELECT expires_at FROM pairing_grants WHERE digest=?',
                                      (device_pairing._digest(grant['code']),)).fetchone()[0] == original_expiry
                clock[0] = original_expiry
                assert (await fresh.post('/v1/pairing/exchange', json=body)).status == 400
                # A response lost past expiry is recoverable from saved candidate auth.
                assert (await fresh.get('/v1/capabilities', headers={
                    'Authorization': 'Bearer ' + token})).status == 200
            assert len(pairing.list_devices()['devices']) == 1
    _run(check())


def test_concurrent_distinct_credentials_only_one_binds(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            code = (await (await client.post('/v1/pairing/grants', json={},
                                             headers=ADMIN_HEADER)).json())['code']
            tokens = [_token(), _token()]
            responses = await asyncio.gather(*(client.post('/v1/pairing/exchange',
                                                           json=_body(code, token)) for token in tokens))
            assert sorted(response.status for response in responses) == [201, 400]
            winner = tokens[[response.status for response in responses].index(201)]
            loser = tokens[[response.status for response in responses].index(400)]
            assert pairing.authenticated_device(winner) == winner[7:31]
            assert pairing.authenticated_device(loser) is None
            assert len(pairing.list_devices()['devices']) == 1
            assert (await client.post('/v1/pairing/exchange', json=_body(code, loser))).status == 400
    _run(check())


def test_additive_migration_and_bounded_expired_cleanup(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)
    clock = [1000000]
    monkeypatch.setattr(device_pairing.time, 'time', lambda: clock[0])
    path = tmp_path / 'metadata.sqlite'
    legacy_code = 'AAAA-BBBB-CCCC-DDDD'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE pairing_grants (digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)')
        db.execute('INSERT INTO pairing_grants VALUES (?,?)',
                   (device_pairing._digest(legacy_code), clock[0] + 300))
        for n in range(230):
            db.execute('INSERT INTO pairing_grants VALUES (?,?)',
                       (device_pairing._digest(f'expired-{n}'), clock[0] - 1))
    pairing = device_pairing.PairingStore(path)
    token = _token()
    assert pairing.exchange(legacy_code, 'Migrated', token) == {'device_id': token[7:31]}
    assert pairing.authenticated_device(token) == token[7:31]
    with pairing._db() as db:
        assert db.execute('SELECT COUNT(*) FROM pairing_grants WHERE expires_at<=?',
                          (clock[0],)).fetchone()[0] == 130
    device_pairing.PairingStore(path)  # Migration is repeatable after restart.
    assert pairing.issue()['code']
    with pairing._db() as db:
        assert db.execute('SELECT COUNT(*) FROM pairing_grants WHERE expires_at<=?',
                          (clock[0],)).fetchone()[0] == 30


def test_chunked_pairing_body_reads_to_eof_and_times_out(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)

    async def chunks(*parts):
        for part in parts:
            yield part
            await asyncio.sleep(0.01)

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            token = _token()
            valid = json.dumps(_body(grant['code'], token)).encode()
            headers = {'Content-Type': 'application/json'}
            # A partial valid prefix is not a complete request; trailing bytes matter.
            invalid = await client.post('/v1/pairing/exchange', data=chunks(valid, b'{}'), headers=headers)
            assert invalid.status == 400 and pairing.authenticated_device(token) is None
            oversized = await client.post('/v1/pairing/exchange',
                                          data=chunks(valid, b' ' * (513 - len(valid))), headers=headers)
            assert oversized.status == 413 and pairing.authenticated_device(token) is None
            accepted = await client.post('/v1/pairing/exchange',
                                         data=chunks(valid[:9], valid[9:]), headers=headers)
            assert accepted.status == 201 and await accepted.json() == {'device_id': token[7:31]}

            monkeypatch.setattr(device_pairing, '_BODY_TIMEOUT', 0.05)

            async def stalled():
                yield b'{'
                await asyncio.sleep(0.15)
                yield b'}'

            slow = await client.post('/v1/pairing/exchange', data=stalled(), headers=headers)
            assert slow.status == 408
    _run(check())


def test_revocation_closes_existing_device_socket(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)

    async def check():
        app, _ = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            code = (await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json())['code']
            token = _token()
            device = await (await client.post('/v1/pairing/exchange', json=_body(code, token))).json()
            headers = {'Authorization': 'Bearer ' + token}
            socket = await client.ws_connect('/v1/events', headers=headers)
            assert (await socket.receive_json())['type'] == 'hello'
            assert (await client.delete('/v1/pairing/devices/' + device['device_id'],
                                        headers=ADMIN_HEADER)).status == 204
            message = await socket.receive(timeout=8)
            assert message.type in (WSMsgType.CLOSE, WSMsgType.CLOSED)
            assert socket.close_code == 1008
            with pytest.raises(Exception):
                await client.ws_connect('/v1/events', headers=headers)
    _run(check())
