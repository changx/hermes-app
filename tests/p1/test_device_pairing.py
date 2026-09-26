"""Synthetic tokens only; exercise the actual aiohttp authentication middleware/routes."""
import asyncio
import sqlite3


import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer

from hermes_app import adapter, device_pairing
from hermes_app.storage import Store


ADMIN = 'synthetic-admin-bootstrap-token-32-characters-only'
ADMIN_HEADER = {'Authorization': 'Bearer ' + ADMIN}


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
                                      json={'code': 'x', 'device_name': 'Phone'})).status == 400
            assert (await client.post('/v1/pairing/exchange',
                                      json={'code': 'x', 'device_name': 'Phone'},
                                      headers=ADMIN_HEADER)).status == 400
            issued = await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)
            assert issued.status == 201 and issued.headers['Cache-Control'] == 'no-store'
            grant = await issued.json()
            assert set(grant) == {'code', 'expires_at'}
            code = grant['code']
            assert len(code) == 19  # 80 random bits, four groups of four base32 chars.
            wrong = code[:-1] + ('A' if code[-1] != 'A' else 'B')
            assert (await client.post('/v1/pairing/exchange', json={
                'code': wrong, 'device_name': 'Phone'})).status == 400
            assert (await client.get('/v1/capabilities')).status == 401
            response = await client.post('/v1/pairing/exchange', json={
                'code': code, 'device_name': 'Phone'})
            assert response.status == 201 and response.headers['Cache-Control'] == 'no-store'
            device = await response.json()
            assert set(device) == {'device_id', 'device_token'}
            credential = device['device_token']
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
            assert (await client.post('/v1/pairing/exchange', json={
                'code': code, 'device_name': 'Another'})).status == 400
            with sqlite3.connect(pairing.path) as db:
                encoded = ' '.join(str(row) for table in ('pairing_grants', 'paired_devices')
                                   for row in db.execute('SELECT * FROM ' + table))
                assert code not in encoded and credential not in encoded
                assert db.execute('SELECT COUNT(*) FROM pairing_grants').fetchone()[0] == 0
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
            assert (await client.get('/v1/threads/private/messages', headers=headers)).status == 401
            assert restarted.authenticated_device(credential) is None
            assert (await client.delete('/v1/pairing/devices/' + device['device_id'],
                                        headers=ADMIN_HEADER)).status == 404
            assert (await client.get('/v1/capabilities', headers=ADMIN_HEADER)).status == 200
    _run(check())


def test_expiry_validation_limits_and_single_winner(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)
    clock = [1000000]
    monkeypatch.setattr(device_pairing.time, 'time', lambda: clock[0])

    async def check():
        app, pairing = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            for payload in ({'code': 'x'}, {'code': 'x', 'device_name': 'Phone', 'owner': 'other'},
                            {'code': 'x', 'device_name': '\n'},
                            {'code': 'x' * 4000, 'device_name': 'Phone'}):
                assert (await client.post('/v1/pairing/exchange', json=payload)).status in (400, 413)
            assert (await client.post('/v1/pairing/exchange', data=b'x' * 513,
                                      headers={'Content-Type': 'application/json'})).status == 413
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            clock[0] += 300
            assert (await client.post('/v1/pairing/exchange', json={
                'code': grant['code'], 'device_name': 'Phone'})).status == 400
            clock[0] += 3600  # Reset the durable request limiter.
            grant = await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json()
            body = {'code': grant['code'], 'device_name': 'Phone'}
            first, second = await asyncio.gather(
                client.post('/v1/pairing/exchange', json=body),
                client.post('/v1/pairing/exchange', json=body))
            assert sorted([first.status, second.status]) == [201, 400]
            assert len(pairing.list_devices()['devices']) == 1
            # Invalid-code attempts consume a durable global quota even after restart.
            for _ in range(28):
                assert (await client.post('/v1/pairing/exchange', json={
                    'code': 'AAAA-AAAA-AAAA-AAAA', 'device_name': 'Phone'})).status == 400
            restarted = device_pairing.PairingStore(pairing.path)
            with restarted._db() as db:
                assert db.execute('SELECT minute_count FROM pairing_rate').fetchone()[0] == 30
            assert (await client.post('/v1/pairing/exchange', json={
                'code': 'AAAA-AAAA-AAAA-AAAA', 'device_name': 'Phone'})).status == 429
            clock[0] += 60
            assert (await client.post('/v1/pairing/exchange', json={
                'code': 'AAAA-AAAA-AAAA-AAAA', 'device_name': 'Phone'})).status == 400
            for _ in range(20):
                assert (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).status == 201
            assert (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).status == 429
    _run(check())


def test_revocation_closes_existing_device_socket(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_APP_TOKEN', ADMIN)

    async def check():
        app, _ = _app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            code = (await (await client.post('/v1/pairing/grants', json={}, headers=ADMIN_HEADER)).json())['code']
            device = await (await client.post('/v1/pairing/exchange', json={
                'code': code, 'device_name': 'Phone'})).json()
            headers = {'Authorization': 'Bearer ' + device['device_token']}
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
