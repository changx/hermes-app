"""Native command output is display-only plugin data, never a model message."""
import sqlite3

import pytest

from hermes_app.storage import Store


def setup(tmp_path):
    store = Store(tmp_path / 'meta.sqlite')
    thread = store.create_thread('p1', 'one', 'session-1', '')
    other = store.create_thread('p2', 'two', 'session-2', '')
    missing_source = tmp_path / 'never-created-state.db'
    return store, thread, other, missing_source


def test_direct_only_pagination_search_sync_edit_and_cold_reload(tmp_path):
    store, thread, other, source = setup(tmp_path)
    first, _ = store.accept(thread, 'client1', '/help')
    assert not store.direct_receipt_has_output(first['id'])
    assert store.claim_next(thread) == (first['id'], '/help')
    before = store.sync_page()['next_cursor']
    message_id = store.create_direct_message(thread, first['id'], 'Native 帮助', message_id='dm_native_1')
    assert message_id == 'dm_native_1'
    assert store.direct_receipt_has_output(first['id'])
    assert store.direct_message_thread(message_id) == {'thread_id': thread, 'project_id': 'p1'}
    assert store.direct_message_thread('dm_absent') is None
    assert store.create_direct_message(thread, first['id'], 'Native 帮助', message_id=message_id) == message_id
    assert store.finish_direct_receipt(first['id'], 'completed')
    assert not store.finish_direct_receipt(first['id'], 'completed')
    assert store.receipt(first['id'])['state'] == 'completed'
    assert store.turn_state('ingress:' + first['id']) == 'complete'
    second, _ = store.accept(thread, 'client2', '/status')
    second_id = store.create_direct_message(thread, second['id'], 'Current native status')
    assert second_id.startswith('dm_') and second_id != message_id
    assert store.direct_message_thread(second_id) == {'thread_id': thread, 'project_id': 'p1'}
    cold = Store(store.path)
    history = cold.history_page(thread, source)
    messages = history['messages']
    assert [m['id'] for m in messages] == [
        'receipt:' + first['id'], message_id, 'receipt:' + second['id'], second_id]
    assert [m['role'] for m in messages] == ['user', 'assistant', 'user', 'assistant']
    assert all(m['display_kind'] == 'direct' for m in messages[1::2])
    assert all('receipt_id' not in m and 'client_message_id' not in m for m in messages[1::2])
    assert all('created_at' in m for m in messages)
    assert [m['ref_seq'] for m in messages] == sorted(m['ref_seq'] for m in messages)
    assert cold.history_page(thread, source, limit=2)['messages'] == messages[:2]
    assert cold.history_page(thread, source, ref_seq=messages[1]['ref_seq'])['messages'] == [messages[1]]
    for bad in (0, -1, '1', messages[1]['ref_seq'] + 1000):
        with pytest.raises(ValueError, match='ref seq'):
            cold.history_page(thread, source, ref_seq=bad)
    with pytest.raises(ValueError, match='ref seq'):
        cold.history_page(other, source, ref_seq=messages[1]['ref_seq'])
    with pytest.raises(ValueError, match='exclusive'):
        cold.history_page(thread, source, ref_seq=messages[1]['ref_seq'], latest=True)
    next_cursor = cold.history_page(thread, source, limit=2)['next_cursor']
    assert cold.history_page(thread, source, after=next_cursor)['messages'] == messages[2:]
    tail = cold.history_page(thread, source, latest=True, limit=2)
    assert tail['messages'] == messages[2:]
    assert cold.history_page(thread, source, before=tail['older_cursor'])['messages'] == messages[:2]
    assert cold.search_page(thread, source, 'native', limit=1)['messages'] == [messages[1]]
    match = cold.search_page(thread, source, 'native', limit=1)
    assert cold.search_page(thread, source, 'native', after=match['next_cursor'])['messages'] == [messages[3]]
    assert cold.search_page(other, source, 'native')['messages'] == []
    assert next(t for t in cold.snapshot()['threads'] if t['id'] == thread)['last_ref'] == messages[-1]['ref_seq']
    assert cold.read_thread(thread, messages[1]['ref_seq'])['unread_count'] == 2
    event = cold.sync_page(cursor=before)['events'][0]
    assert event['kind'] == 'message' and event['ref'] == str(messages[1]['ref_seq']) and event['version'] == 1
    original_time = messages[1]['created_at']
    cursor = cold.sync_page()['next_cursor']
    assert not cold.update_direct_message(other, message_id, 'foreign')
    assert cold.update_direct_message(thread, message_id, 'Native 帮助')
    assert cold.update_direct_message(thread, message_id, 'Edited 帮助')
    assert cold.update_direct_message(thread, message_id, 'Edited again')
    updates = cold.sync_page(cursor=cursor)['events']
    assert [(e['kind'],e['ref'],e['version']) for e in updates] == [
        ('message',str(messages[1]['ref_seq']),2), ('message',str(messages[1]['ref_seq']),3)]
    edited = Store(store.path).history_page(thread, source)['messages'][1]
    assert (edited['id'], edited['ref_seq'], edited['created_at']) == (message_id, messages[1]['ref_seq'], original_time)
    assert edited['text'] == 'Edited again'
    assert cold.history_page(thread, source, ref_seq=edited['ref_seq'])['messages'] == [edited]
    assert Store(store.path).search_page(thread, source, 'edited')['messages'] == [edited]
    assert Store(store.path).search_page(thread, source, 'Native 帮助')['messages'] == []
    assert not source.exists()  # No need to open, create, or mutate SessionDB.
    with sqlite3.connect(store.path) as db:
        assert db.execute('SELECT COUNT(*) FROM message_refs WHERE row_id IS NOT NULL').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM message_refs WHERE direct_message_id IS NOT NULL').fetchone()[0] == 2
        assert db.execute('SELECT pending_text FROM receipts WHERE id=?', (first['id'],)).fetchone()[0] == '/help'


