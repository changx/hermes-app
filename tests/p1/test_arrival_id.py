"""Display refs follow durable acceptance, never model execution timing."""
import sqlite3

import pytest
from hermes_app.storage import Store


def setup(tmp_path):
    store = Store(tmp_path / 'metadata.sqlite')
    thread = store.create_thread('project', 'arrival', 'session', '')
    core = tmp_path / 'state.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'platform_message_id TEXT, finish_reason TEXT, tool_calls TEXT, content TEXT, display_kind TEXT)')
    return store, thread, core


def test_accept_assigns_order_before_owner_history_and_promotes_in_place(tmp_path):
    store, thread, core = setup(tmp_path)
    first, _ = store.accept(thread, 'first', 'same')
    second, _ = store.accept(thread, 'second', 'same')
    initial = store.history_page(thread, core)['messages']
    assert [m['client_message_id'] for m in initial] == ['first', 'second']
    positions = [(m['id'], m['ref_seq']) for m in initial]
    assert store.accept(thread, 'first', 'same') == (first, False)
    assert store.claim_next(thread) == (first['id'], 'same')
    assert store.claim_busy_text(thread) == (second['id'], 'same')
    with sqlite3.connect(core) as db:
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?,?)',
                   ('session', 'user', first['id'], None, None, 'same', None))
        db.execute('INSERT INTO messages VALUES (2,?,?,?,?,?,?,?)',
                   ('session', 'assistant', None, 'stop', None, 'reply', None))
    assert store.link_user_from_core(first['id'], core)
    store.bind_turn('turn', 'session')
    store.record_turn(thread, 'turn', [('session', 1, 'user'), ('session', 2, 'assistant')])
    store.mark_handed_off(second['id'])
    cold = Store(store.path)
    messages = cold.history_page(thread, core)['messages']
    assert [(m['id'], m['ref_seq']) for m in messages[:2]] == positions
    assert [m['role'] for m in messages] == ['user', 'user', 'assistant']
    page = cold.history_page(thread, core, limit=1)
    next_page = cold.history_page(thread, core, after=page['next_cursor'], limit=1)
    assert next_page['messages'][0]['client_message_id'] == 'second'
    # The core's model-facing history has not been rewritten by display order.
    with sqlite3.connect(core) as db:
        assert db.execute('SELECT id,role,platform_message_id FROM messages ORDER BY id').fetchall() == [
            (1, 'user', first['id']), (2, 'assistant', None)]


@pytest.mark.parametrize('end', ['cancel', 'interrupt', 'recover'])
def test_accept_position_stays_readable_without_core_row(tmp_path, end):
    store, thread, core = setup(tmp_path)
    receipt, _ = store.accept(thread, 'input', 'keep original')
    before = store.history_page(thread, core)['messages']
    assert len(before) == 1
    if end == 'cancel':
        assert store.cancel_queued(thread, receipt['id'])
    else:
        store.claim_next(thread)
        if end == 'interrupt':
            store.finish_receipt(receipt['id'], 'interrupted')
        else:
            store.recover_receipts(core)
    assert Store(store.path).history_page(thread, core)['messages'] == before


def test_settlement_without_hooks_reuses_accept_ref(tmp_path):
    store, thread, core = setup(tmp_path)
    receipt, _ = store.accept(thread, 'input', 'hello')
    before = store.history_page(thread, core)['messages']
    assert len(before) == 1
    store.claim_next(thread)
    with sqlite3.connect(core) as db:
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?,?)',
                   ('session', 'user', receipt['id'], None, None, 'hello', None))
        db.execute('INSERT INTO messages VALUES (2,?,?,?,?,?,?,?)',
                   ('session', 'assistant', None, 'stop', None, 'reply', None))
    store.settle_ingress(thread, 'ingress:' + receipt['id'], receipt['id'], core, owner_finished=True)
    after = Store(store.path).history_page(thread, core)['messages']
    assert after[0] == before[0]
    assert len(after) == 2
    assert store.turn_state('ingress:' + receipt['id']) == 'complete'
