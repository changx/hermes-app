"""Message times come from originals, not reference/ingestion or compaction order."""
import sqlite3

import pytest

from hermes_app.storage import Store


def _core(tmp_path, rows):
    source = tmp_path / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'content TEXT, timestamp REAL, display_kind TEXT, platform_message_id TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', rows)
    return source


def test_core_original_time_in_history_latest_search_and_cold_continuation(tmp_path):
    source = _core(tmp_path, [
        (10, 'root', 'user', '中文原文', 1700000000.125, None, None),
        (11, 'root', 'assistant', 'response', 1700000002.5, None, None),
        (12, 'child', 'user', 'next', 1700000100.75, None, None),
        (13, 'child', 'assistant', 'response', 1700000101.25, None, None),
    ])
    meta = tmp_path / 'meta.sqlite'
    store = Store(meta)
    thread = store.create_thread('p', 'title', 'root', '')
    store.record_turn(thread, 'first', [('root', 10, 'user'), ('root', 11, 'assistant')])
    store.bind_turn('second', 'child', 'root')
    store.record_turn(thread, 'second', [('child', 12, 'user'), ('child', 13, 'assistant')])
    expected = [1700000000.125, 1700000002.5, 1700000100.75, 1700000101.25]
    first = store.history_page(thread, source, limit=2)
    second = Store(meta).history_page(thread, source, after=first['next_cursor'])
    assert [m['created_at'] for m in first['messages'] + second['messages']] == expected
    assert [m['created_at'] for m in Store(meta).history_page(thread, source, latest=True)['messages']] == expected
    assert [m['created_at'] for m in Store(meta).search_page(thread, source, 'response')['messages']] == expected[1::2]
    assert first['messages'][0]['text'] == '中文原文'


def test_receipt_time_persists_before_after_exact_core_promotion_and_search(tmp_path):
    source = _core(tmp_path, [(10, 'root', 'user', '中文消息', 1700000800.75, None, None)])
    meta = tmp_path / 'meta.sqlite'
    store = Store(meta)
    thread = store.create_thread('p', 'title', 'root', '')
    receipt, _ = store.accept(thread, 'send-1', '中文消息')
    with sqlite3.connect(meta) as db:
        db.execute('UPDATE receipts SET created_at=? WHERE id=?', (1700000000.375, receipt['id']))
    before = store.history_page(thread, source)['messages'][0]
    assert before['created_at'] == 1700000000.375
    assert Store(meta).search_page(thread, source, '中文消息')['messages'][0]['created_at'] == before['created_at']
    with sqlite3.connect(source) as db:
        db.execute('UPDATE messages SET platform_message_id=? WHERE id=10', (receipt['id'],))
    assert store.link_user_from_core(receipt['id'], source)
    store.record_turn(thread, 'real', [('root', 10, 'user')])
    after = Store(meta).history_page(thread, source, latest=True)['messages'][0]
    assert after['id'] == before['id']
    assert after['ref_seq'] == before['ref_seq']
    assert after['text'] == before['text'] == '中文消息'
    assert after['created_at'] == before['created_at']
    assert Store(meta).search_page(thread, source, '中文消息')['messages'][0]['created_at'] == before['created_at']


def test_raw_core_receipt_link_uses_receipt_time_not_core_time(tmp_path):
    source = _core(tmp_path, [(20, 's', 'user', '原文', 1700000700.5, None, None)])
    meta = tmp_path / 'meta.sqlite'
    store = Store(meta)
    thread = store.create_thread('p', 'title', 's', '')
    store.record_turn(thread, 'turn', [('s', 20, 'user')])
    receipt, _ = store.accept(thread, 'send-raw', '原文')
    with sqlite3.connect(meta) as db:
        db.execute('UPDATE receipts SET created_at=? WHERE id=?', (1700000000.875, receipt['id']))
    store.link_user_receipt(receipt['id'], 20)
    msg = Store(meta).history_page(thread, source)['messages'][0]
    assert msg['id'] == '20'
    assert msg['created_at'] == 1700000000.875
    assert Store(meta).search_page(thread, source, '原文')['messages'][0]['created_at'] == msg['created_at']


@pytest.mark.parametrize('value', [None, -1, float('inf'), float('-inf'), float('nan'),
                                   8640000000000.01, 'bad-epoch'])
def test_invalid_or_legacy_core_timestamp_is_omitted(tmp_path, value):
    source = _core(tmp_path, [(1, 's', 'user', 'legacy', value, None, None)])
    store = Store(tmp_path / 'meta.sqlite')
    thread = store.create_thread('p', 'title', 's', '')
    store.record_turn(thread, 'turn', [('s', 1, 'user')])
    assert 'created_at' not in store.history_page(thread, source)['messages'][0]
    assert 'created_at' not in store.search_page(thread, source, 'legacy')['messages'][0]


def test_epoch_bound_and_invalid_receipt_time(tmp_path):
    source = _core(tmp_path, [(1, 's', 'assistant', 'edge', 8640000000000, None, None),
                              (2, 's', 'user', 'zero', 0, None, None)])
    meta = tmp_path / 'meta.sqlite'
    store = Store(meta)
    thread = store.create_thread('p', 'title', 's', '')
    store.record_turn(thread, 'turn', [('s', 2, 'user'), ('s', 1, 'assistant')])
    assert [m['created_at'] for m in store.history_page(thread, source)['messages']] == [0, 8640000000000]
    receipt, _ = store.accept(thread, 'send-bad', 'pending')
    with sqlite3.connect(meta) as db:
        db.execute('UPDATE receipts SET created_at=? WHERE id=?', ('bad-epoch', receipt['id']))
    assert 'created_at' not in store.history_page(thread, source)['messages'][-1]
    assert 'created_at' not in store.search_page(thread, source, 'pending')['messages'][0]