def test_direct_identity_validation_and_source_unchanged_mixed_history(tmp_path):
    store, thread, other, source = setup(tmp_path)
    first, _ = store.accept(thread, 'client1', '/version')
    second, _ = store.accept(other, 'client2', '/version')
    with pytest.raises(ValueError, match='accepted input'):
        store.create_direct_message(thread, second['id'], 'foreign')
    with pytest.raises(ValueError, match='accepted input'):
        store.create_direct_message(thread, 'rc_missing', 'absent')
    with pytest.raises(ValueError, match='id'):
        store.create_direct_message(thread, first['id'], 'a', message_id='1')
    store.claim_next(thread)
    direct = store.create_direct_message(thread, first['id'], 'native', message_id='dm_fixed')
    for t, receipt, text in [(other, first['id'], 'native'), (thread, second['id'], 'native'),
                             (thread, first['id'], 'different')]:
        with pytest.raises(ValueError, match='conflict'):
            store.create_direct_message(t, receipt, text, message_id=direct)
    with pytest.raises(ValueError, match='text'):
        store.update_direct_message(thread, direct, None)
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'content TEXT, display_kind TEXT, platform_message_id TEXT, timestamp REAL, tool_calls TEXT)')
        db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)',
                   (10, 'session-1', 'assistant', 'core result', None, None, 1234.5, None))
    raw = source.read_bytes()
    store.publish_delivery('job', thread, 'session-1', 10)
    # A core assistant ref is published separately; no change to its row identity.
    messages = Store(store.path).history_page(thread, source)['messages']
    assert [m['id'] for m in messages] == ['receipt:' + first['id'], direct, '10']
    assert [m['text'] for m in messages] == ['/version', 'native', 'core result']
    assert [m['id'] for m in store.search_page(thread, source, 'result')['messages']] == ['10']
    assert source.read_bytes() == raw
    with store._connect() as db:
        for sql in ["INSERT INTO message_refs(thread_id,turn_id,session_id,role) VALUES (?,?,?,'assistant')",
                    "INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,direct_message_id,role) VALUES (?,?,?,?,?,'assistant')"]:
            with pytest.raises(sqlite3.IntegrityError):
                if 'row_id,direct' in sql:
                    db.execute(sql, (thread, 'cron:job', 'session-1', 11, direct))
                else:
                    db.execute(sql, (thread, 'cron:job', 'session-1'))


