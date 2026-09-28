"""Model default API: real aiohttp auth, native context/switch/persistence, isolated config."""
import asyncio
import logging
import time

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import pytest

from hermes_app import adapter, model_settings
from hermes_cli import inventory, model_switch
from hermes_cli.config import read_user_config_raw
from hermes_cli import model_selection_guards
from hermes_cli import models_validate
from types import SimpleNamespace
from gateway.run import GatewayRunner, _load_gateway_config

TOKEN = 'synthetic-model-settings-admin-token-32-characters'
HEADERS = {'Authorization': 'Bearer ' + TOKEN}
CHOICE = {'scope': 'connected-default', 'provider': 'custom:acme', 'model': 'vendor/model:1'}


def _app():
    owner = object.__new__(adapter.HermesAppAdapter)
    # Use the fixed core's real standalone callback wrapper and runner lock, not a
    # hand-built closure that could hide an adapter/runner integration mismatch.
    runner = object.__new__(GatewayRunner)
    runner.config = SimpleNamespace(multiplex_profiles=False)
    runner._startup_restore_in_progress = False
    owner.set_message_handler(runner._primary_message_handler())
    assert owner._model_owner() is runner
    app = web.Application(middlewares=[adapter._authentication])
    app.router.add_get('/v1/agent/model/options', owner._model_options)
    app.router.add_put('/v1/agent/model', owner._model_selection)
    return app


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    home = tmp_path / 'isolated-hermes-home'
    home.mkdir()
    config = home / 'config.yaml'
    config.write_text('''model:
  provider: custom:acme
  default: old/model
  base_url: http://127.0.0.1:1/v1
  model_slots: 3
custom_providers:
  - name: acme
    base_url: http://127.0.0.1:1/v1
    api_key: synthetic-test-key
    models: [old/model, 'vendor/model:1']
''')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('HERMES_APP_TOKEN', TOKEN)
    monkeypatch.setattr(adapter, 'get_hermes_home', lambda: home)
    monkeypatch.setattr(model_settings, 'get_hermes_home', lambda: home)
    # Native inventory still loads the config; only the network/catalog listing is substituted.
    def listing(ctx, *, explicit_only, include_unconfigured, refresh):
        assert (explicit_only, include_unconfigured, refresh) == (True, False, False)
        return {'providers': [
            {'slug': 'acme', 'name': 'Acme', 'is_user_defined': True,
             'aliases': ['custom:acme'], 'authenticated': True,
             'models': ['old/model', 'vendor/model:1'],
             'api_url': 'http://synthetic-secret:password@127.0.0.1:1/v1',
             'api_key': 'synthetic-secret', 'key_env': 'SYNTHETIC_SECRET'},
            {'slug': 'broken', 'name': 'http://synthetic-secret@bad.local',
             'authenticated': False, 'models': ['bad/model']}],
            'provider': ctx.current_provider, 'model': ctx.current_model}
    monkeypatch.setattr(inventory, 'build_model_options_payload', listing)
    # Native resolver uses configured custom provider, but no endpoint/probe is contacted.
    monkeypatch.setattr(models_validate, 'validate_requested_model',
                        lambda *args, **kwargs: {'accepted': True, 'persist': True, 'recognized': True})
    # switch_model's metadata enrichment opts into live models.dev even when the
    # catalog is cached. Stub only those remote lookups, not native switching.
    monkeypatch.setattr(model_switch, 'get_model_capabilities', lambda *a, **k: None)
    monkeypatch.setattr(model_switch, 'get_model_info', lambda *a, **k: None)
    monkeypatch.setattr(model_settings, '_model_switch_skew_guard', lambda: None)
    # Exercise the native combined registry with its real data-policy rule; omit the
    # network-dependent pricing guard from this strictly offline test.
    monkeypatch.setattr(model_selection_guards, '_GUARDS',
                        (model_selection_guards._data_policy_guard,))
    return config


def _run(coro):
    return asyncio.run(coro)


