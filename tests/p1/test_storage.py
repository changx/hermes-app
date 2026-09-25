"""P1-01/02 contract tests; run against the pinned Hermes baseline interpreter."""
import importlib.util
import asyncio
import sys
from pathlib import Path
import pytest

PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
sys.path.insert(0, str(PLUGIN.parent))
from hermes_app.storage import Store


def test_disconnect_drains_inflight_settlement_and_rejects_ingress(tmp_path):
    from aiohttp import web
    from gateway.config import PlatformConfig, Platform
    from gateway.platforms.base import BasePlatformAdapter
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from hermes_app.adapter import HermesAppAdapter

    token = set_hermes_home_override(tmp_path)
    try:
        async def scenario():
            # The real runner registers the dynamic platform before constructing
            # this adapter. Exercise its shutdown methods with base task state.
            adapter = object.__new__(HermesAppAdapter)
            BasePlatformAdapter.__init__(adapter, PlatformConfig(enabled=True), Platform.TELEGRAM)
            adapter._runner = adapter._site = None
            adapter._sockets = set()
            adapter._settlement_tasks = set()
            adapter._stopping = False
            adapter.port = None
            started, release = asyncio.Event(), asyncio.Event()
            finished = []
            async def settle(*_):
                started.set()
                await release.wait()
                finished.append(True)
            adapter._settle_ingress = settle
            adapter._schedule_settlement('thread','ingress','message')
            await started.wait()
            closing = asyncio.create_task(adapter.disconnect())
            await asyncio.sleep(0)
            assert not closing.done()
            assert adapter._stopping
            with pytest.raises(web.HTTPServiceUnavailable):
                await adapter._submit(object())
            release.set()
            await closing
            assert finished == [True]
            assert not adapter._settlement_tasks
        asyncio.run(scenario())
    finally:
        reset_hermes_home_override(token)


def test_new_session_description_once_and_thread_isolation(tmp_path):
    store = Store(tmp_path / 'app.sqlite')
    a = store.create_thread('project', 'a', 'root-a', 'Description v1')
    b = store.create_thread('project', 'b', 'root-b', 'Description v2')
    assert store.take_initial_description('root-a') == 'Description v1'
    assert store.take_initial_description('root-a') == ''
    assert store.take_initial_description('successor-a') == ''
    assert store.take_initial_description('root-b') == 'Description v2'
    assert store.get_thread(a)['session_id'] == 'root-a'
    assert store.get_thread(b)['session_id'] == 'root-b'
    store.close()
    reopened = Store(tmp_path / 'app.sqlite')
    assert reopened.take_initial_description('root-a') == ''
    assert reopened.get_thread(a)['description'] == 'Description v1'
    first = reopened.list_threads('project', limit=1)
    second = reopened.list_threads('project', limit=1, after=first['next_cursor'])
    assert {x['id'] for x in first['threads'] + second['threads']} == {a, b}
    assert second['next_cursor'] is None
    with pytest.raises(ValueError, match='invalid cursor'):
        reopened.list_threads('other', after=first['next_cursor'])
    reopened.close()
