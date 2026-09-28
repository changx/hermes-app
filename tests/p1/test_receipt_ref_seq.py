"""Receipts expose only their existing, stable user display position."""
import asyncio
import sqlite3

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from hermes_app.adapter import HermesAppAdapter
from hermes_app.storage import Store


def test_accept_retry_promotion_and_cold_read_keep_exact_seq(tmp_path):
    store = Store(tmp_path/'meta.sqlite')
    one = store.create_thread('p', 'one', 'session', '')
    two = store.create_thread('p', 'two', 'other-session', '')
    a, _ = store.accept(one, 'a', 'same text')
    b, _ = store.accept(one, 'b', 'same text')
    foreign, _ = store.accept(two, 'foreign', 'same text')
    seq = a['ref_seq']
    assert len({seq, b['ref_seq'], foreign['ref_seq']}) == 3
    assert store.accept(one, 'a', 'same text') == (a, False)
    store.claim_next(one)
    core = tmp_path/'state.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'platform_message_id TEXT, content TEXT, display_kind TEXT)')
        db.execute('INSERT INTO messages VALUES (10,?,?,?,?,?)',
                   ('session', 'user', a['id'], 'same text', None))
    before_events = store.sync_page()['events']
    assert store.link_user_from_core(a['id'], core)
    assert store.receipt(a['id'])['ref_seq'] == seq
    assert Store(store.path).accept(one, 'a', 'same text')[0]['ref_seq'] == seq
    assert store.sync_page()['events'] == before_events
    assert store.history_page(one, core, ref_seq=seq)['messages'][0]['receipt_id'] == a['id']
    assert store.history_page(one, core, ref_seq=seq)['messages'][0]['ref_seq'] == seq
    assert store.receipt(b['id'])['ref_seq'] == b['ref_seq']
    assert store.receipt(foreign['id'])['ref_seq'] == foreign['ref_seq']


def test_legacy_core_link_only_and_missing_or_other_identity_omit_seq(tmp_path):
    store = Store(tmp_path/'meta.sqlite')
    one = store.create_thread('p', 'one', 'session', '')
    two = store.create_thread('p', 'two', 'other-session', '')
    a, _ = store.accept(one, 'a', 'same text')
    b, _ = store.accept(one, 'b', 'same text')
    foreign, _ = store.accept(two, 'foreign', 'same text')
    with store._connect() as db:
        # Emulate a historical record without a receipt-backed input ref.
        db.execute('DELETE FROM message_refs WHERE input_receipt_id=?', (a['id'],))
    store.begin_turn(one, 'legacy')
    store.record_turn(one, 'legacy', [('session', 25, 'user')])
    store.link_user_receipt(a['id'], 25)
    with store._connect() as db:
        core_seq = db.execute('SELECT seq FROM message_refs WHERE row_id=25').fetchone()[0]
        old_events = db.execute('SELECT COUNT(*) FROM sync_events').fetchone()[0]
    assert Store(store.path).receipt(a['id'])['ref_seq'] == core_seq
    snapshot_thread = next(t for t in store.snapshot()['threads'] if t['id'] == one)
    assert next(r for r in snapshot_thread['active_receipts']
                if r['id'] == a['id'])['ref_seq'] == core_seq
    # Ambiguous core linkage cannot assign the same display position twice.
    with store._connect() as db:
        db.execute('DELETE FROM message_refs WHERE input_receipt_id=?', (b['id'],))
        db.execute('UPDATE receipts SET user_row_id=25 WHERE id=?', (b['id'],))
    assert 'ref_seq' not in store.receipt(a['id'])
    assert 'ref_seq' not in store.receipt(b['id'])
    # Missing and foreign refs do not acquire a position by matching text or row ID.
    with store._connect() as db:
        db.execute('UPDATE receipts SET user_row_id=NULL WHERE id=?', (b['id'],))
        db.execute('UPDATE receipts SET user_row_id=25 WHERE id=?', (foreign['id'],))
        db.execute('DELETE FROM message_refs WHERE input_receipt_id=?', (foreign['id'],))
        db.execute('UPDATE receipts SET user_row_id=NULL WHERE id=?', (a['id'],))
    assert 'ref_seq' not in store.receipt(a['id'])
    assert 'ref_seq' not in store.receipt(b['id'])
    assert 'ref_seq' not in store.receipt(foreign['id'])
    with store._connect() as db:
        assert db.execute('SELECT COUNT(*) FROM sync_events').fetchone()[0] == old_events


def test_http_post_get_and_snapshot_same_ref_seq(tmp_path):
    store = Store(tmp_path/'meta.sqlite')
    thread = store.create_thread('p', 'one', 'session', '')
    app = object.__new__(HermesAppAdapter)
    app._store = store
    app._stopping = False
    app._events_changed = asyncio.Event()
    app._admission_tasks = set()
    async def no_busy(_):
        return None
    async def no_channels():
        return None
    app._dispatch_busy_text = no_busy
    app._wake_thread = lambda _: None
    app._reconcile_interactions = lambda: None
    app._refresh_channels = no_channels
    server = web.Application()
    server.router.add_post('/v1/threads/{id}/messages', app._submit)
    server.router.add_get('/v1/receipts/{id}', app._receipt)
    server.router.add_get('/v1/snapshot', app._snapshot)
    async def run():
        async with TestClient(TestServer(server)) as client:
            response = await client.post(f'/v1/threads/{thread}/messages',
                                         json={'client_message_id': 'same', 'text': 'raw'})
            assert response.status == 202
            posted = (await response.json())['receipt']
            assert type(posted['ref_seq']) is int
            response = await client.get('/v1/receipts/' + posted['id'])
            exact = (await response.json())['receipt']
            response = await client.get('/v1/snapshot')
            active = (await response.json())['threads'][0]['active_receipts'][0]
            assert posted == exact == active
            response = await client.post(f'/v1/threads/{thread}/messages',
                                         json={'client_message_id': 'same', 'text': 'raw'})
            assert (await response.json())['receipt'] == posted
            assert Store(store.path).receipt(posted['id']) == posted
    asyncio.run(run())
