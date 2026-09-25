"""Stable reference contract: identity and order come from the plugin, bodies from Hermes."""
import sqlite3
import pytest

from hermes_app.storage import Store, MissingOriginal
from hermes_app.history_hooks import _compression_parent


def test_repeated_text_order_pages_and_missing_original(tmp_path):
    source = tmp_path / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, display_kind TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?)', [
            (10, 'root', 'user', 'same', None), (11, 'root', 'assistant', 'reply', None),
            (12, 'root', 'user', 'same', None), (13, 'root', 'assistant', 'reply', None),
            (14, 'branch', 'user', 'foreign', None)])
    store = Store(tmp_path / 'meta.db')
    tid = store.create_thread('p', 'title', 'root', '')
    store.record_turn(tid, 'turn-1', [('root', 10, 'user'), ('root', 11, 'assistant')])
    store.record_turn(tid, 'turn-2', [('root', 12, 'user'), ('root', 13, 'assistant')])
    store.record_turn(tid, 'turn-2', [('root', 12, 'user'), ('root', 13, 'assistant')])
    first = store.history_page(tid, source, limit=2)
    second = store.history_page(tid, source, limit=2, after=first['next_cursor'])
    assert [(m['id'], m['role'], m['text']) for m in first['messages'] + second['messages']] == [
        ('10', 'user', 'same'), ('11', 'assistant', 'reply'),
        ('12', 'user', 'same'), ('13', 'assistant', 'reply')]
    assert second['next_cursor'] is None
    with sqlite3.connect(source) as db:
        db.execute('DELETE FROM messages WHERE id=12')
    with pytest.raises(MissingOriginal):
        Store(tmp_path / 'meta.db').history_page(tid, source, limit=2, after=first['next_cursor'])


def test_only_compression_child_inherits_thread(tmp_path):
    source = tmp_path / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, model_config TEXT, end_reason TEXT)')
        db.executemany('INSERT INTO sessions VALUES (?,?,?,?)', [
            ('root', None, '{}', 'compression'),
            ('continuation', 'root', '{}', None),
            ('branch', 'root', '{"_branched_from":"root"}', None),
            ('reset', 'root', '{"_reset_from":"root"}', None),
            ('ordinary', None, '{}', None),
            ('unrelated', 'ordinary', '{}', None)])
    assert _compression_parent('continuation', source) == 'root'
    assert _compression_parent('branch', source) == ''
    assert _compression_parent('reset', source) == ''
    assert _compression_parent('unrelated', source) == ''