def test_authenticated_inventory_native_write_readback(isolated):
    async def check():
        async with TestClient(TestServer(_app())) as client:
            assert (await client.get('/v1/agent/model/options')).status == 401
            assert (await client.put('/v1/agent/model', json=CHOICE)).status == 401
            response = await client.get('/v1/agent/model/options', headers=HEADERS)
            assert response.status == 200 and response.headers['Cache-Control'] == 'no-store'
            assert await response.json() == {'scope': 'connected-default', 'provider': 'custom:acme',
                'model': 'old/model', 'providers': [{'id': 'custom:acme', 'name': 'Acme',
                                                    'models': ['old/model', 'vendor/model:1']}]}
            response = await client.put('/v1/agent/model', json=CHOICE, headers=HEADERS)
            assert response.status == 200 and (await response.json()) == {
                'scope': 'connected-default', 'provider': CHOICE['provider'], 'model': CHOICE['model'],
                'providers': [{'id': 'custom:acme', 'name': 'Acme',
                               'models': ['old/model', 'vendor/model:1']}], 'effective': 'next-turn'}
            saved = read_user_config_raw(isolated)
            assert saved['model']['provider'] == CHOICE['provider']
            assert saved['model']['default'] == CHOICE['model']
            assert saved['model']['model_slots'] == 3
            assert _load_gateway_config(config_path=isolated)['model']['default'] == CHOICE['model']
            assert (await (await client.get('/v1/agent/model/options', headers=HEADERS)).json())['model'] == CHOICE['model']
            assert set(saved) == {'model', 'custom_providers'}  # no session or second DB state
            assert not list(isolated.parent.glob('*.db'))  # native caches are allowed, session DB is not
            assert not list(isolated.parent.glob('*.sqlite'))
    _run(check())


def test_invalid_schema_scope_and_inventory_choice_no_write(isolated):
    async def check():
        async with TestClient(TestServer(_app())) as client:
            initial = isolated.read_bytes()
            bad = [{}, {**CHOICE, 'scope': 'thread'}, {**CHOICE, 'unknown': 'x'},
                   {**CHOICE, 'confirm_selection': 'true'}, {**CHOICE, 'provider': '--foo'},
                   {**CHOICE, 'provider': 'missing'},
                   {**CHOICE, 'model': '--global'}, {**CHOICE, 'model': 'x --global'},
                   {**CHOICE, 'model': 'x\n'}, {**CHOICE, 'model': 'https://secret@host/x'},
                   {**CHOICE, 'model': ['vendor/model:1']}]
            for entry in bad:
                response = await client.put('/v1/agent/model', json=entry, headers=HEADERS)
                assert response.status == 400, (entry, response.status)
            assert isolated.read_bytes() == initial
    _run(check())


def test_native_guard_requires_confirmation_and_never_writes_first(isolated, monkeypatch):
    chosen = {**CHOICE, 'model': 'vendor/model-contributor'}
    original = inventory.build_model_options_payload
    def listing(*args, **kwargs):
        response = original(*args, **kwargs)
        response['providers'][0]['models'].append(chosen['model'])
        return response
    monkeypatch.setattr(inventory, 'build_model_options_payload', listing)
    async def check():
        async with TestClient(TestServer(_app())) as client:
            initial = isolated.read_bytes()
            response = await client.put('/v1/agent/model', json=chosen, headers=HEADERS)
            assert response.status == 200
            payload = await response.json()
            assert payload['confirmation_required'] is True
            assert 'TRAINS ON YOUR DATA' in payload['warning']
            assert (payload['provider'], payload['model']) == (chosen['provider'], chosen['model'])
            assert isolated.read_bytes() == initial
            response = await client.put('/v1/agent/model', json={**chosen, 'confirm_selection': True}, headers=HEADERS)
            assert response.status == 200 and (await response.json())['effective'] == 'next-turn'
    _run(check())