@pytest.mark.parametrize('state,turn_state', [
    ('completed', 'complete'), ('failed', 'failed'), ('interrupted', 'interrupted')])
def test_finish_direct_only_and_guard_core_work(tmp_path, state, turn_state):
    store, thread, _, source = setup(tmp_path)
    receipt, _ = store.accept(thread, 'first', '/help')
    assert not store.finish_direct_receipt(receipt['id'], state)
    store.claim_next(thread)
    assert not store.finish_direct_receipt(receipt['id'], state)
    store.create_direct_message(thread, receipt['id'], 'reply')
    assert store.finish_direct_receipt(receipt['id'], state)
    assert store.receipt(receipt['id'])['state'] == state
    assert store.turn_state('ingress:' + receipt['id']) == turn_state
    assert store.history_page(thread, source)['messages'][0]['text'] == '/help'
    with pytest.raises(ValueError, match='outcome'):
        store.finish_direct_receipt(receipt['id'], 'unknown')
    anchored, _ = store.accept(thread, 'anchored', '/goal')
    store.claim_next(thread)
    store.create_direct_message(thread, anchored['id'], 'ACK')
    store.bind_turn('model-turn', 'session-1')
    assert not store.finish_direct_receipt(anchored['id'], 'completed')
    assert store.receipt(anchored['id'])['state'] == 'running'
    assert store.turn_state('ingress:' + anchored['id']) == 'pending'
    with store._connect() as db:
        db.execute('DELETE FROM ingress_links WHERE ingress_id=?', ('ingress:' + anchored['id'],))
        db.execute('UPDATE receipts SET user_row_id=42 WHERE id=?', (anchored['id'],))
    assert not store.finish_direct_receipt(anchored['id'], 'completed')


def test_busy_inline_direct_reply_settles_without_ingress(tmp_path):
    store, thread, _, source = setup(tmp_path)
    owner, _ = store.accept(thread, 'owner', 'still running')
    store.claim_next(thread)
    followup, _ = store.accept(thread, 'followup', '/status')
    assert store.claim_busy_text(thread) == (followup['id'], '/status')
    assert store.turn_state('ingress:' + followup['id']) is None
    dm = store.create_direct_message(thread, followup['id'], 'busy command response')
    assert store.finish_direct_receipt(followup['id'], 'completed')
    assert store.turn_state('ingress:' + followup['id']) is None
    assert store.receipt(followup['id'])['state'] == 'completed'
    assert store.receipt(owner['id'])['state'] == 'running'
    assert store.history_page(thread, source)['messages'][-1]['id'] == dm


def test_bind_direct_session_rejects_cross_thread(tmp_path):
    store, thread, other, _ = setup(tmp_path)
    assert store.bind_direct_session(thread, 'fresh')
    assert not store.bind_direct_session(thread, 'fresh')
    assert store.thread_for_session('fresh') == thread
    with pytest.raises(ValueError, match='another thread'):
        store.bind_direct_session(other, 'fresh')
    with pytest.raises(ValueError, match='unknown thread'):
        store.bind_direct_session('th_missing', 'another')
    assert store.thread_for_session('another') is None
    with pytest.raises(ValueError, match='session id'):
        store.bind_direct_session(thread, '')


