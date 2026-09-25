#!/usr/bin/env python3
"""Isolated supported groups RPC/service cold-recovery probe; synthetic executor only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
HERE = Path(__file__).resolve().parent
assert str(BASE) in sys.path and os.getenv('HERMES_TEST_ISOLATION') == '1'
assert Path(os.environ['HERMES_HOME']).is_relative_to(Path(os.environ['TMPDIR']))


def child(phase, root):
    import tui_gateway.server as server
    from tui_gateway import methods_groups
    from gateway import hosted_rooms, hosted_room_driver

    class SyntheticExecutor:
        """Only executor boundary substitution: no model, tools, network or core edits."""
        def __init__(self):
            self.sessions = {}
            self.submits = []
        def resolve_exact(self, *, profile, title, source):
            return self.sessions.get((profile, title))
        def create(self, *, profile, title, source):
            session = {'session_id': 'synthetic-session', 'title': title}
            self.sessions[(profile, title)] = session
            return session
        def resume(self, *, profile, session_id, source):
            return {'session_id': session_id}
        def submit(self, **kw):
            self.submits.append({'task_id': kw['task'].task_id, 'prompt': kw['prompt'],
                                 'generation': kw['execution_generation']})
            kw['on_terminal']({'status': 'settled', 'text': 'SYNTHETIC_REPLY'})
            return {'accepted': True}
        def history(self, **kw):
            return []
        def info(self, **kw):
            return {'active': False, 'task_id': None}
        def interrupt(self, **kw):
            return {'interrupted': True}

    def call(name, params):
        envelope = server._methods[name]('p0-' + name, params)
        return envelope.get('result') if 'error' not in envelope else {'error': envelope['error']}

    methods_groups.stop_hosted_room_service(timeout=2)
    service = methods_groups.start_hosted_room_service()
    assert service is not None
    executor = SyntheticExecutor()
    service.rpc = service.runtime.rpc = executor
    room_id = 'synthetic-room'
    try:
        if phase == 'initial':
            created = call('groups.create', {'room_id': room_id, 'name': 'synthetic',
                'members': [{'member_id': 'default', 'profile': 'default', 'handle': 'hermes'},
                            {'member_id': 'ops', 'profile': 'ops', 'handle': 'ops'}]})
            assert 'error' not in created, created
            params = {'room_id': room_id, 'event_id': 'send-1',
                      'payload': {'text': '@ops synthetic hello', 'thread_id': 'thread-1'}}
            first = call('groups.send', params)
            replay = call('groups.send', params)
            conflict = call('groups.send', {**params, 'payload': {'text': '@ops CHANGED', 'thread_id': 'thread-1'}})
            second = call('groups.send', {**params, 'event_id': 'send-2'})
            assert first['accepted'] and first['driver_started'] and replay['event']['seq'] == first['event']['seq']
            assert second['event']['seq'] != first['event']['seq'] and 'error' in conflict
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                log = call('groups.log', {'room_id': room_id, 'since_seq': 0, 'limit': 100})
                if any(e['kind'] == 'turn.settled' for e in log['events']):
                    break
                time.sleep(.05)
            else:
                raise AssertionError({'log': log, 'submits': executor.submits})
            out = {'pid': os.getpid(), 'created': created['room']['room_id'],
                   'send_seq': [first['event']['seq'], replay['event']['seq'], second['event']['seq']],
                   'send_conflict_code': conflict['error']['code'], 'submits': executor.submits,
                   'events': log['events'], 'cursor': log['cursor'],
                   'driver_status': call('groups.state', {'room_id': room_id}).get('driver_status')}
        elif phase == 'cold':
            # A new OS process and newly started service over the SAME isolated DB.
            page1 = call('groups.log', {'room_id': room_id, 'since_seq': 0, 'limit': 2})
            cursor, pages = 0, []
            for _ in range(100):
                page = call('groups.log', {'room_id': room_id, 'since_seq': cursor, 'limit': 2})
                pages.extend(page['events'])
                cursor = page['cursor']
                if not page['has_more']:
                    break
            else:
                raise AssertionError('pagination loop')
            replay = call('groups.send', {'room_id': room_id, 'event_id': 'send-1',
                'payload': {'text': '@ops synthetic hello', 'thread_id': 'thread-1'}})
            future = call('groups.log', {'room_id': room_id, 'since_seq': cursor + 1, 'limit': 2})
            assert replay['event']['seq'] == pages[0]['seq'] and 'error' in future
            # Restart service reconstructs a valid event with NO driver task, representing
            # the append-before-admit crash boundary. Fixture seeds this precise state;
            # it does not pretend to inject an actual process kill inside service.send.
            assert service.stop(timeout=3)
            methods_groups.stop_hosted_room_service(timeout=3)
            gap = hosted_rooms.append_event(service.db_path, room_id=room_id,
                event_id=hosted_rooms.user_event_id('gap-1'), kind='message.user',
                actor={'kind': 'user', 'id': 'desktop'},
                payload={'text': '@ops synthetic after-gap', 'thread_id': 'thread-gap'},
                authority_gateway_id=hosted_rooms.local_authority_gateway_id(), authority_epoch=1)
            assert not [t for status in ('queued','running','settled')
                for t in hosted_room_driver.list_tasks(service.db_path, room_id=room_id, status=status)
                if t['payload'].get('source_event_seq') == gap['seq']]
            recovered = methods_groups.start_hosted_room_service()
            recovered.rpc = recovered.runtime.rpc = executor
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                after = call('groups.log', {'room_id': room_id, 'since_seq': gap['seq'] - 1, 'limit': 100})
                if any(e['kind'] == 'turn.settled' for e in after['events']):
                    break
                time.sleep(.05)
            else:
                raise AssertionError({'gap': gap, 'after': after, 'submits': executor.submits})
            out = {'pid': os.getpid(), 'page1_seq': [e['seq'] for e in page1['events']],
                   'all_seq': [e['seq'] for e in pages], 'cursor': cursor,
                   'replay_seq': replay['event']['seq'], 'future_error': future['error'],
                   'gap_seq': gap['seq'], 'gap_after_kinds': [e['kind'] for e in after['events']],
                   'cold_submits': executor.submits}
        elif phase == 'reader':
            page = call('groups.log', {'room_id': room_id, 'since_seq': 0, 'limit': 100})
            out = {'pid': os.getpid(), 'seq': [e['seq'] for e in page['events']], 'cursor': page['cursor']}
        else:
            raise ValueError(phase)
        (root / (phase + ('-' + str(os.getpid()) if phase == 'reader' else '') + '.json')).write_text(
            json.dumps(out, indent=2) + '\n')
    finally:
        methods_groups.stop_hosted_room_service(timeout=5)


def main():
    if len(sys.argv) > 1:
        child(sys.argv[1], Path(sys.argv[2])); return
    with tempfile.TemporaryDirectory(prefix='p0-close-recovery-', dir=os.environ['TMPDIR']) as tmp:
        root = Path(tmp)
        home = root / 'home'
        home.mkdir()
        (home / 'profiles' / 'ops').mkdir(parents=True)
        (home / 'profiles' / 'ops' / 'config.yaml').write_text('{}\n')
        env = dict(os.environ, HOME=str(root), HERMES_HOME=str(home), HERMES_TEST_ISOLATION='1',
                   PYTHONDONTWRITEBYTECODE='1', TIRITH_ENABLED='false')
        phases = []
        for phase in ('initial', 'cold'):
            p = subprocess.run([sys.executable, __file__, phase, tmp], env=env, capture_output=True, text=True, timeout=70)
            phases.append({'phase': phase, 'exit': p.returncode, 'stderr': p.stderr[-3500:],
                           'stdout': p.stdout[-1000:]})
            if p.returncode:
                break
        if all(p['exit'] == 0 for p in phases):
            # Two independently initialized RPC readers over the same log, not WS clients.
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as pool:
                readers = list(pool.map(lambda _: subprocess.run([sys.executable, __file__, 'reader', tmp],
                    env=env, capture_output=True, text=True, timeout=40), range(2)))
            phases.extend({'phase': 'reader', 'exit': p.returncode, 'stderr': p.stderr[-1500:]} for p in readers)
        observed = {n: json.loads((root / (n + '.json')).read_text()) for n in ('initial', 'cold') if (root / (n + '.json')).exists()}
        readers = [json.loads(p.read_text()) for p in root.glob('reader-*.json')]
        checks = {}
        if len(observed) == 2 and len(readers) == 2:
            expected = [e['seq'] for e in observed['initial']['events']]
            checks = {'cold_page_equivalence': observed['cold']['all_seq'] == expected
                    and observed['cold']['pid'] != observed['initial']['pid'],
                'independent_readers': all(r['seq'][:len(expected)] == expected
                    and r['cursor'] == r['seq'][-1] for r in readers)
                    and len({r['pid'] for r in readers}) == 2,
                'at_least_one_executor_admission': bool(observed['initial']['submits']),
                'gap_recovered_once': observed['cold']['gap_after_kinds'].count('turn.settled') == 1
                    and sum('synthetic after-gap' in s['prompt']
                            for s in observed['cold']['cold_submits']) == 1}
        report = {'checks': checks, 'baseline': subprocess.check_output(['git','-C', str(BASE),'rev-parse','HEAD'], text=True).strip(),
                  'phases': phases, 'observed': observed, 'readers': readers,
                  'all_phases_pass': len(phases) == 4 and all(p['exit'] == 0 for p in phases)
                      and len(checks) == 4 and all(checks.values())}
        (HERE / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'all_phases_pass': report['all_phases_pass'], 'phase_exits': [p['exit'] for p in phases],
                          'readers': len(readers)}))
        if not report['all_phases_pass']:
            sys.exit(1)

if __name__ == '__main__':
    main()
