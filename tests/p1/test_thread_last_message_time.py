"""Snapshot summaries carry the newest visible message time for topic lists."""
import sqlite3

from hermes_app.storage import Store


def _core(tmp_path, rows):
    source = tmp_path / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'content TEXT, timestamp REAL, display_kind TEXT, platform_message_id TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', rows)
    return source


def _summary(store, source, thread):
    return next(t for t in store.snapshot(source_db=source)['threads'] if t['id'] == thread)


def test_last_message_time_uses_newest_core_row_then_receipt(tmp_path):
    source = _core(tmp_path, [(10, 'root', 'user', 'hi', 1700000000.5, None, None),
                              (11, 'root', 'assistant', 'hello', 1700000009.25, None, None)])
    store = Store(tmp_path / 'meta.sqlite')
    thread = store.create_thread('p', 'title', 'root', '')
    store.record_turn(thread, 'first', [('root', 10, 'user'), ('root', 11, 'assistant')])
    assert _summary(store, source, thread)['last_message_at'] == 1700000009.25
    receipt, _ = store.accept(thread, 'send-1', 'next')
    with sqlite3.connect(tmp_path / 'meta.sqlite') as db:
        db.execute('UPDATE receipts SET created_at=? WHERE id=?', (1700000100, receipt['id']))
    assert _summary(store, source, thread)['last_message_at'] == 1700000100


def test_empty_thread_falls_back_to_creation_time(tmp_path):
    store = Store(tmp_path / 'meta.sqlite')
    thread = store.create_thread('p', 'title', 'root', '')
    with sqlite3.connect(tmp_path / 'meta.sqlite') as db:
        db.execute('UPDATE threads SET created_at=? WHERE id=?', (1700000000, thread))
    assert _summary(store, tmp_path / 'missing.db', thread)['last_message_at'] == 1700000000
    assert _summary(store, None, thread)['last_message_at'] == 1700000000