def test_migrate_old_refs_preserves_events_cursors_read_and_input(tmp_path):
    store, thread, _, source = setup(tmp_path)
    first, _ = store.accept(thread, 'first', 'raw original')
    store.begin_turn(thread, 'old-core')
    with store._connect() as db:
        db.execute("INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) "
                   "VALUES (?,?,?,?,'assistant')", (thread, 'old-core', 'session-1', 17))
    prior = store.sync_page()['events']
    cursor = prior[-1]['cursor']
    old_refs = next(t for t in store.snapshot()['threads'] if t['id'] == thread)['last_ref']
    store.read_thread(thread, old_refs - 1)
    prior = store.sync_page()['events']
    with sqlite3.connect(store.path) as db:
        db.execute('DROP TRIGGER published_ref')
        db.execute('DROP INDEX refs_page')
        db.execute('ALTER TABLE message_refs RENAME TO retired_refs')
        db.execute('CREATE TABLE message_refs (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                   'thread_id TEXT NOT NULL REFERENCES threads(id), '
                   'turn_id TEXT NOT NULL REFERENCES turns(turn_id), session_id TEXT NOT NULL, '
                   'row_id INTEGER UNIQUE, input_receipt_id TEXT UNIQUE REFERENCES receipts(id), '
                   'role TEXT NOT NULL, CHECK (row_id IS NOT NULL OR input_receipt_id IS NOT NULL))')
        db.execute('INSERT INTO message_refs(seq,thread_id,turn_id,session_id,row_id,input_receipt_id,role) '
                   'SELECT seq,thread_id,turn_id,session_id,row_id,input_receipt_id,role FROM retired_refs')
        db.execute('DROP TABLE retired_refs')
        db.execute('CREATE INDEX refs_page ON message_refs(thread_id,seq)')
        db.execute("CREATE TRIGGER published_ref AFTER INSERT ON message_refs BEGIN "
                   "INSERT INTO sync_events(kind,thread_id,ref,version) "
                   "VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1); END")
    cold = Store(store.path)
    assert cold.sync_page()['events'] == prior
    assert cold.sync_page(cursor=cursor)['events'] == prior[len(prior)-1:]
    assert next(t for t in cold.snapshot()['threads'] if t['id'] == thread)['read_ref'] == old_refs - 1
    assert cold.history_page(thread, source, limit=1)['messages'][0]['id'] == 'receipt:' + first['id']
    direct = cold.create_direct_message(thread, first['id'], 'native')
    assert cold.history_page(thread, source, limit=1)['messages'][0]['id'] == 'receipt:' + first['id']
    assert cold.history_page(thread, source, latest=True, limit=1)['messages'][0]['id'] == direct
    assert next(t for t in cold.snapshot()['threads'] if t['id'] == thread)['last_ref'] == old_refs + 1
    assert cold.sync_page(cursor=prior[-1]['cursor'])['events'][0]['ref'] == str(old_refs+1)
    with cold._connect() as db:
        refs = db.execute('SELECT seq,row_id,input_receipt_id,direct_message_id FROM message_refs ORDER BY seq').fetchall()
        assert [(r['seq'],r['row_id'],r['input_receipt_id'],r['direct_message_id']) for r in refs] == [
            (1,None,first['id'],None), (2,17,None,None), (3,None,None,direct)]


def test_bounded_direct_only_search_with_missing_source(tmp_path):
    store, thread, _, source = setup(tmp_path)
    for index in range(260):
        receipt, _ = store.accept(thread, f'id-{index}', f'/help {index}')
        store.create_direct_message(thread, receipt['id'], f'match {index}')
        store.cancel_queued(thread, receipt['id'])
    # search scans at most 500 refs per page, even for direct-only data.
    first = store.search_page(thread, source, 'match 259', limit=1)
    assert first['messages'] == [] and first['next_cursor']
    second = store.search_page(thread, source, 'match 259', after=first['next_cursor'])
    assert [m['text'] for m in second['messages']] == ['match 259']
    assert not source.exists()
