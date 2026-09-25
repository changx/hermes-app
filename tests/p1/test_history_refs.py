"""Stable reference contract: identity and order come from the plugin, bodies from Hermes."""
import sqlite3
import pytest

from hermes_app.storage import Store, MissingOriginal
from hermes_app.history_hooks import _compression_parent, post_llm_call, on_session_end
from hermes_app.projection import visible_text
from hermes_constants import set_hermes_home_override, reset_hermes_home_override


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
    with pytest.raises(ValueError, match='invalid cursor'):
        store.history_page(tid, source, after='999999')
    foreign = store.create_thread('p', 'other', 'other', '')
    with pytest.raises(ValueError, match='invalid cursor'):
        store.history_page(foreign, source, after=first['next_cursor'])
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


def test_projection_never_exposes_carrier_or_internal_marker():
    assert visible_text({'role':'user','content':'["ordinary literal"]'}) == '["ordinary literal"]'
    assert visible_text({'role':'user','content':'[{"type":"text","text":"part"}]'}) == 'part'
    assert visible_text({'role':'user','content':'carrier','_compressed_summary':1}) is None
    assert visible_text({'role':'user','content':'session metadata','display_kind':'session_meta'}) is None
    assert visible_text({'role':'assistant','content':'  '}) is None
    assert visible_text({'role':'assistant','content':'internal','display_kind':'hidden'}) is None


def test_hook_keeps_interim_and_user_only_turn_and_reports_pending(tmp_path):
    home = tmp_path / 'home'
    home.mkdir()
    source = home / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, display_kind TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?)', [
            (1, 's', 'user', 'ask', None),
            (2, 's', 'assistant', 'working', None),
            (3, 's', 'assistant', 'final', None),
            (4, 's', 'user', 'failed ask', None),
            (5, 's', 'assistant', 'internal', 'hidden'),
            (6, 's', 'user', '[System: session_meta]', None),
            (7, 's', 'user', '[{"type":"text","text":"part text"}]', None),
            (8, 's', 'user', 'interrupted ask', None)])
    store = Store(home / 'hermes-app' / 'metadata.sqlite')
    tid = store.create_thread('p', 'title', 's', '')
    token = set_hermes_home_override(home)
    try:
        store.begin_turn(tid, 'ingress:1')
        post_llm_call(platform='hermes_app', turn_id='t1', session_id='s',
            conversation_history=[{'role': 'user', 'content': 'ask', '_row_id': 1},
                {'role': 'assistant', 'content': 'working', '_row_id': 2},
                {'role': 'assistant', 'content': 'final', '_row_id': 3}])
        assert [(m['id'], m['text']) for m in store.history_page(tid, source)['messages']] == [
            ('1', 'ask'), ('2', 'working'), ('3', 'final')]
        store.begin_turn(tid, 'ingress:2')
        page = store.history_page(tid, source)
        assert [m['id'] for m in page['messages']] == ['1', '2', '3']
        assert page['incomplete_turns'] == ['ingress:2']
        post_llm_call(platform='hermes_app', turn_id='t2', session_id='s',
            conversation_history=[{'role': 'user', 'content': 'failed ask', '_row_id': 4}])
        assert [m['id'] for m in store.history_page(tid, source)['messages']] == ['1', '2', '3', '4']
        store.record_turn(tid, 't3', [('s', 7, 'user')])
        assert store.history_page(tid, source)['messages'][-1]['text'] == 'part text'
        store.begin_turn(tid, 'ingress:4')
        on_session_end(platform='hermes_app', session_id='s', turn_id='t4',
                       completed=False, failed=False, interrupted=True)
        page = store.history_page(tid, source)
        assert page['messages'][-1]['text'] == 'interrupted ask'
        assert page['turn_outcomes'] == [{'turn_id':'t4','state':'interrupted'}]
        assert not page['incomplete_turns']
        store.record_turn(tid, 'bad', [('s', 6, 'user')])
        with pytest.raises(MissingOriginal, match='not visible'):
            store.history_page(tid, source)
    finally:
        reset_hermes_home_override(token)
