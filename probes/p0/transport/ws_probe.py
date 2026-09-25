#!/usr/bin/env python3
"""Isolated, loopback-only black-box TUI WS transport probe (no model calls).

Run from this app worktree with the read-only Hermes snapshot's dev venv Python:
  /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python probes/p0/transport/ws_probe.py
The child imports the snapshot via PYTHONPATH, not the live Hermes installation.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

SNAPSHOT = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
BASELINE = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'


def serve(port: int) -> None:
    from fastapi import FastAPI, WebSocket
    # FastAPI resolves postponed annotations in module globals, not serve() locals.
    globals()['WebSocket'] = WebSocket
    import uvicorn
    from tui_gateway import server, server_requests
    from tui_gateway.ws import handle_ws

    # ONLY the external model/agent construction is replaced. All WS, dispatcher,
    # session.create/resume, event publication/replay and detach/reap code is real.
    server._schedule_agent_build = lambda sid: None
    app = FastAPI()
    verdicts: list[dict] = []
    queue_verdicts: list[dict] = []
    synthetic_turns: dict[str, dict] = {}

    class SyntheticAgent:
        """No model or tools: only an activity clock consumed by the real orphan reaper."""
        def __init__(self, turn):
            self.turn = turn
        def get_activity_summary(self):
            return {'seconds_since_activity': time.monotonic() - self.turn['activity_at']}
        def close(self):
            pass

    def synthetic_executor(rid, sid, session, text, *args):
        turn = synthetic_turns[sid]
        while not turn['finish'].is_set() and not session.get('_turn_cancel_requested'):
            if turn['fresh']:
                turn['activity_at'] = time.monotonic()
            turn['ticks'] += 1
            time.sleep(.1)
        turn['interrupted'] = bool(session.get('_turn_cancel_requested'))
        with session['history_lock']:
            session['running'] = False

    @app.websocket('/api/ws')
    async def endpoint(ws: WebSocket):
        await handle_ws(ws)

    @app.post('/__probe__')
    def control(body: dict):
        op = body['op']
        sid = body.get('sid', '')
        if op == 'state':
            session = server._sessions.get(sid)
            turn = synthetic_turns.get(sid)
            return {'live': bool(session), 'running': bool(session and session.get('running')),
                    'detached': bool(session and session.get('transport') is server._detached_ws_transport),
                    'peers': len(server._session_live_transports(session)),
                    'pending_reap': sid in server._pending_ws_reaps,
                    'turn_ticks': turn['ticks'] if turn else None,
                    'turn_interrupted': turn['interrupted'] if turn else None,
                    'cancel_requested': bool(session and session.get('_turn_cancel_requested')),
                    'stored_user_rows': sum(row['role'] == 'user' for row in
                        server._get_db().get_messages_as_conversation(body['key'])) if body.get('key') else None,
                    'open_requests': server_requests.open_request_count(), 'verdicts': list(verdicts),
                    'queue_verdicts': list(queue_verdicts)}
        if op == 'arm_turn':
            session = server._sessions[sid]
            turn = synthetic_turns[sid] = {'fresh': bool(body['fresh']), 'activity_at': time.monotonic(),
                'finish': threading.Event(), 'ticks': 0, 'interrupted': False}
            session['agent'] = SyntheticAgent(turn)
            session['agent_ready'].set()
            # ONLY model execution is swapped; prompt.submit still owns admission,
            # persistence, running state, scheduling, and the WS dispatch path.
            server._run_after_agent_ready = synthetic_executor
            return {'armed': True}
        if op == 'finish_turn':
            synthetic_turns[sid]['finish'].set()
            return {'finished_signal': True}
        if op == 'emit':
            # Synthetic DATA only; actual event contract, seq, fanout and RPC replay are production code.
            n = int(body.get('count', 1))
            assert 0 < n <= 600
            return {'count': n, 'written': sum(bool(server._emit('status.update', sid,
                    {'kind': 'status', 'text': f'probe-{i}'})) for i in range(n))}
        if op == 'approval':
            # Exercise actual server-request register/routing/one-shot resolver with a synthetic
            # approval payload. This is NOT the tool approval queue or side-effect authorization.
            server_requests.send_async('approval', sid,
                {'request_id': 'synthetic-approval', 'choices': ['once', 'deny']},
                lambda answer: verdicts.append(answer if answer is not None else {'cancelled': True}))
            return {'open_requests': server_requests.open_requests(sid)}
        if op == 'approval_queue':
            from tools.approval_gateway_wait import _await_gateway_decision
            key = server._sessions[sid]['session_key']
            threading.Thread(target=lambda: queue_verdicts.append(
                _await_gateway_decision(key, lambda data: server._emit_approval_request(sid, data),
                                        {'command': 'synthetic harmless approval',
                                         'description': 'transport probe', 'choices': ['once', 'deny']})),
                daemon=True).start()
            return {'started': True}
        if op == 'cancel':
            return {'cancelled': server_requests.cancel(sid, reason='interrupted')}
        raise ValueError(op)

    uvicorn.run(app, host='127.0.0.1', port=port, log_level='error', access_log=False, lifespan='off')


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Gateway:
    def __init__(self, env: dict):
        self.port = free_port()
        self.stderr = tempfile.TemporaryFile(mode='w+t')
        self.proc = subprocess.Popen([sys.executable, __file__, '--serve', str(self.port)],
                                     cwd=SNAPSHOT, env=env, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=self.stderr)
        ready = False
        try:
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if self.proc.poll() is not None:
                    self.stderr.seek(0)
                    raise RuntimeError('server exited: ' + self.stderr.read()[-4000:])
                try:
                    self.control({'op': 'state'})
                    ready = True
                    return
                except (OSError, TimeoutError):
                    time.sleep(.05)
            raise TimeoutError('isolated server did not bind')
        finally:
            if not ready:
                self.stop()

    def control(self, obj: dict) -> dict:
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}/__probe__',
                                     data=json.dumps(obj).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
                raise AssertionError('gateway child failed graceful stop')
        assert self.proc.poll() is not None
        with socket.socket() as s:
            s.settimeout(.5)
            assert s.connect_ex(('127.0.0.1', self.port)) != 0, 'probe port remained open'
        self.stderr.close()


class Peer:
    def __init__(self, ws):
        self.ws = ws
        self.inbox = []
        self.counter = 0

    async def take(self, predicate, timeout: float = 8):
        for i, frame in enumerate(self.inbox):
            if predicate(frame):
                return self.inbox.pop(i)
        deadline = time.monotonic() + timeout
        while True:
            frame = json.loads(await asyncio.wait_for(self.ws.recv(), max(.01, deadline-time.monotonic())))
            if predicate(frame):
                return frame
            self.inbox.append(frame)

    async def rpc(self, method, params=None, request_id=None):
        self.counter += 1
        rid = request_id if request_id is not None else f'probe-{self.counter}'
        await self.ws.send(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}}))
        frame = await self.take(lambda f: f.get('id') == rid)
        assert 'result' in frame, frame
        return frame['result']

    async def event(self, kind='status.update'):
        return (await self.take(lambda f: f.get('method') == 'event' and
                   f.get('params', {}).get('type') == kind))['params']


async def connect(gw):
    import websockets
    ws = await websockets.connect(f'ws://127.0.0.1:{gw.port}/api/ws', open_timeout=8)
    peer = Peer(ws)
    ready = await peer.event('gateway.ready')
    assert ready['payload']['replay_epoch']
    await peer.rpc('client.capabilities', {'server_requests': True})
    return peer, ready['payload']['replay_epoch']


def check(condition, message):
    if not condition:
        raise AssertionError(message)


async def scenario(env):
    receipts = []
    gw = Gateway(env)
    peers = []
    try:
        a, epoch = await connect(gw); peers.append(a)
        seeded = [{'role': 'user', 'content': 'synthetic first message'},
                  {'role': 'assistant', 'content': 'synthetic answer'}]
        created = await a.rpc('session.create', {'source': 'desktop', 'cols': 80,
                           'title': 'P0 synthetic transport', 'messages': seeded})
        sid, key = created['session_id'], created['stored_session_id']
        check(len(created['messages']) == 2, f'seed/create: {created}')
        b, epoch_b = await connect(gw); peers.append(b)
        check(epoch == epoch_b, 'same process epochs differ')
        joined = await b.rpc('session.resume', {'session_id': key, 'cols': 80})
        check(joined['session_id'] == sid, f'not same live session: {joined}')
        check(gw.control({'op': 'state', 'sid': sid})['peers'] == 2, 'no two-client fanout membership')
        gw.control({'op': 'emit', 'sid': sid})
        ea, eb = await asyncio.gather(a.event(), b.event())
        check(ea['seq'] == eb['seq'] == 1, f'fanout seq: {ea} {eb}')
        receipts.append({'case': 'fanout', 'same_runtime_sid': True, 'seq_a': ea['seq'],
                         'seq_b': eb['seq'], 'peers': 2})

        # Real WS close detaches one peer; the other continues receiving events.
        await a.ws.close()
        check(gw.control({'op': 'state', 'sid': sid})['peers'] == 1, 'one-peer detach failed')
        gw.control({'op': 'emit', 'sid': sid})
        e2 = await b.event()
        a2, _ = await connect(gw); peers.append(a2)
        await a2.rpc('session.resume', {'session_id': key})
        catchup = await a2.rpc('session.events.since', {'session_id': sid, 'last_seen': 1})
        check([e['seq'] for e in catchup['events']] == [2] and not catchup['truncated'], catchup)
        receipts.append({'case': 'reconnect', 'remaining_peer_seq': e2['seq'],
                         'replayed_seq': [e['seq'] for e in catchup['events']], 'truncated': catchup['truncated']})

        # The real request manager publishes one request to both sockets, then resolves
        # exactly one response; a late answer from the other device cannot reopen it.
        opened = gw.control({'op': 'approval', 'sid': sid})['open_requests']
        check(len(opened) == 1, f'approval did not open: {opened}')
        ra, rb = await asyncio.gather(a2.take(lambda f: f.get('method') == 'approval'),
                                      b.take(lambda f: f.get('method') == 'approval'))
        check(ra['id'] == rb['id'] == opened[0]['id'], 'not same approval on both peers')
        await a2.ws.send(json.dumps({'jsonrpc': '2.0', 'id': ra['id'], 'result': {'choice': 'once'}}))
        deadline = time.monotonic() + 5
        while not gw.control({'op': 'state', 'sid': sid})['verdicts'] and time.monotonic() < deadline:
            await asyncio.sleep(.02)
        await b.ws.send(json.dumps({'jsonrpc': '2.0', 'id': rb['id'], 'result': {'choice': 'deny'}}))
        await asyncio.sleep(.15)
        approval_state = gw.control({'op': 'state', 'sid': sid})
        check(approval_state['verdicts'] == [{'choice': 'once'}] and
              approval_state['open_requests'] == 0, approval_state)
        receipts.append({'case': 'approval_one_shot', 'broadcast_id_equal': True,
                         'verdicts': approval_state['verdicts'], 'late_answer_dropped': True})

        # Unlike the request-manager-only check, this also drives the real
        # tools.approval queue and server._emit_approval_request wiring.
        gw.control({'op': 'approval_queue', 'sid': sid})
        qa, qb = await asyncio.gather(a2.take(lambda f: f.get('method') == 'approval'),
                                      b.take(lambda f: f.get('method') == 'approval'))
        check(qa['id'] == qb['id'], 'queue-backed approval not fanned out')
        await a2.ws.send(json.dumps({'jsonrpc': '2.0', 'id': qa['id'], 'result': {'choice': 'once'}}))
        deadline = time.monotonic() + 5
        while not gw.control({'op': 'state', 'sid': sid})['queue_verdicts'] and time.monotonic() < deadline:
            await asyncio.sleep(.02)
        queue_result = gw.control({'op': 'state', 'sid': sid})['queue_verdicts']
        check(len(queue_result) == 1 and queue_result[0]['choice'] == 'once' and
              queue_result[0]['resolved'], queue_result)
        await b.ws.send(json.dumps({'jsonrpc': '2.0', 'id': qb['id'], 'result': {'choice': 'deny'}}))
        # Does the answering device's success also withdraw the OTHER card?
        # This is a bounded negative observation, not a live UI assertion.
        try:
            await b.take(lambda f: f.get('params', {}).get('type') == 'request.cancel' and
                         f.get('params', {}).get('payload', {}).get('id') == qb['id'], timeout=.45)
            other_card_cancelled = True
        except asyncio.TimeoutError:
            other_card_cancelled = False
        check(gw.control({'op': 'state', 'sid': sid})['queue_verdicts'] == queue_result,
              'late second response changed the queue decision')
        receipts.append({'case': 'queue_backed_approval', 'choice': queue_result[0]['choice'],
                         'queue_resolved_once': True, 'other_peer_received_cancel': other_card_cancelled})

        await b.ws.close(); await a2.ws.close()
        # WS.close() acknowledges the client handshake before handle_ws.finally has
        # completed its offloaded detach; observe the actual backend state.
        deadline = time.monotonic() + 1.2
        while not gw.control({'op': 'state', 'sid': sid})['detached'] and time.monotonic() < deadline:
            await asyncio.sleep(.02)
        # Detached session's real publisher stamps even undeliverable synthetic events.
        detached = gw.control({'op': 'state', 'sid': sid})
        check(detached['detached'] and detached['pending_reap'], detached)
        burst = gw.control({'op': 'emit', 'sid': sid, 'count': 530})
        a3, _ = await connect(gw); peers.append(a3)
        await a3.rpc('session.resume', {'session_id': key})
        clipped = await a3.rpc('session.events.since', {'session_id': sid, 'last_seen': 2})
        check(clipped['truncated'] and clipped['count'] <= 512 and clipped['latest_seq'] == 532, clipped)
        check(clipped['count'] == len(clipped['events']), clipped)
        receipts.append({'case': 'bounded_replay', 'emitted': burst['count'], 'drop_sink_writes': burst['written'],
                         'retained': clipped['count'], 'latest_seq': clipped['latest_seq'],
                         'truncated': clipped['truncated']})

        # Last peer disconnect schedules, then actually reaps an idle live session.
        await a3.ws.close()
        deadline = time.monotonic() + 1.2
        while not gw.control({'op': 'state', 'sid': sid})['detached'] and time.monotonic() < deadline:
            await asyncio.sleep(.02)
        check(gw.control({'op': 'state', 'sid': sid})['detached'], 'not detached at last close')
        deadline = time.monotonic() + 7
        while gw.control({'op': 'state', 'sid': sid})['live'] and time.monotonic() < deadline:
            await asyncio.sleep(.05)
        reaped = gw.control({'op': 'state', 'sid': sid})
        check(not reaped['live'], f'last-client idle reap not observed: {reaped}')
        receipts.append({'case': 'idle_last_client_reap', 'live_after_grace': reaped['live']})

        # Actual prompt.submit admission + DB write, with only the external
        # model executor substituted by a synthetic activity-clock worker.
        d, _ = await connect(gw); peers.append(d)
        running_created = await d.rpc('session.create', {'source': 'desktop'})
        active_sid = running_created['session_id']
        gw.control({'op': 'arm_turn', 'sid': active_sid, 'fresh': True})
        accepted = await d.rpc('prompt.submit', {'session_id': active_sid, 'text': 'synthetic activity'})
        check(accepted['status'] == 'streaming', accepted)
        await d.ws.close()
        deadline = time.monotonic() + 1.2
        while not gw.control({'op': 'state', 'sid': active_sid})['detached'] and time.monotonic() < deadline:
            await asyncio.sleep(.02)
        tick0 = gw.control({'op': 'state', 'sid': active_sid})['turn_ticks']
        await asyncio.sleep(1.9)  # real timer grace is 1.5s
        fresh = gw.control({'op': 'state', 'sid': active_sid})
        check(fresh['live'] and fresh['running'] and fresh['detached'] and
              fresh['turn_ticks'] > tick0 and not fresh['cancel_requested'], fresh)
        receipts.append({'case': 'fresh_detached_synthetic_turn', 'accepted': accepted['status'],
                         'alive_after_grace': fresh['live'], 'ticks_before': tick0,
                         'ticks_after': fresh['turn_ticks'], 'cancel_requested': fresh['cancel_requested']})
        gw.control({'op': 'finish_turn', 'sid': active_sid})
        deadline = time.monotonic() + 5
        while gw.control({'op': 'state', 'sid': active_sid})['live'] and time.monotonic() < deadline:
            await asyncio.sleep(.05)
        check(not gw.control({'op': 'state', 'sid': active_sid})['live'], 'finished orphan not reaped')

        e, _ = await connect(gw); peers.append(e)
        stale_sid = (await e.rpc('session.create', {'source': 'desktop'}))['session_id']
        gw.control({'op': 'arm_turn', 'sid': stale_sid, 'fresh': False})
        stale_ack = await e.rpc('prompt.submit', {'session_id': stale_sid, 'text': 'synthetic stalled work'})
        check(stale_ack['status'] == 'streaming', stale_ack)
        await e.ws.close()
        deadline = time.monotonic() + 6
        while not gw.control({'op': 'state', 'sid': stale_sid})['turn_interrupted'] and time.monotonic() < deadline:
            await asyncio.sleep(.05)
        stale = gw.control({'op': 'state', 'sid': stale_sid})
        check(stale['turn_interrupted'], f'stale detached turn was not interrupted: {stale}')
        receipts.append({'case': 'stale_detached_synthetic_turn', 'accepted': stale_ack['status'],
                         'interrupted_after_grace': stale['turn_interrupted'], 'ticks': stale['turn_ticks']})

        # JSON-RPC id is a correlation token, not a durable send idempotency key.
        f, _ = await connect(gw); peers.append(f)
        duplicate_created = await f.rpc('session.create', {'source': 'desktop'})
        duplicate_sid, duplicate_key = duplicate_created['session_id'], duplicate_created['stored_session_id']
        submit = {'session_id': duplicate_sid, 'text': 'synthetic duplicate send'}
        gw.control({'op': 'arm_turn', 'sid': duplicate_sid, 'fresh': True})
        ack1 = await f.rpc('prompt.submit', submit, request_id='same-jsonrpc-id')
        gw.control({'op': 'finish_turn', 'sid': duplicate_sid})
        deadline = time.monotonic() + 3
        while gw.control({'op': 'state', 'sid': duplicate_sid})['running'] and time.monotonic() < deadline:
            await asyncio.sleep(.03)
        check(not gw.control({'op': 'state', 'sid': duplicate_sid})['running'], 'first synthetic turn did not finish')
        gw.control({'op': 'arm_turn', 'sid': duplicate_sid, 'fresh': True})
        ack2 = await f.rpc('prompt.submit', submit, request_id='same-jsonrpc-id')
        count = gw.control({'op': 'state', 'sid': duplicate_sid, 'key': duplicate_key})['stored_user_rows']
        check(ack1['status'] == ack2['status'] == 'streaming' and count == 2,
              f'RPC id replay observation: {ack1}, {ack2}, stored={count}')
        receipts.append({'case': 'same_rpc_id_retry_after_completion', 'first': ack1['status'],
                         'second': ack2['status'], 'stored_user_rows': count})
        gw.control({'op': 'finish_turn', 'sid': duplicate_sid})
        await f.ws.close()

        gw.stop()
        gw = Gateway(env)  # same isolated durable HOME/DB, new process/replay epoch
        c, next_epoch = await connect(gw); peers.append(c)
        check(next_epoch != epoch, 'process restart reused replay epoch')
        old = await c.rpc('session.events.since', {'session_id': sid, 'last_seen': 2})
        check(old['epoch'] == next_epoch and old['count'] == 0, old)
        restored = await c.rpc('session.resume', {'session_id': key})
        visible = [m['text'] for m in restored['messages']]
        check(visible == [m['content'] for m in seeded], restored)
        receipts.append({'case': 'process_restart', 'epoch_changed': True, 'old_sid_replay_count': old['count'],
                         'old_sid_truncated': old['truncated'], 'new_runtime_sid': restored['session_id'] != sid,
                         'durable_seed_contents': visible})
        await c.ws.close()
        return receipts
    finally:
        for peer in peers:
            with contextlib.suppress(Exception):
                await peer.ws.close()
        gw.stop()


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--serve':
        serve(int(sys.argv[2])); return
    if len(sys.argv) not in (1, 3) or (len(sys.argv) == 3 and sys.argv[1] != '--output'):
        raise SystemExit('usage: ws_probe.py [--output probes/p0/transport/results.json]')
    actual = subprocess.check_output(['git', '-C', str(SNAPSHOT), 'rev-parse', 'HEAD'], text=True).strip()
    check(actual == BASELINE, f'snapshot HEAD changed: {actual}')
    with tempfile.TemporaryDirectory(prefix='p0-ws-', dir=os.environ.get('TMPDIR')) as root:
        root = Path(root)
        for subdir in ('home', 'hermes', 'tmp', 'xdg-config', 'xdg-cache', 'xdg-data'):
            (root/subdir).mkdir()
        # Do not inherit model credentials, production config, plugin state, proxy auth or HOME.
        env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(root/'home'),
               'HERMES_HOME': str(root/'hermes'), 'TMPDIR': str(root/'tmp'),
               'XDG_CONFIG_HOME': str(root/'xdg-config'), 'XDG_CACHE_HOME': str(root/'xdg-cache'),
               'XDG_DATA_HOME': str(root/'xdg-data'), 'PYTHONPATH': str(SNAPSHOT),
               'PYTHONUNBUFFERED': '1', 'TZ': 'UTC', 'LANG': 'C.UTF-8',
               'HERMES_TUI_WS_ORPHAN_REAP_GRACE_S': '1.5',
               'HERMES_TUI_WS_ORPHAN_ACTIVITY_STALE_S': '0.6'}
        results = asyncio.run(scenario(env))
    result = {'baseline': BASELINE, 'transport': 'actual loopback TCP WebSockets via '
              'tui_gateway.ws.handle_ws',
              'model_executor': 'synthetic: agent construction disabled; optional prompt.submit worker stub',
              'test_grace_seconds': 1.5, 'test_activity_stale_seconds': 0.6,
              'cases': results, 'child_processes_stopped': True, 'temporary_home_removed': True}
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if len(sys.argv) == 3:
        output = Path(sys.argv[2]).resolve()
        allowed = Path(__file__).resolve().parent
        check(output.parent == allowed and output.name == 'results.json', 'output path must be probes/p0/transport/results.json')
        output.write_text(rendered, encoding='utf-8')
    print(rendered, end='')


if __name__ == '__main__':
    main()
