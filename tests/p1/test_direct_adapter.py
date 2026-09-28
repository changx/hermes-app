"""Native transport replies are history-only, with exact task/thread ownership."""
import asyncio
import sqlite3
from types import SimpleNamespace
import pytest

from hermes_app import adapter as module
from hermes_app.adapter import HermesAppAdapter, reply_scope
from hermes_app.storage import Store
from gateway.platforms.base import ProcessingOutcome


def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(module, 'get_hermes_home', lambda: tmp_path)
    store = Store(tmp_path/'metadata.sqlite')
    thread = store.create_thread('project', 'commands', 'session', '')
    app = object.__new__(HermesAppAdapter)
    app._store = store
    app._events_changed = asyncio.Event()
    async def current(source):
        return SimpleNamespace(session_id=store.get_thread(source.thread_id)['session_id'])
    app._gateway_owner = lambda: SimpleNamespace(async_session_store=SimpleNamespace(
        get_or_create_session=current))
    return app, store, thread


def event_for(store, thread, name):
    receipt, _ = store.accept(thread, name, '/'+name)
    store.claim_next(thread)
    return receipt, SimpleNamespace(message_id=receipt['id'], source=SimpleNamespace(chat_id='project', thread_id=thread))


def test_direct_output_and_edits_do_not_create_session(tmp_path, monkeypatch):
    app, store, thread = setup(tmp_path, monkeypatch)
    receipt, event = event_for(store, thread, 'usage')
    async def run():
        token = reply_scope.set({'event': event})
        try:
            await app.on_processing_start(event)
            response = await app.send('project', 'Checking usage', metadata={'thread_id': thread})
            assert response.success and response.message_id.startswith('dm_')
            assert (await app.edit_message('project', response.message_id, 'Usage: 42 tokens')).success
            assert (await app.edit_message('project', response.message_id, 'Usage: 42 tokens', finalize=True)).success
            assert not (await app.edit_message('other', response.message_id, 'wrong')).success
            await app.on_processing_complete(event, ProcessingOutcome.SUCCESS)
        finally:
            reply_scope.reset(token)
    asyncio.run(run())
    assert not (tmp_path/'state.db').exists()
    page = Store(store.path).history_page(thread, tmp_path/'state.db')['messages']
    assert [m['text'] for m in page] == ['/usage', 'Usage: 42 tokens']
    assert page[-1]['display_kind'] == 'direct'
    assert store.receipt(receipt['id'])['state'] == 'completed'
    assert not store.history_page(thread, tmp_path/'state.db')['incomplete_turns']


def test_concurrent_direct_replies_stay_in_their_exact_threads(tmp_path, monkeypatch):
    app, store, one = setup(tmp_path, monkeypatch)
    two = store.create_thread('project', 'second', 'session-two', '')
    a, first = event_for(store, one, 'help')
    b, second = event_for(store, two, 'status')
    async def reply(event, text):
        token = reply_scope.set({'event': event})
        try:
            await asyncio.sleep(0)
            return await app.send('project', text)
        finally:
            reply_scope.reset(token)
    async def run():
        results = await asyncio.gather(reply(first, 'FIRST'), reply(second, 'SECOND'))
        assert all(r.success for r in results)
        assert not (await app.send('project', 'Unrouted')).success
        assert not (await app.send('project', 'Wrong thread', reply_to=a['id'], metadata={'thread_id': two})).success
    asyncio.run(run())
    assert store.history_page(one, tmp_path/'state.db')['messages'][-1]['text'] == 'FIRST'
    assert store.history_page(two, tmp_path/'state.db')['messages'][-1]['text'] == 'SECOND'


def test_exact_model_input_keeps_existing_projection_no_duplicate(tmp_path, monkeypatch):
    app, store, thread = setup(tmp_path, monkeypatch)
    receipt, event = event_for(store, thread, 'model-backed')
    # Matching identity is enough; never compare model or direct reply text.
    with sqlite3.connect(tmp_path/'state.db') as core:
        core.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, platform_message_id TEXT, display_kind TEXT)')
        core.execute('INSERT INTO messages VALUES(1,?,?,?,?,?)', ('session', 'user', 'model-backed input', receipt['id'], None))
    async def run():
        token = reply_scope.set({'event': event})
        try:
            assert (await app.send('project', 'Existing model answer')).success
        finally:
            reply_scope.reset(token)
    asyncio.run(run())
    assert not store.direct_receipt_has_output(receipt['id'])
    with sqlite3.connect(tmp_path/'state.db') as core:
        assert core.execute('SELECT COUNT(*) FROM messages').fetchone()[0] == 1


def test_native_switch_to_sibling_session_is_rolled_back(tmp_path, monkeypatch):
    app, store, thread = setup(tmp_path, monkeypatch)
    other = store.create_thread('project', 'sibling', 'foreign', '')
    receipt, event = event_for(store, thread, 'resume')
    entry = SimpleNamespace(session_id='foreign')
    switched = []
    async def current(source):
        return entry
    async def switch(key, session_id):
        switched.append((key, session_id))
        entry.session_id = session_id
        return entry
    app._gateway_owner = lambda: SimpleNamespace(async_session_store=SimpleNamespace(
        get_or_create_session=current, switch_session=switch))
    app._event_session_key = lambda ev: ev.source.thread_id
    async def run():
        token = reply_scope.set({'event':event,'session_before':'session'})
        try:
            assert (await app.send('project', 'Resumed foreign')).success
        finally:
            reply_scope.reset(token)
    asyncio.run(run())
    assert switched == [(thread, 'session')]
    assert entry.session_id == 'session' and store.thread_for_session('foreign') == other
    page = store.history_page(thread, tmp_path/'state.db')['messages']
    assert page[-1]['text'] == 'Session belongs to another App thread; switch was not kept.'
    assert store.receipt(receipt['id'])['state'] == 'running'


def test_document_failure_never_claims_success(tmp_path, monkeypatch):
    app, store, thread = setup(tmp_path, monkeypatch)
    _, event = event_for(store, thread, 'save')
    async def run():
        token = reply_scope.set({'event':event})
        try:
            with pytest.raises(RuntimeError, match='Document could not be stored'):
                await app.send_document('project', str(tmp_path/'absent'), file_name='export.md')
        finally:
            reply_scope.reset(token)
    asyncio.run(run())
    assert store.history_page(thread, tmp_path/'state.db')['messages'][-1]['role'] == 'user'
