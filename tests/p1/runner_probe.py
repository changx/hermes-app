"""Child process: real plugin manager + GatewayRunner, isolated synthetic provider."""
import asyncio
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import aiohttp

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
HOME = Path(os.environ['HERMES_HOME'])
COMPACT_MODE = os.environ.get('P1_COMPACT_MODE', 'inplace')
assert COMPACT_MODE in ('inplace', 'idle', 'rotate', 'preflight', 'midturn', 'timeline', 'failed', 'race')
assert str(BASE) in __import__('sys').path
assert os.environ['HOME'] == str(HOME.parent)


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append(request)
        if COMPACT_MODE == 'failed' and 'P1_FAIL' in json.dumps(request.get('messages', [])):
            data = b'{"error":{"message":"synthetic local failure","type":"invalid_request_error"}}'
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        answer = 'SYNTHETIC_P1_FINAL'
        usage_prompt = (max(30, len(json.dumps(request.get('messages', []))) // 4)
                        if COMPACT_MODE in ('preflight', 'midturn') else 30)
        call_tool = (COMPACT_MODE in ('midturn', 'timeline') and
                     self.server.tool_calls < (1 if COMPACT_MODE == 'timeline' else 3)
                     and any('p1_synthetic_expand' in json.dumps(t) for t in request.get('tools', []))
                     and ('P1_MIDTURN' if COMPACT_MODE == 'midturn' else 'P1_TIMELINE')
                     in json.dumps(request.get('messages', [])))
        if call_tool:
            self.server.tool_calls += 1
            answer = '' if COMPACT_MODE == 'timeline' else f'P1_INTERIM_{self.server.tool_calls}'
        tool_call = {'index':0,'id':f'p1_call_{self.server.tool_calls}','type':'function',
                     'function':{'name':'p1_synthetic_expand','arguments':'{}'}}
        if request.get('stream'):
            chunks = [
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{'role':'assistant','content':answer},'finish_reason':None}]},
                *([{'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{'tool_calls':[tool_call]},'finish_reason':None}]}] if call_tool else []),
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if call_tool else 'stop'}], 'usage':{'prompt_tokens':usage_prompt,'completion_tokens':5,'total_tokens':usage_prompt+5}},
            ]
            data = b''.join(b'data: ' + json.dumps(c).encode() + b'\n\n' for c in chunks) + b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            data = json.dumps({'id':'s','object':'chat.completion','model':'p1-local',
                'choices':[{'index':0,'message':{'role':'assistant','content':answer,
                    **({'tool_calls':[{k:v for k,v in tool_call.items() if k != 'index'}]} if call_tool else {})},
                    'finish_reason':'tool_calls' if call_tool else 'stop'}],
                'usage':{'prompt_tokens':usage_prompt,'completion_tokens':5,'total_tokens':usage_prompt+5}}).encode()
            mime = 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def self_description_calls(home):
    with sqlite3.connect(home/'hermes-app'/'metadata.sqlite') as db:
        return tuple(r[0] for r in db.execute('SELECT initialized FROM threads ORDER BY title'))


