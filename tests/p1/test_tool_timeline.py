"""Public timeline from real pinned-core rows and formal lifecycle hooks."""
import asyncio
import json
import sqlite3

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from hermes_constants import set_hermes_home_override, reset_hermes_home_override
from hermes_state import SessionDB

from hermes_app import adapter
from hermes_app.history_hooks import pre_tool_call, post_tool_call, post_llm_call, pre_auxiliary_call
from hermes_app.projection import visible_text
from hermes_app.storage import Store
from hermes_app.tool_timeline import public_tool_calls


def call(ident, name, args=None):
    return {'id': ident, 'type': 'function', 'function':
            {'name': name, 'arguments': json.dumps(args or {}, ensure_ascii=False)}}


def setup(tmp_path):
    home = tmp_path/'home'
    home.mkdir()
    core = SessionDB(home/'state.db')
    core.create_session('s', 'hermes_app')
    store = Store(home/'hermes-app'/'metadata.sqlite')
    tid = store.create_thread('p', 'topic', 's', '')
    store.begin_turn(tid, 'ingress:rc-one')
    token = set_hermes_home_override(home)
    return home, core, store, tid, token


def test_formal_start_hook_publishes_before_execution_and_no_duplicate(tmp_path):
    home, core, store, tid, token = setup(tmp_path)
    try:
        user = core.append_message('s', 'user', '请查资料', platform_message_id='rc-one')
        calls = [call('c1', 'web_search', {'query': 'Sensor Tower API'}),
                 call('c2', 'terminal', {'command': 'uv run pytest -q'})]
        interim = core.append_message('s', 'assistant', '先查资料。', tool_calls=calls,
                                      finish_reason='tool_calls', reasoning='not public')
        # The model persisted a whole batch before the first tool executes.
        assert store.history_page(tid, home/'state.db')['messages'] == []
        pre_tool_call(turn_id='turn-one', session_id='s', tool_call_id='c1',
                      tool_name='web_search', platform='other_platform')
        assert store.history_page(tid, home/'state.db')['messages'] == []
        pre_tool_call(turn_id='turn-one', session_id='s', tool_call_id='c1',
                      tool_name='web_search', args={'query':'Sensor Tower API'})
        first = store.history_page(tid, home/'state.db')
        assert [m['id'] for m in first['messages']] == [str(user), str(interim)]
        assert first['messages'][1]['text'] == '先查资料。'
        assert first['messages'][1]['tool_calls'] == [
            {'id':'c1','name':'web_search','label':'Search web: Sensor Tower API'},
            {'id':'c2','name':'terminal','label':'Run command','detail':'uv run pytest -q'}]
        assert 'query' not in json.dumps(first, ensure_ascii=False)  # no raw argument object
        assert 'not public' not in json.dumps(first, ensure_ascii=False)
        pre_tool_call(turn_id='turn-one', session_id='s', tool_call_id='c2')
        post_tool_call(turn_id='turn-one', session_id='s', tool_call_id='c1', result='private result')
        assert store.history_page(tid, home/'state.db') == first

        tool_only = core.append_message('s', 'assistant', '', tool_calls=[call('c3','search_files', {'pattern':'secret'})],
                                        finish_reason='tool_calls')
        pre_tool_call(turn_id='turn-one', session_id='s', tool_call_id='c3')
        during = store.history_page(tid, home/'state.db')
        assert [(m['id'],m['text']) for m in during['messages']] == [
            (str(user),'请查资料'), (str(interim),'先查资料。'), (str(tool_only),'')]
        assert during['messages'][2]['tool_calls'] == [
            {'id':'c3','name':'search_files','label':'Search files','detail':'pattern=secret'}]
        final = core.append_message('s','assistant','已完成。',finish_reason='stop')
        post_llm_call(platform='hermes_app',session_id='s',turn_id='turn-one',conversation_history=[
            {'role':'user','content':'请查资料','_row_id':user},
            {'role':'assistant','content':'先查资料。','tool_calls':calls,'_row_id':interim},
            {'role':'assistant','content':'','tool_calls':[call('c3','search_files')],'_row_id':tool_only},
            {'role':'assistant','content':'已完成。','_row_id':final}])
        page = store.history_page(tid, home/'state.db')
        assert [m['id'] for m in page['messages']] == list(map(str,[user,interim,tool_only,final]))
        assert page['messages'][-1]['text'] == '已完成。'
        assert store.history_page(tid, home/'state.db',after_ref_seq=during['messages'][-1]['ref_seq'])['messages'] == [page['messages'][-1]]
        assert [m['id'] for m in store.history_page(tid,home/'state.db',latest=True,limit=2)['messages']] == list(map(str,[tool_only,final]))
        assert store.search_page(tid,home/'state.db','Search files')['messages'] == [
            {k:page['messages'][2][k] for k in ('id','ref_seq','role','text','tool_calls')}]
        # Re-read from a fresh Store after a reconnect; do not infer missing older refs.
        assert Store(store.path).history_page(tid,home/'state.db')['messages'] == page['messages']
    finally:
        core.close()
        reset_hermes_home_override(token)


