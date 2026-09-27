"""Bounded latest/older history and authoritative send identity contract."""
import asyncio
import sqlite3

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from hermes_app import adapter as transport
from hermes_app.storage import Store


def fixture(tmp_path):
    source = tmp_path / 'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, '
                   'content TEXT, display_kind TEXT, platform_message_id TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?)', [
            (10, 'a', 'user', 'same', None, None),
            (11, 'a', 'assistant', 'same', None, None),
            (12, 'b', 'user', 'foreign', None, None),
            (13, 'a', 'user', 'same', None, None),
            (14, 'a', 'assistant', 'same', None, None),
            (15, 'a', 'user', 'unlinked', None, None),
        ])
    store = Store(tmp_path / 'metadata.sqlite')
    a = store.create_thread('p', 'A', 'a', '')
    b = store.create_thread('p', 'B', 'b', '')
    first, _ = store.accept(a, 'send-one', 'same')
    with sqlite3.connect(source) as db:
        db.execute('UPDATE messages SET platform_message_id=? WHERE id=10',(first['id'],))
    assert store.link_user_from_core(first['id'],source)
    store.record_turn(a, 't1', [('a', 10, 'user'), ('a', 11, 'assistant')])
    store.record_turn(b, 'tb', [('b', 12, 'user')])  # Sparse *global* seq in A.
    second, _ = store.accept(a, 'send-two', 'same')
    with sqlite3.connect(source) as db:
        db.execute('UPDATE messages SET platform_message_id=? WHERE id=13',(second['id'],))
    assert store.link_user_from_core(second['id'],source)
    store.record_turn(a, 't2', [('a', 13, 'user'), ('a', 14, 'assistant')])
    store.record_turn(a, 't3', [('a', 15, 'user')])
    return store, source, a, b, first, second


def test_latest_sparse_global_refs_identity_and_original_forward(tmp_path):
    store, source, a, b, first, second = fixture(tmp_path)
    latest = store.history_page(a, source, limit=2, latest=True)
    assert [m['id'] for m in latest['messages']] == ['14', '15']
    assert latest['next_cursor'] is None
    assert latest['older_cursor']
    middle = store.history_page(a, source, limit=2, before=latest['older_cursor'])
    assert [m['id'] for m in middle['messages']] == ['11', 'receipt:'+second['id']]
    oldest = store.history_page(a, source, limit=2, before=middle['older_cursor'])
    assert [m['id'] for m in oldest['messages']] == ['receipt:'+first['id']]
    assert oldest['older_cursor'] is None
    assert [m['id'] for m in store.history_page(a, source, after=oldest['next_cursor'])['messages']] == [
        '11', 'receipt:'+second['id'], '14', '15']  # Forward resumes after the older page.
    assert oldest['messages'][0]['receipt_id'] == first['id']
    assert oldest['messages'][0]['client_message_id'] == 'send-one'
    assert middle['messages'][1]['receipt_id'] == second['id']
    assert middle['messages'][1]['client_message_id'] == 'send-two'
    for msg in (middle['messages'][0], latest['messages'][0], latest['messages'][1]):
        assert 'receipt_id' not in msg and 'client_message_id' not in msg
    forward = store.history_page(a, source, limit=2)
    assert [m['id'] for m in forward['messages']] == ['receipt:'+first['id'], '11']
    assert 'older_cursor' in forward and forward['older_cursor'] is None
    assert [m['id'] for m in store.history_page(a, source, after=forward['next_cursor'])['messages']] == [
        'receipt:'+second['id'], '14', '15']
    assert [m['id'] for m in store.history_page(a, source, after_ref_seq=forward['messages'][-1]['ref_seq'])['messages']] == [
        'receipt:'+second['id'], '14', '15']
    assert store.history_page(b, source)['messages'][0]['id'] == '12'


