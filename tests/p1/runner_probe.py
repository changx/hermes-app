"""Child process: real plugin manager + GatewayRunner, isolated synthetic provider."""
import asyncio
import json
import os
import shutil
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import aiohttp

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
HOME = Path(os.environ['HERMES_HOME'])
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
        if request.get('stream'):
            chunks = [
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{'role':'assistant','content':answer},'finish_reason':None}]},
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{},'finish_reason':'stop'}], 'usage':{'prompt_tokens':30,'completion_tokens':5,'total_tokens':35}},
            ]
            data = b''.join(b'data: ' + json.dumps(c).encode() + b'\n\n' for c in chunks) + b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            data = json.dumps({'id':'s','object':'chat.completion','model':'p1-local','choices':[{'index':0,'message':{'role':'assistant','content':answer},'finish_reason':'stop'}], 'usage':{'prompt_tokens':30,'completion_tokens':5,'total_tokens':35}}).encode()
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
            async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=20") as resp:
                history_status = resp.status
                assert history_status == 501
            async with a.post(root+f"/v1/threads/{one['id']}/messages", json={'text':'P1_SECOND'}) as resp:
                assert resp.status == 202, await resp.text()
            for _ in range(100):
                if any('P1_SECOND' in json.dumps(x) for x in model.requests):
                    break
                await asyncio.sleep(.2)
            second = next(x for x in model.requests if 'P1_SECOND' in json.dumps(x))
            assert json.dumps(second).count('P1_DESC_A') == 1
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
                    if actual == [['P1_FIRST','P1_SECOND'],['P1_OTHER'],['P1_THIRD']]:
                        break
                    await asyncio.sleep(.2)
                assert actual == [['P1_FIRST','P1_SECOND'],['P1_OTHER'],['P1_THIRD']], actual
            finally:
                db.close()
            async with a.delete(root+f"/v1/threads/{three['id']}") as resp:
                assert resp.status == 200 and (await resp.json())['thread']['archived'] == 1
            result = {'runner':type(runner).__name__, 'adapter':type(adapter).__name__,
                'two_clients':True, 'auth_http_ws':True, 'profile_rejected':True,
                'model_requests':len(model.requests), 'initial_description':True,
                'volatile_receipt':True, 'second_turn_description_once':True,
                'channel_change_new_thread_only':True, 'thread_raw_isolation':True,
                'thread_archive':True,
                'history_status':history_status}
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
        (HOME.parent / 'runner-result.json').write_text(json.dumps(result, sort_keys=True))
    finally:
        if runner:
            await runner.stop()
        manager.unload()
        reset_hermes_home_override(home_token)
        model.shutdown(); model.server_close(); worker.join(5)
        assert not worker.is_alive()


if __name__ == '__main__':
    asyncio.run(main())