async def main():
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from hermes_cli.plugins import get_plugin_manager
    from gateway.platform_registry import platform_registry
    from gateway.run import GatewayRunner
    from gateway.config import Platform
    from hermes_state import SessionDB

    shutil.copytree(PLUGIN, HOME / 'plugins' / 'hermes-app')
    shutil.copytree(Path(__file__).with_name('synthetic_tool_plugin'), HOME/'plugins'/'p1-synthetic-tool')
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    model.requests = []
    model.tool_calls = 0
    worker = threading.Thread(target=model.serve_forever, daemon=True)
    worker.start()
    (HOME / 'config.yaml').write_text(
        'model:\n  provider: custom\n  default: p1-local\n  context_length: 65536\n'
        f'  base_url: http://127.0.0.1:{model.server_port}/v1\n'
        f'compression:\n  enabled: true\n  in_place: {str(COMPACT_MODE != "rotate").lower()}\n'
        f'  threshold_tokens: {2300 if COMPACT_MODE == "midturn" else 2400 if COMPACT_MODE == "preflight" else 20000}\n'
        '  protect_first_n: 1\n  protect_last_n: 2\n  tail_mode: legacy\n'
        f'  idle_compact_after_seconds: {1 if COMPACT_MODE == "idle" else 0}\n'
        'auxiliary:\n  title_generation:\n    enabled: false\n'
        'security:\n  tirith_enabled: false\n'
        f'platform_toolsets:\n  hermes_app: {"[p1_synthetic]" if COMPACT_MODE in ("midturn", "timeline") else "[]"}\n'
        'tools:\n  tool_search:\n    enabled: "off"\n'
        'agent:\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
        'plugins:\n  enabled: [hermes-app, p1-synthetic-tool]\n'
        'gateway:\n  multiplex_profiles: false\n  loop_watchdog: false\n'
        '  platforms:\n    hermes_app:\n'
        f"      enabled: {str(os.environ.get('P1_DISABLED') != '1').lower()}\n"
        '      typing_indicator: false\n')
    (HOME / '.env').write_text('OPENAI_API_KEY=synthetic-local-no-credential\n')
    home_token = set_hermes_home_override(HOME)
    manager, runner = get_plugin_manager(), None
    try:
        manager.discover_and_load()
        assert platform_registry.get('hermes_app').plugin_name == 'hermes-app'
        runner = GatewayRunner()
        # This fixture already has a home target; native onboarding notices are
        # tested separately rather than altering every model-history assertion.
        from gateway.config import HomeChannel
        runner.config.platforms[Platform('hermes_app')].home_channel = HomeChannel(
            Platform('hermes_app'), 'synthetic-home', 'Synthetic home')
        if os.environ.get('P1_DISABLED') == '1':
            assert not runner.config.platforms[Platform('hermes_app')].enabled
            assert await asyncio.wait_for(runner.start(), 45)
            assert Platform('hermes_app') not in runner.adapters
            await asyncio.wait_for(runner.stop(), 45)
            runner = None
            (HOME.parent/'runner-disabled-result.json').write_text(json.dumps({
                'registered':True, 'disabled_adapter_absent':True,
                'other_gateway_started':True, 'synthetic_model_requests':len(model.requests)}, sort_keys=True))
            return
        assert runner.config.platforms[Platform('hermes_app')].enabled
        assert await asyncio.wait_for(runner.start(), 45)
        adapter = runner.adapters[Platform('hermes_app')]
        assert adapter._message_handler is not None
        port = adapter.port
        root = f'http://127.0.0.1:{port}'
        async with aiohttp.ClientSession() as client:
            async with client.get(root + '/v1/capabilities') as response:
                assert response.status == 401
            async with client.get(root + '/v1/capabilities', headers={'Authorization':'Bearer bad'}) as response:
                assert response.status == 401
            headers = {'Authorization':'Bearer ' + os.environ['HERMES_APP_TOKEN']}
            async with client.get(root + '/v1/capabilities?profile=other', headers=headers) as response:
                assert response.status == 403
            async with client.ws_connect(root.replace('http:', 'ws:') + '/v1/events') as ws:
                assert False, 'unauthenticated websocket connected'
        # This point intentionally unreachable if WebSocket auth works.
    except aiohttp.WSServerHandshakeError as exc:
        assert exc.status == 401
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+os.environ['HERMES_APP_TOKEN']}) as a, aiohttp.ClientSession(headers={'Authorization':'Bearer '+os.environ['HERMES_APP_TOKEN']}) as b:
            async with a.get(root+'/v1/capabilities') as resp:
                caps = await resp.json(); assert resp.status == 200 and caps['durable_accept'] is True
            ws1 = await a.ws_connect(root.replace('http:','ws:')+'/v1/events')
            ws2 = await b.ws_connect(root.replace('http:','ws:')+'/v1/events')
            assert (await ws1.receive_json())['type'] == 'hello'
            assert (await ws2.receive_json())['type'] == 'hello'
            await ws1.send_str('ping'); assert (await ws1.receive_str()) == 'pong'
            async with a.post(root+'/v1/channels', json={'name':'Project A','description':'P1_DESC_A'}) as resp:
                assert resp.status == 201, await resp.text(); channel = (await resp.json())['channel']
            async with b.post(root+f"/v1/channels/{channel['id']}/threads", json={'title':'One'}) as resp:
                assert resp.status == 201, await resp.text(); one = (await resp.json())['thread']
            async with a.post(root+f"/v1/channels/{channel['id']}/threads", json={'title':'Two'}) as resp:
                assert resp.status == 201, await resp.text(); two = (await resp.json())['thread']
            async with b.get(root+f"/v1/threads/{one['id']}") as resp:
                assert resp.status == 200 and (await resp.json())['thread']['session_id'] == one['session_id']
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_FIRST'}) as resp:
                assert resp.status == 202, await resp.text(); assert (await resp.json())['receipt']['durable'] is True
            async with b.post(root+f"/v1/threads/{two['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_OTHER'}) as resp:
                assert resp.status == 202, await resp.text()
            for _ in range(100):
                if len(model.requests) >= 2:
                    break
                await asyncio.sleep(.2)
            assert len(model.requests) >= 2, len(model.requests)
            by_user = {('P1_FIRST' if 'P1_FIRST' in json.dumps(x) else 'P1_OTHER'):x for x in model.requests if 'P1_FIRST' in json.dumps(x) or 'P1_OTHER' in json.dumps(x)}
            assert all('P1_DESC_A' in json.dumps(by_user[k]) for k in ('P1_FIRST','P1_OTHER'))
            assert one['session_id'] != two['session_id']
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=20") as resp:
                    history_status = resp.status
                    if history_status == 200:
                        first_history = await resp.json()
                        if len(first_history['messages']) == 2 and not first_history['incomplete_turns']:
                            break
                await asyncio.sleep(.2)
            assert history_status == 200, history_status
            assert [(m['role'], m['text']) for m in first_history['messages']] == [
                ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL')], first_history
            if COMPACT_MODE == 'timeline':
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':uuid.uuid4().hex,'text':'P1_TIMELINE'}) as resp:
                    assert resp.status == 202, await resp.text()
                try:
                    for _ in range(100):
                        if (HOME/'timeline-tool-entered').exists():
                            break
                        await asyncio.sleep(.05)
                    assert (HOME/'timeline-tool-entered').exists(), 'real tool handler never started'
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        during = await resp.json()
                        assert resp.status == 200
                    interim = during['messages'][-1]
                    assert [(m['role'],m['text']) for m in during['messages'][-2:]] == [
                        ('user','P1_TIMELINE'),('assistant','')], during
                    assert interim['tool_calls'] == [{'id':'p1_call_1','name':'p1_synthetic_expand',
                                                       'label':'p1_synthetic_expand'}], during
                    assert during['incomplete_turns']
                    with sqlite3.connect(HOME/'state.db') as raw:
                        raw.row_factory = sqlite3.Row
                        original = raw.execute('SELECT * FROM messages WHERE id=?',(int(interim['id']),)).fetchone()
                        assert original and original['role'] == 'assistant'
                        assert json.loads(original['tool_calls'])[0]['id'] == 'p1_call_1'
                finally:
                    (HOME/'timeline-tool-release').write_text('1')
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        after = await resp.json()
                        if (resp.status == 200 and not after['incomplete_turns'] and
                                len(after['messages']) == len(during['messages']) + 1):
                            break
                    await asyncio.sleep(.1)
                assert [(m['id'],m['ref_seq'],m['text'],m.get('tool_calls'))
                        for m in after['messages'][:len(during['messages'])]] == [
                        (m['id'],m['ref_seq'],m['text'],m.get('tool_calls'))
                        for m in during['messages']], after
                assert after['messages'][-1]['text'] == 'SYNTHETIC_P1_FINAL'
                assert not after['incomplete_turns']
                (HOME.parent/'runner-timeline-result.json').write_text(json.dumps({
                    'published_during_handler':True, 'core_row_id':interim['id'],
                    'tool_call_id':interim['tool_calls'][0]['id'],
                    'before':during,'after':after},sort_keys=True))
                return
            if COMPACT_MODE == 'race':
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_RACE'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(100):
                    if (HOME/'race-hook-entered').exists():
                        break
                    await asyncio.sleep(.05)
                assert (HOME/'race-hook-entered').exists()
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    during = await resp.json()
                    assert resp.status == 200
                assert [(m['role'],m['text']) for m in during['messages'][-2:]] == [
                    ('user','P1_RACE'),('assistant','SYNTHETIC_P1_FINAL')], during
                assert during['incomplete_turns'], during
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':uuid.uuid4().hex,'text':'P1_FAST_SECOND'}) as resp:
                    assert resp.status == 202, await resp.text()
                (HOME/'race-hook-release').write_text('1')
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        settled = await resp.json()
                        if resp.status == 200 and not settled['incomplete_turns']:
                            break
                    await asyncio.sleep(.05)
                assert not settled['incomplete_turns']
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':uuid.uuid4().hex,'text':'P1_AFTER_RACE'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        after_race = await resp.json()
                        if resp.status == 200 and len(after_race['messages']) == 8 and not after_race['incomplete_turns']:
                            break
                    await asyncio.sleep(.05)
                assert [(m['role'],m['text']) for m in after_race['messages']] == [
                    ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL'),
                    ('user','P1_RACE'),('assistant','SYNTHETIC_P1_FINAL'),
                    ('user','P1_FAST_SECOND'),('assistant','SYNTHETIC_P1_FINAL'),
                    ('user','P1_AFTER_RACE'),('assistant','SYNTHETIC_P1_FINAL')]
                (HOME.parent/'runner-race-result.json').write_text(json.dumps({
                    'mode':'race','busy_after_post_hook':True,'second_send_status':202,
                    'after_release_exact':True,'during':during,'after':after_race},sort_keys=True))
                return
            if COMPACT_MODE == 'failed':
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_FAIL'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        failed_page = await resp.json()
                        if resp.status == 200 and not failed_page['incomplete_turns'] and failed_page['turn_outcomes']:
                            break
                    await asyncio.sleep(.2)
                with sqlite3.connect(HOME/'state.db') as raw:
                    rows = raw.execute('SELECT id,role,content,display_kind FROM messages WHERE session_id=? ORDER BY id',
                                       (one['session_id'],)).fetchall()
                diagnostic = {'mode':'failed','core_rows':[
                    {'id':r[0], 'role':r[1], 'is_failed_user':r[2]=='P1_FAIL', 'display_kind':r[3]}
                    for r in rows], 'plugin_page':failed_page,
                    'failure_http_requests':sum('P1_FAIL' in json.dumps(r.get('messages',[])) for r in model.requests)}
                (HOME.parent/'runner-failed-attempt.json').write_text(json.dumps(diagnostic,sort_keys=True))
                assert failed_page['turn_outcomes'] and not failed_page['incomplete_turns'], failed_page
                assert any(m['role']=='user' and m['text']=='P1_FAIL' for m in failed_page['messages']), failed_page
                result = {'mode':'failed','page':failed_page,
                          'synthetic_failure_requests':sum('P1_FAIL' in json.dumps(r.get('messages',[])) for r in model.requests)}
                (HOME.parent/'runner-failed-result.json').write_text(json.dumps(result,sort_keys=True))
                return
            if COMPACT_MODE == 'midturn':
                for index in range(5):
                    seed = f'P1_SEED_{index} ' + 'seed ' * 90
                    async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':seed}) as resp:
                        assert resp.status == 202, await resp.text()
                    for _ in range(100):
                        async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                            seeded_page = await resp.json()
                            if (resp.status == 200 and len(seeded_page['messages']) == 4+index*2
                                    and not seeded_page['incomplete_turns']):
                                break
                        await asyncio.sleep(.2)
                    assert len(seeded_page['messages']) == 4+index*2 and not seeded_page['incomplete_turns']
                mid_before = seeded_page
                requests_before = len(model.requests)
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_MIDTURN'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        mid_page = await resp.json()
                        if resp.status == 200 and not mid_page['incomplete_turns'] and len(mid_page['messages']) >= 17:
                            break
                    await asyncio.sleep(.2)
                events = [json.loads(line) for line in (HOME/'synthetic-events.jsonl').read_text().splitlines()]
                handlers = [e for e in events if e['event'] == 'tool_handler']
                target_turns = {e['turn_id'] for e in handlers if e['turn_id']}
                target_events = [e for e in events if e['turn_id'] in target_turns]
                with sqlite3.connect(HOME/'state.db') as raw:
                    raw.row_factory = sqlite3.Row
                    core_rows = [dict(r) for r in raw.execute(
                        'SELECT id,session_id,role,platform_message_id,active,display_kind,'
                        'substr(content,1,80) AS content FROM messages ORDER BY id')]
                with sqlite3.connect(HOME/'hermes-app'/'metadata.sqlite') as meta:
                    ingress_rows = list(meta.execute('SELECT * FROM turns ORDER BY rowid'))
                post_tool_compression = (len(target_turns) == 1 and
                    any(e['event'] == 'pre_auxiliary_call' and e['aux_task'] == 'compression'
                        and sum(prior['event'] == 'tool_handler' for prior in target_events[:i]) >= 2
                        for i, e in enumerate(target_events)))
                attempt = {'mode':'midturn','tool_called':model.tool_calls == 3,
                           'tool_call_count':model.tool_calls,
                           'handler_called':len(handlers) == 3,
                           'target_turn_ids':sorted(target_turns),
                           'target_events':target_events,
                           'post_tool_compression':post_tool_compression,
                           'auxiliary_tasks':[e['aux_task'] for e in events if e['event']=='pre_auxiliary_call'],
                           'request_count':len(model.requests)-requests_before,
                           'tool_result_wire_chars':[
                               len(str(m.get('content'))) for r in model.requests[requests_before:]
                               for m in r.get('messages', []) if m.get('role') == 'tool'],
                           'tool_result_excerpt':[
                               str(m.get('content'))[:600] for r in model.requests[requests_before:]
                               for m in r.get('messages', []) if m.get('role') == 'tool'],
                           'visible_roles':[m['role'] for m in mid_page['messages']],
                           'visible_row_ids':[m['id'] for m in mid_page['messages']],
                           'core_rows':core_rows,
                           'turn_rows':ingress_rows}
                (HOME.parent/'runner-midturn-attempt.json').write_text(json.dumps(attempt,sort_keys=True))
                assert model.tool_calls == 3, attempt
                assert attempt['handler_called']
                assert post_tool_compression, {
                    'requests':len(model.requests)-requests_before,
                    'wire_roles_and_chars':[[(m.get('role'), len(str(m.get('content')))) for m in r.get('messages', [])]
                                            for r in model.requests[requests_before:]],
                    'page':mid_page}
                assert len(model.requests)-requests_before >= 4
                assert mid_page['messages'][:len(mid_before['messages'])] == mid_before['messages']
                assert [(m['role'],m['text']) for m in mid_page['messages'][-5:]] == [
                    ('user','P1_MIDTURN'),('assistant','P1_INTERIM_1'),
                    ('assistant','P1_INTERIM_2'),('assistant','P1_INTERIM_3'),
                    ('assistant','SYNTHETIC_P1_FINAL')], mid_page
                assert not mid_page['turn_outcomes'] and not mid_page['incomplete_turns'],mid_page
                with sqlite3.connect(HOME/'state.db') as raw:
                    inactive_rows = raw.execute('SELECT COUNT(*) FROM messages WHERE session_id=? AND active=0',
                                                (one['session_id'],)).fetchone()[0]
                assert inactive_rows > 0
                paged, cursor = [], None
                while True:
                    query = '?limit=7' + (f'&after={cursor}' if cursor else '')
                    async with b.get(root+f"/v1/threads/{one['id']}/messages"+query) as resp:
                        assert resp.status == 200
                        item = await resp.json()
                    assert len(item['messages']) <= 7
                    paged.extend(item['messages'])
                    cursor = item['next_cursor']
                    if cursor is None:
                        break
                assert paged == mid_page['messages']
                cold_path = HOME.parent/'cold-midturn.json'
                cold = subprocess.run([sys.executable, '-c',
                    'import json,sys,pathlib;sys.path.insert(0,sys.argv[1]);from hermes_app.storage import Store;'
                    'pathlib.Path(sys.argv[5]).write_text(json.dumps(Store(sys.argv[2]).history_page(sys.argv[3],sys.argv[4],limit=100)))',
                    str(PLUGIN.parent), str(HOME/'hermes-app'/'metadata.sqlite'), one['id'],
                    str(HOME/'state.db'), str(cold_path)], capture_output=True, text=True, timeout=20)
                assert cold.returncode == 0 and json.loads(cold_path.read_text()) == mid_page
                async with b.get(root+f"/v1/threads/{two['id']}/messages?limit=100") as resp:
                    assert resp.status == 200
                    branch = await resp.json()
                assert not {m['id'] for m in branch['messages']} & {m['id'] for m in mid_page['messages']}
                assert self_description_calls(HOME) == (1, 1)
                result = {'mode':'midturn','tool_called':model.tool_calls == 3,
                          'tool_call_count':model.tool_calls,
                          'post_tool_compression':post_tool_compression,
                          'target_turn_ids':sorted(target_turns),
                          'target_events':target_events,
                          'handler_called':attempt['handler_called'],
                          'summary_http_count':sum('compress' in str(t).lower() for t in attempt['auxiliary_tasks']),
                          'history_exact':True,
                          'inactive_core_rows':inactive_rows,'bounded_pages_exact':True,
                          'cold_exact':True,'branch_excluded':True,
                          'description_init_once':True,
                          'before':mid_before,
                          'model_requests_during_turn':len(model.requests)-requests_before,
                          'messages':mid_page}
                (HOME.parent/'runner-midturn-result.json').write_text(json.dumps(result,sort_keys=True))
                return
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_SECOND'}) as resp:
                assert resp.status == 202, await resp.text()
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    second_page = await resp.json()
                    if resp.status == 200 and len(second_page['messages']) == 4 and not second_page['incomplete_turns']:
                        break
                await asyncio.sleep(.2)
            assert len(second_page['messages']) == 4 and not second_page['incomplete_turns'], second_page
            second = next(x for x in model.requests if 'P1_SECOND' in json.dumps(x))
            assert json.dumps(second).count('P1_DESC_A') == 1
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    page = await resp.json()
                    if resp.status == 200 and len(page['messages']) == 4 and not page['incomplete_turns']:
                        break
                await asyncio.sleep(.2)
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_FIRST'}) as resp:
                assert resp.status == 202, await resp.text()
            expected = [('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL'),
                        ('user','P1_SECOND'),('assistant','SYNTHETIC_P1_FINAL'),
                        ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL')]
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    page = await resp.json()
                    if resp.status == 200 and len(page['messages']) == len(expected) and not page['incomplete_turns']:
                        break
                await asyncio.sleep(.2)
            def model_messages(page):
                # Native preflight warnings are real direct replies, not model
                # transcript rows; keep checking both kinds separately.
                return [m for m in page['messages'] if
                        COMPACT_MODE != 'preflight' or m.get('display_kind') != 'direct']
            for index in range(6):
                bulk = f'P1_BULK_{index} ' + 'alpha beta gamma delta '*60
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':bulk}) as resp:
                    assert resp.status == 202, await resp.text()
                expected.extend([('user',bulk),('assistant','SYNTHETIC_P1_FINAL')])
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        page = await resp.json()
                        if resp.status == 200 and len(model_messages(page)) == len(expected) and not page['incomplete_turns']:
                            break
                    await asyncio.sleep(.2)
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        before_page = await resp.json()
                        if len(model_messages(before_page)) == len(expected) and not before_page['incomplete_turns']:
                            break
                await asyncio.sleep(.2)
            assert [(m['role'],m['text']) for m in model_messages(before_page)] == expected, before_page
            preflight_model_calls = len(model.requests)-10
            if COMPACT_MODE == 'preflight':
                from run_agent import AIAgent
                verifier = AIAgent(api_key='synthetic-local-no-credential',
                    base_url=f'http://127.0.0.1:{model.server_port}/v1', model='p1-local',
                    provider='custom', platform='hermes_app', quiet_mode=True,
                    skip_context_files=True, skip_memory=True, session_id=one['session_id'])
                effective_threshold = verifier.context_compressor.threshold_tokens
                assert effective_threshold == 2400, effective_threshold
                assert preflight_model_calls > 0, ('no automatic summary HTTP request', len(model.requests))
                assert not before_page['incomplete_turns']
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_AFTER_AUTO'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        after_auto = await resp.json()
                        if (resp.status == 200 and len(model_messages(after_auto)) == len(expected)+2
                                and not after_auto['incomplete_turns']):
                            break
                    await asyncio.sleep(.2)
                assert [(m['role'],m['text']) for m in model_messages(after_auto)] == expected + [
                    ('user','P1_AFTER_AUTO'),('assistant','SYNTHETIC_P1_FINAL')]
                assert len({m['id'] for m in after_auto['messages']}) == len(after_auto['messages'])
                with sqlite3.connect(HOME/'state.db') as raw:
                    inactive_rows = raw.execute('SELECT COUNT(*) FROM messages WHERE session_id=? AND active=0',
                                                (one['session_id'],)).fetchone()[0]
                assert inactive_rows > 0, 'automatic compression did not retire active core rows'
                cold_path = HOME.parent/'cold-preflight.json'
                cold = subprocess.run([sys.executable, '-c',
                    'import json,sys,pathlib;sys.path.insert(0,sys.argv[1]);from hermes_app.storage import Store;'
                    'pathlib.Path(sys.argv[5]).write_text(json.dumps(Store(sys.argv[2]).history_page(sys.argv[3],sys.argv[4],limit=100)))',
                    str(PLUGIN.parent), str(HOME/'hermes-app'/'metadata.sqlite'), one['id'],
                    str(HOME/'state.db'), str(cold_path)], capture_output=True, text=True, timeout=20)
                assert cold.returncode == 0 and cold_path.exists(), cold.stderr
                assert json.loads(cold_path.read_text()) == after_auto
                next_request = next(x for x in model.requests if 'P1_AFTER_AUTO' in json.dumps(x))
                assert json.dumps(next_request).count('P1_DESC_A') <= 1
                events = [json.loads(line) for line in (HOME/'synthetic-events.jsonl').read_text().splitlines()]
                summary_count = sum(e['event']=='pre_auxiliary_call' and
                                    'compress' in str(e['aux_task']).lower() for e in events)
                assert summary_count > 0, events
                result = {'mode':'preflight', 'effective_threshold':effective_threshold,
                          'summary_http_count':summary_count,
                          'summary_http_count_min':preflight_model_calls, 'before':before_page,
                          'after_next':after_auto, 'inactive_core_rows':inactive_rows,
                          'cold_exact':True,
                          'description_count_next_request':json.dumps(next_request).count('P1_DESC_A')}
                (HOME.parent / 'runner-preflight-result.json').write_text(json.dumps(result, sort_keys=True))
                return
            original_ids = [m['id'] for m in before_page['messages']]
            async with a.get(root+f"/v1/threads/{one['id']}/messages?limit=2") as resp:
                assert resp.status == 200
                page1 = await resp.json()
            assert len(page1['messages']) == 2 and page1['next_cursor']
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=2&after={page1['next_cursor']}") as resp:
                assert resp.status == 200
                page2 = await resp.json()
            assert [m['id'] for m in page1['messages']+page2['messages']] == original_ids[:4]
            # Compress after real gateway turns, then continue through the gateway.
            from run_agent import AIAgent
            from agent.conversation_loop import _restore_or_build_system_prompt
            writer = SessionDB(db_path=HOME/'state.db')
            compressor = AIAgent(api_key='synthetic-local-no-credential',
                base_url=f'http://127.0.0.1:{model.server_port}/v1', model='p1-local',
                provider='custom', platform='hermes_app', quiet_mode=True,
                skip_context_files=True, skip_memory=True, session_id=one['session_id'], session_db=writer)
            prior = writer.get_messages_as_conversation(one['session_id'])
            _restore_or_build_system_prompt(compressor, None, prior)
            requests_before_compaction = len(model.requests)
            if COMPACT_MODE == 'idle':
                from agent.turn_context_compaction import CompactionOutcome, _idle_compaction
                compressor._last_activity_ts = time.time()-3600
                outcome = CompactionOutcome(messages=prior,
                    active_system_prompt=compressor._cached_system_prompt,
                    conversation_history=prior,current_turn_user_idx=len(prior)-1)
                _idle_compaction(compressor, outcome, None, 'P1_BULK_5', 'p1-runtime-idle')
            else:
                compressor._compress_context(prior, None, approx_tokens=15000, task_id='p1-runtime', force=True)
            compaction_model_calls = len(model.requests)-requests_before_compaction
            assert compaction_model_calls > 0, 'compaction made no model request'
            if COMPACT_MODE == 'rotate':
                assert compressor.session_id != one['session_id']
            else:
                assert compressor.session_id == one['session_id']
            with sqlite3.connect(HOME/'hermes-app'/'metadata.sqlite') as meta:
                original_core_ids = {r[0] for r in meta.execute(
                    'SELECT row_id FROM message_refs WHERE thread_id=? AND row_id IS NOT NULL', (one['id'],))}
            compaction_new_active_rows = sum(r['id'] not in original_core_ids
                                             for r in writer.get_messages(compressor.session_id))
            assert compaction_new_active_rows > 0
            writer.close()
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                assert resp.status == 200
                compressed_page = await resp.json()
            assert compressed_page == before_page, (before_page, compressed_page)
            async with b.get(root+f"/v1/threads/{one['id']}/search?q=P1_BULK_0&limit=1") as resp:
                assert resp.status == 200, await resp.text()
                search_page = await resp.json()
            assert len(search_page['messages']) == 1 and 'P1_BULK_0' in search_page['messages'][0]['text']
            assert search_page['messages'][0]['ref_seq'] == next(
                m['ref_seq'] for m in before_page['messages'] if 'P1_BULK_0' in m['text'])
            async with b.get(root+f"/v1/threads/{one['id']}/search?q=P1_DESC_A&limit=1") as resp:
                assert resp.status == 200 and not (await resp.json())['messages']
            assert [m['id'] for m in adapter._store.history_page(
                one['id'], HOME/'state.db', limit=100)['messages']] == original_ids
            if COMPACT_MODE == 'rotate':
                from agent.conversation_loop import run_conversation
                continuation_db = SessionDB(db_path=HOME/'state.db')
                continuation = AIAgent(api_key='synthetic-local-no-credential',
                    base_url=f'http://127.0.0.1:{model.server_port}/v1', model='p1-local',
                    provider='custom', platform='hermes_app', quiet_mode=True,
                    skip_context_files=True, skip_memory=True, session_id=compressor.session_id,
                    parent_session_id=one['session_id'], session_db=continuation_db)
                history = continuation_db.get_messages_as_conversation(compressor.session_id)
                turn_result = await asyncio.to_thread(run_conversation, continuation,
                    'P1_AFTER_COMPACT', conversation_history=history)
                assert turn_result['final_response'] == 'SYNTHETIC_P1_FINAL', turn_result
                continuation_db.close()
            else:
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_AFTER_COMPACT'}) as resp:
                    assert resp.status == 202, await resp.text()
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        after_page = await resp.json()
                        if len(after_page['messages']) == len(expected)+2 and not after_page['incomplete_turns']:
                            break
                await asyncio.sleep(.2)
            assert [m['id'] for m in after_page['messages'][:len(original_ids)]] == original_ids
            assert [(m['role'],m['text']) for m in after_page['messages']] == expected + [
                ('user','P1_AFTER_COMPACT'),('assistant','SYNTHETIC_P1_FINAL')]
            cold_path = HOME.parent / 'cold-page.json'
            cold = subprocess.run([sys.executable, '-c',
                'import json,sys,pathlib;sys.path.insert(0,sys.argv[1]);from hermes_app.storage import Store;'
                'pathlib.Path(sys.argv[5]).write_text(json.dumps(Store(sys.argv[2]).history_page(sys.argv[3],sys.argv[4],limit=100)))',
                str(PLUGIN.parent), str(HOME/'hermes-app'/'metadata.sqlite'),
                one['id'], str(HOME/'state.db'), str(cold_path)], capture_output=True, text=True, timeout=20)
            assert cold.returncode == 0, cold.stderr
            assert cold_path.exists(), cold.stderr
            cold_page = json.loads(cold_path.read_text())
            assert cold_page == after_page
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{two['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        branch_page = await resp.json()
                        if len(branch_page['messages']) == 2 and not branch_page['incomplete_turns']:
                            break
                await asyncio.sleep(.2)
            assert [(m['role'],m['text']) for m in branch_page['messages']] == [
                ('user','P1_OTHER'),('assistant','SYNTHETIC_P1_FINAL')]
            assert not {m['id'] for m in branch_page['messages']} & {m['id'] for m in after_page['messages']}
            assert self_description_calls(HOME) == (1, 1)
            async with a.patch(root+f"/v1/channels/{channel['id']}", json={'description':'P1_DESC_B'}) as resp:
                assert resp.status == 200, await resp.text()
            async with b.post(root+f"/v1/channels/{channel['id']}/threads", json={'title':'Three'}) as resp:
                assert resp.status == 201, await resp.text(); three = (await resp.json())['thread']
            async with b.post(root+f"/v1/threads/{three['id']}/messages", json={'client_message_id':uuid.uuid4().hex,'text':'P1_THIRD'}) as resp:
                assert resp.status == 202, await resp.text()
            for _ in range(100):
                if any('P1_THIRD' in json.dumps(x) for x in model.requests):
                    break
                await asyncio.sleep(.2)
            third = next(x for x in model.requests if 'P1_THIRD' in json.dumps(x))
            assert 'P1_DESC_B' in json.dumps(third) and 'P1_DESC_A' not in json.dumps(third)
            db = SessionDB(db_path=HOME/'state.db', read_only=True)
            try:
                for _ in range(100):
                    rows = [db.get_messages(t['session_id']) for t in (one,two,three)]
                    actual = [[r['content'] for r in group if r['role']=='user'] for group in rows]
                    if actual[1:] == [['P1_OTHER'],['P1_THIRD']]:
                        break
                    await asyncio.sleep(.2)
                assert actual[1:] == [['P1_OTHER'],['P1_THIRD']], actual
            finally:
                db.close()
            async with a.delete(root+f"/v1/threads/{three['id']}") as resp:
                assert resp.status == 200 and (await resp.json())['thread']['archived'] == 1
            with sqlite3.connect(HOME/'hermes-app'/'metadata.sqlite') as meta:
                original_row = meta.execute('SELECT row_id FROM message_refs WHERE seq=?',
                    (before_page['messages'][0]['ref_seq'],)).fetchone()[0]
            with sqlite3.connect(HOME/'state.db') as raw:
                raw.execute('DELETE FROM messages WHERE id=?', (original_row,))
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                deleted_source_status = resp.status
                assert deleted_source_status == 409 and 'unavailable' in await resp.text()
            result = {'runner':type(runner).__name__, 'adapter':type(adapter).__name__,
                'two_clients':True, 'auth_http_ws':True, 'profile_rejected':True,
                'model_requests':len(model.requests), 'initial_description':True,
                'volatile_receipt':True, 'second_turn_description_once':True,
                'channel_change_new_thread_only':True, 'thread_raw_isolation':True,
                'thread_archive':True,
                'history_status':history_status, 'history_original_ids':original_ids,
                'history_page_exact':True, 'history_after_compaction_exact':True,
                'history_after_next_turn_exact':True, 'repeated_text_distinct':True,
                'cold_reopen_exact':True, 'branch_excluded':True,
                'deleted_source_status':deleted_source_status,
                'compaction_mode':COMPACT_MODE,
                'preflight_model_calls':preflight_model_calls,
                'compaction_model_calls':compaction_model_calls,
                'compaction_new_active_rows':compaction_new_active_rows,
                'history_validation':{'before':before_page,'compressed':compressed_page,
                    'after_next':after_page,'page1':page1,'page2':page2,
                    'cold':cold_page,'branch':branch_page}}
            await asyncio.wait_for(runner.stop(), 45)
            runner = None
            for ws in (ws1,ws2):
                for _ in range(200):
                    item=await asyncio.wait_for(ws.receive(),3)
                    if item.type in (aiohttp.WSMsgType.CLOSE,aiohttp.WSMsgType.CLOSED):
                        break
                else:
                    raise AssertionError('socket did not close after buffered replay')
            result['websockets_closed'] = True
            try:
                await a.get(root+'/v1/capabilities', timeout=aiohttp.ClientTimeout(total=2))
                raise AssertionError('listener survived stop')
            except aiohttp.ClientConnectorError:
                result['listener_closed'] = True
        (HOME.parent / f'runner-{COMPACT_MODE}-result.json').write_text(json.dumps(result, sort_keys=True))
    finally:
        if runner:
            await runner.stop()
        manager.unload()
        reset_hermes_home_override(home_token)
        model.shutdown(); model.server_close(); worker.join(5)
        assert not worker.is_alive()


if __name__ == '__main__':
    asyncio.run(main())
