"""Run with env -i + isolated HOME/HERMES_HOME; synthetic model, real runner.

No core method replacement, no external provider or credential. Artifact is sanitized
synthetic evidence. The local OpenAI-compatible server is an explicit model stub.
"""
import asyncio
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
assert str(BASE) in sys.path, 'PYTHONPATH must point to read-only Hermes baseline'
assert os.environ.get('TIRITH_ENABLED') == 'false', 'disable installer/network with TIRITH_ENABLED=false'
assert os.environ.get('HOME') == str(Path(os.environ['HERMES_HOME']).parent), 'isolated HOME required'

FIRST = 'synthetic-first-unique-p0'
SECOND = 'synthetic-second-unique-p0'
OTHER = 'synthetic-other-unique-p0'
FINAL = 'SYNTHETIC_LOCAL_FINAL_P0'
MODE = os.environ.get('P0_E2E_MODE', 'normal')
assert MODE in ('normal', 'after_persist', 'gated', 'header')


class ModelHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != '/v1/chat/completions':
            self.send_error(404)
            return
        size = int(self.headers.get('Content-Length', '0'))
        if size > 200000 or size < 0:
            self.send_error(413)
            return
        request = json.loads(self.rfile.read(size))
        self.server.requests.append(request)
        self.server.started.set()
        if FIRST in json.dumps(request):
            if not self.server.release.wait(25):
                self.send_error(504)
                return
        answer = FINAL
        if request.get('stream'):
            pieces = [
                {'id': 'synthetic', 'object': 'chat.completion.chunk', 'model': 'p0-local',
                 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': answer}, 'finish_reason': None}]},
                {'id': 'synthetic', 'object': 'chat.completion.chunk', 'model': 'p0-local',
                 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}],
                 'usage': {'prompt_tokens': 20, 'completion_tokens': 5, 'total_tokens': 25}},
            ]
            data = b''.join(b'data: ' + json.dumps(p).encode() + b'\n\n' for p in pieces) + b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            data = json.dumps({'id': 'synthetic', 'object': 'chat.completion', 'model': 'p0-local',
                               'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': answer},
                                            'finish_reason': 'stop'}],
                               'usage': {'prompt_tokens': 20, 'completion_tokens': 5, 'total_tokens': 25}}).encode()
            mime = 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