def test_resolution_persist_readback_and_skew_fail_closed(isolated, monkeypatch, caplog):
    async def check():
        async with TestClient(TestServer(_app())) as client:
            initial = isolated.read_bytes()
            original = model_switch.switch_model
            monkeypatch.setattr(model_switch, 'switch_model',
                                lambda *a, **k: (_ for _ in ()).throw(RuntimeError('synthetic-secret')))
            with caplog.at_level(logging.WARNING):
                response = await client.put('/v1/agent/model', json=CHOICE, headers=HEADERS)
            assert response.status == 503 and 'synthetic-secret' not in await response.text()
            assert 'synthetic-secret' not in caplog.text and isolated.read_bytes() == initial
            monkeypatch.setattr(model_switch, 'switch_model', original)
            monkeypatch.setattr(model_settings, '_model_switch_skew_guard', lambda: 'stale code')
            assert (await client.put('/v1/agent/model', json=CHOICE, headers=HEADERS)).status == 503
            monkeypatch.setattr(model_settings, '_model_switch_skew_guard', lambda: None)
            persist = model_switch.persist_model_selection
            monkeypatch.setattr(model_switch, 'persist_model_selection',
                                lambda *a, **k: (_ for _ in ()).throw(RuntimeError('synthetic-secret')))
            assert (await client.put('/v1/agent/model', json=CHOICE, headers=HEADERS)).status == 503
            assert isolated.read_bytes() == initial
            monkeypatch.setattr(model_switch, 'persist_model_selection', lambda *a, **k: None)
            assert (await client.put('/v1/agent/model', json=CHOICE, headers=HEADERS)).status == 503
            assert isolated.read_bytes() == initial
            monkeypatch.setattr(model_switch, 'persist_model_selection', persist)
    _run(check())


def test_concurrent_selection_serialized_with_owner_lock(isolated, monkeypatch):
    original = model_switch.switch_model
    active = [0, 0]
    def resolve(*args, **kwargs):
        active[0] += 1
        active[1] = max(active[1], active[0])
        try:
            time.sleep(0.04)
            return original(*args, **kwargs)
        finally:
            active[0] -= 1
    monkeypatch.setattr(model_switch, 'switch_model', resolve)
    async def check():
        async with TestClient(TestServer(_app())) as client:
            responses = await asyncio.gather(*(
                client.put('/v1/agent/model', json=CHOICE, headers=HEADERS) for _ in range(2)))
            assert [response.status for response in responses] == [200, 200]
            assert active[1] == 1
    _run(check())


def test_typed_model_uses_native_validation_even_with_empty_catalog(isolated, monkeypatch):
    original = inventory.build_model_options_payload
    def listing(*args, **kwargs):
        payload = original(*args, **kwargs)
        payload['providers'][0]['models'] = []
        return payload
    monkeypatch.setattr(inventory, 'build_model_options_payload', listing)
    async def check():
        async with TestClient(TestServer(_app())) as client:
            options = await (await client.get('/v1/agent/model/options', headers=HEADERS)).json()
            assert options['providers'][0]['id'] == CHOICE['provider']
            assert options['providers'][0]['models'] == []
            response = await client.put('/v1/agent/model', json={**CHOICE, 'model': 'new/model'}, headers=HEADERS)
            assert response.status == 200
            assert (await response.json())['model'] == 'new/model'
            before = isolated.read_bytes()
            monkeypatch.setattr(models_validate, 'validate_requested_model',
                                lambda *a, **k: {'accepted': False, 'persist': False, 'recognized': False, 'message': 'Not available'})
            response = await client.put('/v1/agent/model', json={**CHOICE, 'model': 'invalid/model'}, headers=HEADERS)
            assert response.status == 503
            assert isolated.read_bytes() == before
    _run(check())


def test_native_model_canonicalization_is_read_back(isolated, monkeypatch):
    original = model_switch.switch_model
    def resolve(**kwargs):
        kwargs['raw_input'] = 'vendor/model:1'
        return original(**kwargs)
    monkeypatch.setattr(model_switch, 'switch_model', resolve)
    async def check():
        async with TestClient(TestServer(_app())) as client:
            response = await client.put('/v1/agent/model', json={**CHOICE, 'model': 'alias'}, headers=HEADERS)
            assert response.status == 200
            assert (await response.json())['model'] == 'vendor/model:1'
            assert read_user_config_raw(isolated)['model']['default'] == 'vendor/model:1'
    _run(check())