def test_new_arrival_during_backward_paging_no_duplicates_or_skip(tmp_path):
    store, source, a, _, first, second = fixture(tmp_path)
    latest = store.history_page(a, source, latest=True, limit=2)
    with sqlite3.connect(source) as db:
        db.execute("INSERT INTO messages VALUES (16,'a','user','new',NULL,NULL)")
    store.record_turn(a, 't4', [('a', 16, 'user')])
    older = store.history_page(a, source, before=latest['older_cursor'], limit=3)
    assert [m['id'] for m in older['messages']] == ['receipt:'+first['id'], '11', 'receipt:'+second['id']]
    assert older['older_cursor'] is None
    tail = store.history_page(a, source, after_ref_seq=latest['messages'][-1]['ref_seq'])
    assert [m['id'] for m in tail['messages']] == ['16']
    assert store.history_page(a, source, before=latest['older_cursor'], limit=3)['messages'] == older['messages']
    assert [m['id'] for m in store.history_page(a, source, after=older['next_cursor'])['messages']] == [
        '14', '15', '16']


def test_cursor_scope_direction_and_validation(tmp_path):
    store, source, a, b, _, _ = fixture(tmp_path)
    older = store.history_page(a, source, limit=1, latest=True)['older_cursor']
    after = store.history_page(a, source, limit=1)['next_cursor']
    cases = [
        {'before': older, 'latest': True}, {'before': older, 'after': after},
        {'latest': True, 'after_ref_seq': 1}, {'after': after, 'after_ref_seq': 1},
        {'before': after}, {'after': older}, {'before': 'nonsense'}, {'before': ''},
        {'before': Store._older_cursor(a, 99999)}, {'limit': 0}, {'limit': 101},
        {'limit': True}, {'latest': 1}, {'after_ref_seq': True},
    ]
    for kwargs in cases:
        with pytest.raises(ValueError):
            store.history_page(a, source, **kwargs)
    with pytest.raises(ValueError, match='invalid'):
        store.history_page(b, source, before=older)
    with pytest.raises(ValueError, match='invalid'):
        store.history_page(b, source, after=after)
    assert store.history_page(a, source, before=Store._older_cursor(a, 1))['messages'] == []


def test_ambiguous_receipt_link_never_claims_identity(tmp_path):
    store, source, a, _, _, _ = fixture(tmp_path)
    other, _ = store.accept(a, 'send-three', 'same')
    another, _ = store.accept(a, 'send-four', 'same')
    store.link_user_receipt(other['id'], 15)
    store.link_user_receipt(another['id'], 15)
    user = next(m for m in store.history_page(a, source)['messages'] if m['id']=='15')
    assert user['role'] == 'user'
    assert 'receipt_id' not in user and 'client_message_id' not in user


def test_http_capability_auth_scope_and_bad_requests(tmp_path, monkeypatch):
    store, source, a, _, _, second = fixture(tmp_path)
    monkeypatch.setattr(transport, 'get_hermes_home', lambda: tmp_path)
    # Use the real route/middleware; source DB lives at get_hermes_home()/state.db.
    monkeypatch.setenv('HERMES_APP_TOKEN', 'x' * 32)
    owner = object.__new__(transport.HermesAppAdapter)
    owner._store = store
    app = web.Application(middlewares=[transport._authentication])
    app.router.add_get('/v1/capabilities', owner._capabilities)
    app.router.add_get('/v1/threads/{id}/messages', owner._history)

    async def check():
        async with TestClient(TestServer(app)) as client:
            url = f'/v1/threads/{a}/messages'
            assert (await client.get(url)).status == 401
            headers = {'Authorization': 'Bearer ' + 'x' * 32}
            async def get(path):
                return await client.get(path, headers=headers)
            cap = await (await get('/v1/capabilities')).json()
            assert cap['history_latest'] is True and cap['message_send_identity'] is True
            assert cap['history'] is True and cap['protocol'] == 1
            response = await get(url + '?latest=true&limit=2')
            assert response.status == 200
            page = await response.json()
            assert [m['id'] for m in page['messages']] == ['14', '15']
            response = await get(url + '?before=' + page['older_cursor'] + '&limit=2')
            assert response.status == 200
            assert [m['id'] for m in (await response.json())['messages']] == ['11', 'receipt:'+second['id']]
            for query in ('latest=true&after_ref_seq=1', 'latest=true&before=' + page['older_cursor'],
                          'before=invalid', 'latest=false', 'limit=0', 'after_ref_seq=1&before=invalid'):
                assert (await get(url + '?' + query)).status == 400
            assert (await get('/v1/threads/not-a-thread/messages?latest=true')).status == 404
            assert (await get(url + '?latest=true&owner=other')).status == 403
    asyncio.run(check())
