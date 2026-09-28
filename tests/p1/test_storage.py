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


def test_generated_title_is_conditional_and_emits_thread_event(tmp_path):
    store = Store(tmp_path / 'app.sqlite')
    thread = store.create_thread('project', 'New topic', 'session', '')
    assert store.replace_thread_title(thread, 'New topic', 'Generated title')
    assert store.get_thread(thread)['title'] == 'Generated title'
    before = store.sync_page()['waterline']
    assert not store.replace_thread_title(thread, 'New topic', 'Late title')
    assert store.get_thread(thread)['title'] == 'Generated title'
    assert store.sync_page(cursor=before)['events'] == []


def test_adapter_uses_hermes_title_generator_and_attachment_fallback(tmp_path, monkeypatch):
    from agent import title_generator
    from hermes_app.adapter import HermesAppAdapter

    store = Store(tmp_path / 'app.sqlite')
    text_thread = store.create_thread('project', 'New topic', 'session-one', '')
    file_thread = store.create_thread('project', 'New topic', 'session-two', '')
    store.attachment_add(file_thread, 'att_test', 'camera.jpg', 'image/jpeg', 3)
    prompts = []
    monkeypatch.setattr(title_generator, 'generate_title',
                        lambda prompt: prompts.append(prompt) or ('Camera review' if 'camera.jpg' in prompt else 'Auth repair'))
    adapter = object.__new__(HermesAppAdapter)
    adapter._store = store
    adapter._events_changed = asyncio.Event()
    asyncio.run(adapter._generate_topic_title(text_thread, 'repair login auth', ()))
    asyncio.run(adapter._generate_topic_title(file_thread, '', ('att_test',)))
    assert prompts == ['repair login auth', 'Files: camera.jpg']
    assert store.get_thread(text_thread)['title'] == 'Auth repair'
    assert store.get_thread(file_thread)['title'] == 'Camera review'