def test_tool_only_fallback_compression_and_hidden(tmp_path):
    home, core, store, tid, token = setup(tmp_path)
    try:
        u = core.append_message('s','user','start',platform_message_id='rc-one')
        c = call('one','terminal',{'command':'git status --short'})
        a = core.append_message('s','assistant','',tool_calls=[c],finish_reason='tool_calls')
        # Pre hook absent: post hook still captures the original assistant.
        post_tool_call(turn_id='t',session_id='s',tool_call_id='one')
        assert [m['id'] for m in store.history_page(tid,home/'state.db')['messages']] == [str(u),str(a)]
        assert store.history_page(tid,home/'state.db')['messages'][-1]['tool_calls'][0]['detail'] == 'git status --short'
        pre_auxiliary_call(platform='hermes_app',aux_task='compression',turn_id='t',session_id='s')
        with sqlite3.connect(home/'state.db') as db:
            db.execute('UPDATE messages SET active=0 WHERE id=?',(a,))
        assert [m['id'] for m in store.history_page(tid,home/'state.db')['messages']] == [str(u),str(a)]
        hidden = core.append_message('s','assistant','',tool_calls=[c],display_kind='hidden')
        carrier = core.append_message('s','assistant','',tool_calls=[c],_compressed_summary=True)
        with sqlite3.connect(home/'state.db') as db:
            rows = [dict(zip([x[0] for x in db.execute('SELECT * FROM messages LIMIT 1').description], row))
                    for row in db.execute('SELECT * FROM messages WHERE id IN (?,?)',(hidden,carrier))]
        assert all(visible_text(row) is None for row in rows)
        assert visible_text({'role':'assistant','content':'','tool_calls':'not json'}) is None
        assert visible_text({'role':'assistant','content':'valid','tool_calls':'not json','display_metadata':'{'}) == 'valid'
    finally:
        core.close()
        reset_hermes_home_override(token)


def test_command_privacy_unknown_parallel_and_overflow(monkeypatch):
    monkeypatch.setenv('HERMES_REDACT_SECRETS','false')
    secret = 'topsecretunsafe987'
    bad = [f'curl -H "Authorization: Bearer {secret}" https://example.org',
           f'API_TOKEN={secret} python script.py', f'curl --password={secret} https://example.org',
           f'curl https://example.org/?foo={secret}', f'curl -u bob:{secret} example.org',
           f'python script.py --api-key={secret}', f'python script.py --auth={secret}',
           'python -m pytest ' + 'x'*4001]
    for command in bad:
        projected = public_tool_calls({'tool_calls':[call('t','terminal',{'command':command})]})
        assert 'detail' not in projected[0], command[:55]
    assert public_tool_calls({'tool_calls':[call('p','multi_tool_use.parallel',{'tool_uses':[
        {'recipient_name':'terminal','parameters':{'command':secret}}]})]}) == [
            {'id':'p','name':'multi_tool_use.parallel','label':'Run tools in parallel'}]
    assert public_tool_calls({'tool_calls':[call('u','custom_sensitive',{'password':secret})]}) == [
            {'id':'u','name':'custom_sensitive','label':'custom_sensitive'}]
    assert public_tool_calls({'tool_calls':[call('bad','terminal','not dict')]}) == [
            {'id':'bad','name':'terminal','label':'Run command'}]
    assert public_tool_calls({'tool_calls':'not json'}) == []
    assert public_tool_calls({'tool_calls':[call('😀'*101, 'web_search')]}) == []
    assert 'detail' not in public_tool_calls({'tool_calls':[
        call('emoji','terminal',{'command':'python -m pytest ' + '😀'*2000})]})[0]
    projected = public_tool_calls({'tool_calls':[call(str(i),'web_search') for i in range(131)]})
    assert len(projected) == 128
    assert projected[-1] == {'id':'127','name':'web_search','label':'This and 3 more tool calls are not shown individually'}


def test_http_history_search_same_schema(tmp_path, monkeypatch):
    home, core, store, tid, token = setup(tmp_path)
    try:
        monkeypatch.setenv('HERMES_APP_TOKEN','x'*32)
        monkeypatch.setattr(adapter,'get_hermes_home',lambda: home)
        u=core.append_message('s','user','ask',platform_message_id='rc-one')
        a=core.append_message('s','assistant','',tool_calls=[call('c','read_file')],finish_reason='tool_calls')
        pre_tool_call(turn_id='t',session_id='s',tool_call_id='c')
        owner=object.__new__(adapter.HermesAppAdapter)
        owner._store=store
        app=web.Application(middlewares=[adapter._authentication])
        app.router.add_get('/v1/threads/{id}/messages',owner._history)
        app.router.add_get('/v1/threads/{id}/search',owner._search)
        async def probe():
            async with TestServer(app) as server:
                async with TestClient(server) as client:
                    headers={'Authorization':'Bearer '+'x'*32}
                    history=await client.get(f'/v1/threads/{tid}/messages',headers=headers)
                    search=await client.get(f'/v1/threads/{tid}/search?q=Read file',headers=headers)
                    assert history.status == search.status == 200
                    messages=(await history.json())['messages']
                    hits=(await search.json())['messages']
                    assert [m['id'] for m in messages] == list(map(str,[u,a]))
                    assert hits[0]['tool_calls'] == messages[-1]['tool_calls']
                    assert hits[0]['text'] == messages[-1]['text'] == ''
        asyncio.run(probe())
    finally:
        core.close()
        reset_hermes_home_override(token)