async def request(port, method, path, payload=None):
    reader, writer = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', port), 5)
    body = json.dumps(payload).encode() if payload is not None else b''
    writer.write(f'{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body)
    await writer.drain()
    response = await asyncio.wait_for(reader.read(), 10)
    writer.close()
    await writer.wait_closed()
    status, data = response.split(b'\r\n\r\n', 1)
    assert b'200 OK' in status, (status, data[:500])
    return json.loads(data)


async def until(fn, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = await fn()
        if value:
            return value
        await asyncio.sleep(.15)
    raise TimeoutError('condition not reached')


async def run(home, model):
    from hermes_cli.plugins import get_plugin_manager
    from gateway.platform_registry import platform_registry
    from gateway.run import GatewayRunner
    from gateway.config import Platform
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from hermes_state import SessionDB

    token = set_hermes_home_override(home)
    manager = get_plugin_manager()
    runner = None
    try:
        manager.discover_and_load()
        entry = platform_registry.get('p0_e2e')
        assert entry and entry.plugin_name == 'p0-e2e-platform', entry
        runner = GatewayRunner()
        assert runner.config.platforms[Platform('p0_e2e')].enabled
        assert await asyncio.wait_for(runner.start(), 35)
        adapter = runner.adapters[Platform('p0_e2e')]
        assert type(adapter).__name__ == 'ProbeAdapter'
        # Only runner startup wires the handler. Do not call set_message_handler here.
        assert adapter._message_handler is not None
        port = adapter.port
        accepted = await request(port, 'POST', '/submit', {'thread': 'one', 'text': FIRST, 'id': 'm1'})
        assert accepted['accepted'], accepted
        assert await asyncio.to_thread(model.started.wait, 20), 'no real model request'
        assert not model.release.is_set(), 'model must remain gated while client is disconnected'
        # request() closed the actual TCP socket; server turn remains in flight.
        assert not any(FINAL in d['content'] for d in adapter.delivered), adapter.delivered
        second = None
        busy_observation = None
        if MODE == 'gated':
            busy_observation = {'stage': 'model_blocked', 'active_tasks': sum(not t.done() for t in adapter._session_tasks.values())}
            second = await request(port, 'POST', '/submit', {'thread': 'one', 'text': SECOND, 'id': 'm2'})
        model.release.set()
        async def history_one():
            result = await request(port, 'GET', '/history?thread=one')
            return result if any(FINAL in str(m['content']) for m in result['messages']) else None
        first_history = await until(history_one)
        async def first_idle():
            return (any(FINAL in d['content'] for d in adapter.delivered)
                    and not any(not task.done() for task in adapter._session_tasks.values()))
        if MODE in ('normal', 'header'):
            await until(first_idle)
        if second is None:
            busy_observation = {'stage': 'after_first_persist', 'active_tasks': sum(not t.done() for t in adapter._session_tasks.values())}
            second = await request(port, 'POST', '/submit', {'thread': 'one', 'text': SECOND, 'id': 'm2'})
        other = await request(port, 'POST', '/submit', {'thread': 'two', 'text': OTHER, 'id': 'm3'})
        assert second['accepted'] and other['accepted']
        async def complete():
            a = await request(port, 'GET', '/history?thread=one')
            b = await request(port, 'GET', '/history?thread=two')
            if sum(FINAL in str(x['content']) for x in a['messages']) >= 2 and any(
                    FINAL in str(x['content']) for x in b['messages']):
                return a, b
        a, b = await until(complete)
        assert a['session_id'] != b['session_id']
        requests = list(model.requests)
        assert len(requests) >= 3, len(requests)
        def contains(r, s):
            return s in json.dumps(r.get('messages', []), ensure_ascii=False)
        def latest_user(r):
            return next((str(m.get('content')) for m in reversed(r.get('messages', []))
                         if m.get('role') == 'user'), '')
        main_requests = {text: [r for r in requests if text in latest_user(r)
                                and 'Reply with JSON only' not in str(r.get('messages', [{}])[0].get('content', ''))]
                         for text in (FIRST, SECOND, OTHER)}
        assert all(len(rs) == 1 for rs in main_requests.values()), {k: len(v) for k,v in main_requests.items()}
        prompt_checks = {text: contains(main_requests[text][0], desc)
                         for text, desc in ((FIRST, 'P0 Channel A description'),
                                            (SECOND, 'P0 Channel A description'),
                                            (OTHER, 'P0 Channel B description'))}
        assert prompt_checks[FIRST] and prompt_checks[OTHER], prompt_checks
        assert not contains(main_requests[FIRST][0], 'P0 Channel B description')
        assert not contains(main_requests[OTHER][0], 'P0 Channel A description')
        # Report an observed missing description rather than hiding it with a wait.
        # Normal and busy submissions are separate evidence cases.
        # Real SessionDB opened in an independent handle while runner is live.
        db = SessionDB(db_path=home / 'state.db', read_only=True)
        try:
            live_a = db.get_messages(a['session_id'], include_compacted=True)
            live_b = db.get_messages(b['session_id'], include_compacted=True)
        finally:
            db.close()
        assert [m['content'] for m in live_a if m['role'] == 'user'] == [FIRST, SECOND]
        assert [m['content'] for m in live_b if m['role'] == 'user'] == [OTHER]
        assert sum(FINAL in str(m['content']) for m in live_a if m['role'] == 'assistant') >= 2
        assert any(FINAL in str(m['content']) for m in live_b if m['role'] == 'assistant')
        assert first_history['session_id'] == a['session_id']
        assert len(adapter.delivered) >= 3
        result = {'mode': MODE, 'busy_submit_observation': busy_observation,
                  'runner': type(runner).__name__, 'adapter': type(adapter).__name__,
                  'handler_owner': 'GatewayRunner.start -> _wire_adapter_handlers (not probe handler)',
                  'client_closed_before_model_release': True,
                  'model_request_count': len(requests),
                  'request_checks': {'first_description': prompt_checks[FIRST],
                                     'second_description': prompt_checks[SECOND],
                                     'other_description': prompt_checks[OTHER]},
                  'inbound_prompt_snapshots': adapter.received_prompts,
                  'sessions': {'one': a['session_id'], 'two': b['session_id']},
                  'live_history': {'one': [{'role': r['role'], 'content': r['content']} for r in live_a],
                                   'two': [{'role': r['role'], 'content': r['content']} for r in live_b]},
                  'reconnect_history_matched': a['messages'] == result_messages(live_a),
                  'delivered_count': len(adapter.delivered)}
        assert result['reconnect_history_matched']
        if MODE == 'header':
            calls = [json.loads(line) for line in (home / 'p0-header-calls.jsonl').read_text().splitlines()]
            assert sorted(c['session_id'] for c in calls) == sorted([a['session_id'], b['session_id']]), calls
            assert all(not p for _, p in adapter.received_prompts)
            headers = {}
            for text, rs in main_requests.items():
                system = '\n'.join(str(m.get('content', '')) for m in rs[0]['messages'] if m['role'] == 'system')
                desc = 'P0 Channel B description' if text == OTHER else 'P0 Channel A description'
                assert system.count(desc) == 1
                assert not any(desc in str(m.get('content')) for m in rs[0]['messages'] if m['role'] != 'system')
                headers[text] = system
            assert headers[FIRST] == headers[SECOND], 'normal turn changed Session header'
            result['header_checks'] = {'callback_once_per_session': True,
                'no_ephemeral_prompt': True, 'normal_turn_identical_header': True,
                'description_once_in_header_only': True, 'callback_count': len(calls)}
        return result
    finally:
        model.release.set()
        try:
            if runner is not None:
                await asyncio.wait_for(runner.stop(), 25)
        finally:
            manager.unload()
            reset_hermes_home_override(token)


def result_messages(rows):
    return [{'role': r['role'], 'content': r['content']} for r in rows]


def main():
    with tempfile.TemporaryDirectory(prefix='p-', dir=os.environ['TMPDIR']) as temp:
        home = Path(temp) / 'h'
        home.mkdir()
        shutil.copytree(ROOT / 'plugin', home / 'plugins' / 'p0-e2e-platform')
        server = ThreadingHTTPServer(('127.0.0.1', 0), ModelHandler)
        server.requests = []
        server.started = threading.Event()
        server.release = threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            (home / 'config.yaml').write_text(
                'model:\n  provider: custom\n  default: p0-local\n'
                f'  base_url: http://127.0.0.1:{server.server_port}/v1\n'
                'fallback_providers: []\nauxiliary:\n  title_generation:\n    enabled: false\n'
                'security:\n  tirith_enabled: false\n'
                'tools:\n  enabled_toolsets: []\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
                'plugins:\n  enabled: [p0-e2e-platform]\n'
                'gateway:\n  multiplex_profiles: false\n  loop_watchdog: false\n'
                '  platforms:\n    p0_e2e:\n      enabled: true\n      typing_indicator: false\n'
                '      channel_prompts:\n'
                '        channel-A: P0 Channel A description\n'
                '        channel-B: P0 Channel B description\n', encoding='utf8')
            (home / '.env').write_text('OPENAI_API_KEY=synthetic-local-no-credential\nP0_E2E_ALLOWED_USERS=probe-user\n', encoding='utf8')
            result = asyncio.run(asyncio.wait_for(run(home, server), 110))
            # A new process opens the actual database; no in-memory adapter state survives.
            from subprocess import run as subprocess_run
            cold = subprocess_run([sys.executable, str(ROOT / 'probe.py'), '--cold',
                                   str(home / 'state.db'), result['sessions']['one'], result['sessions']['two']],
                                  capture_output=True, text=True, timeout=20)
            assert cold.returncode == 0, (cold.stdout, cold.stderr)
            result['cold_reload'] = json.loads(cold.stdout)
            assert result['cold_reload']['one_user'] == [FIRST, SECOND]
            assert result['cold_reload']['two_user'] == [OTHER]
            if MODE == 'header':
                env = os.environ.copy()
                env['HERMES_HOME'] = str(home)
                resumed = subprocess_run([sys.executable, str(ROOT / 'resume_header.py'),
                                          result['sessions']['one']], env=env,
                                         capture_output=True, text=True, timeout=60)
                assert resumed.returncode == 0, (resumed.stdout, resumed.stderr)
                result['header_resume'] = json.loads(resumed.stdout.strip().splitlines()[-1])
        finally:
            server.release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            assert not thread.is_alive()
    result['temporary_home_removed'] = not Path(temp).exists()
    result['local_model_server_stopped'] = not thread.is_alive()
    result['scope'] = 'Real GatewayRunner/AIAgent, synthetic loopback model; raw DB read, no UI/compaction/crash recovery proof'
    filename = 'results.json' if MODE == 'normal' else f'results-{MODE}.json'
    (ROOT / filename).write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(('PASS' if result['request_checks']['second_description'] else 'PARTIAL E02 SECOND TURN MISSING DESCRIPTION')
          + ' real GatewayRunner/AIAgent -> local synthetic provider -> SessionDB cold reload', flush=True)


def cold(db_path, one, two):
    from hermes_state import SessionDB
    db = SessionDB(db_path=Path(db_path), read_only=True)
    try:
        a = db.get_messages(one, include_compacted=True)
        b = db.get_messages(two, include_compacted=True)
        assert sum(FINAL in str(r['content']) for r in a if r['role'] == 'assistant') >= 2
        assert any(FINAL in str(r['content']) for r in b if r['role'] == 'assistant')
        print(json.dumps({'one_user': [r['content'] for r in a if r['role'] == 'user'],
                          'two_user': [r['content'] for r in b if r['role'] == 'user'],
                          'one_final_count': sum(FINAL in str(r['content']) for r in a if r['role'] == 'assistant'),
                          'two_final_count': sum(FINAL in str(r['content']) for r in b if r['role'] == 'assistant')}))
    finally:
        db.close()


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--cold':
        cold(*sys.argv[2:])
    else:
        main()
