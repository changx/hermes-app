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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import aiohttp

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
HOME = Path(os.environ['HERMES_HOME'])
COMPACT_MODE = os.environ.get('P1_COMPACT_MODE', 'inplace')
assert COMPACT_MODE in ('inplace', 'idle', 'rotate')
assert str(BASE) in __import__('sys').path
assert os.environ['HOME'] == str(HOME.parent)


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append(request)
        answer = 'SYNTHETIC_P1_FINAL'
        usage_prompt = 30
        if request.get('stream'):
            chunks = [
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{'role':'assistant','content':answer},'finish_reason':None}]},
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{},'finish_reason':'stop'}], 'usage':{'prompt_tokens':usage_prompt,'completion_tokens':5,'total_tokens':usage_prompt+5}},
            ]
            data = b''.join(b'data: ' + json.dumps(c).encode() + b'\n\n' for c in chunks) + b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            data = json.dumps({'id':'s','object':'chat.completion','model':'p1-local','choices':[{'index':0,'message':{'role':'assistant','content':answer},'finish_reason':'stop'}], 'usage':{'prompt_tokens':usage_prompt,'completion_tokens':5,'total_tokens':usage_prompt+5}}).encode()
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
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    model.requests = []
    worker = threading.Thread(target=model.serve_forever, daemon=True)
    worker.start()
    (HOME / 'config.yaml').write_text(
        'model:\n  provider: custom\n  default: p1-local\n  context_length: 65536\n'
        f'  base_url: http://127.0.0.1:{model.server_port}/v1\n'
        f'compression:\n  enabled: true\n  in_place: {str(COMPACT_MODE != "rotate").lower()}\n'
        '  threshold_tokens_cap: 20000\n'
        '  protect_first_n: 1\n  protect_last_n: 2\n  tail_mode: legacy\n'
        f'  idle_compact_after_seconds: {1 if COMPACT_MODE == "idle" else 0}\n'
        'auxiliary:\n  title_generation:\n    enabled: false\n'
        'security:\n  tirith_enabled: false\n'
        'tools:\n  enabled_toolsets: []\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
        'plugins:\n  enabled: [hermes-app]\n'
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
                caps = await resp.json(); assert resp.status == 200 and caps['durable_accept'] is False
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
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':'P1_FIRST'}) as resp:
                assert resp.status == 202, await resp.text(); assert (await resp.json())['durable'] is False
            async with b.post(root+f"/v1/threads/{two['id']}/messages", json={'text':'P1_OTHER'}) as resp:
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
                        break
                await asyncio.sleep(.2)
            assert history_status == 200, history_status
            assert [(m['role'], m['text']) for m in first_history['messages']] == [
                ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL')], first_history
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':'P1_SECOND'}) as resp:
                assert resp.status == 202, await resp.text()
            for _ in range(100):
                if any('P1_SECOND' in json.dumps(x) for x in model.requests):
                    break
                await asyncio.sleep(.2)
            second = next(x for x in model.requests if 'P1_SECOND' in json.dumps(x))
            assert json.dumps(second).count('P1_DESC_A') == 1
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200 and len((await resp.json())['messages']) == 4:
                        break
                await asyncio.sleep(.2)
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':'P1_FIRST'}) as resp:
                assert resp.status == 202, await resp.text()
            expected = [('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL'),
                        ('user','P1_SECOND'),('assistant','SYNTHETIC_P1_FINAL'),
                        ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL')]
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200 and len((await resp.json())['messages']) == len(expected):
                        break
                await asyncio.sleep(.2)
            for index in range(6):
                bulk = f'P1_BULK_{index} ' + 'alpha beta gamma delta '*60
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':bulk}) as resp:
                    assert resp.status == 202, await resp.text()
                expected.extend([('user',bulk),('assistant','SYNTHETIC_P1_FINAL')])
                for _ in range(100):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        if resp.status == 200 and len((await resp.json())['messages']) == len(expected):
                            break
                    await asyncio.sleep(.2)
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        before_page = await resp.json()
                        if len(before_page['messages']) == len(expected):
                            break
                await asyncio.sleep(.2)
            assert [(m['role'],m['text']) for m in before_page['messages']] == expected, before_page
            preflight_model_calls = len(model.requests)-10
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
            compaction_new_active_rows = sum(r['id'] not in {int(x) for x in original_ids}
                                             for r in writer.get_messages(compressor.session_id))
            assert compaction_new_active_rows > 0
            writer.close()
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                assert resp.status == 200
                compressed_page = await resp.json()
            assert compressed_page == before_page, (before_page, compressed_page)
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
                async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':'P1_AFTER_COMPACT'}) as resp:
                    assert resp.status == 202, await resp.text()
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        after_page = await resp.json()
                        if len(after_page['messages']) == len(expected)+2:
                            break
                await asyncio.sleep(.2)
            assert [m['id'] for m in after_page['messages'][:len(original_ids)]] == original_ids
            assert [(m['role'],m['text']) for m in after_page['messages']] == expected + [
                ('user','P1_AFTER_COMPACT'),('assistant','SYNTHETIC_P1_FINAL')]
            cold = subprocess.run([sys.executable, '-c',
                'import json,sys;sys.path.insert(0,sys.argv[1]);from hermes_app.storage import Store;'
                'print(json.dumps(Store(sys.argv[2]).history_page(sys.argv[3],sys.argv[4],limit=100)))',
                str(PLUGIN.parent), str(HOME/'hermes-app'/'metadata.sqlite'),
                one['id'], str(HOME/'state.db')], capture_output=True, text=True, timeout=20)
            assert cold.returncode == 0, cold.stderr
            cold_page = json.loads(cold.stdout)
            assert cold_page == after_page
            for _ in range(100):
                async with b.get(root+f"/v1/threads/{two['id']}/messages?limit=100") as resp:
                    if resp.status == 200:
                        branch_page = await resp.json()
                        if len(branch_page['messages']) == 2:
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
            async with b.post(root+f"/v1/threads/{three['id']}/messages", json={'text':'P1_THIRD'}) as resp:
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
            with sqlite3.connect(HOME/'state.db') as raw:
                raw.execute('DELETE FROM messages WHERE id=?', (int(original_ids[0]),))
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                deleted_source_status = resp.status
                assert deleted_source_status == 409 and 'original row' in await resp.text()
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
            assert (await asyncio.wait_for(ws1.receive(), 3)).type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED)
            assert (await asyncio.wait_for(ws2.receive(), 3)).type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED)
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
