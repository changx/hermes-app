import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import pytest

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]


def _run_real_runner_loopback(mode):
    # A short path is required by the baseline's AF_UNIX loop heartbeat socket.
    isolated = Path(tempfile.mkdtemp(prefix='p1-', dir=os.environ['TMPDIR']))
    home = isolated / 'h'
    home.mkdir()
    env = {
        'PATH':'/usr/local/bin:/usr/bin:/bin', 'HOME':str(isolated), 'HERMES_HOME':str(home),
        'XDG_CONFIG_HOME':str(isolated/'x'), 'XDG_DATA_HOME':str(isolated/'d'),
        'TMPDIR':os.environ.get('TMPDIR','/tmp'), 'PYTHONPATH':str(BASE),
        'PYTHONDONTWRITEBYTECODE':'1', 'PYTHONNOUSERSITE':'1', 'TIRITH_ENABLED':'false',
        'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
        'HERMES_APP_ALLOWED_USERS':'owner',
        'P1_COMPACT_MODE':mode,
        'LANG':'C.UTF-8', 'HTTP_PROXY':'http://127.0.0.1:1', 'HTTPS_PROXY':'http://127.0.0.1:1',
        'NO_PROXY':'localhost,127.0.0.1,::1',
    }
    try:
        proc = subprocess.run([str(BASE/'.venv/bin/python'), str(ROOT/'tests/p1/runner_probe.py')],
            env=env, cwd=ROOT, capture_output=True, text=True, timeout=150)
        if mode == 'midturn' and (isolated/'runner-midturn-attempt.json').exists():
            (ROOT/'docs/p1/evidence/runner-midturn-attempt.json').write_text(
                json.dumps(json.loads((isolated/'runner-midturn-attempt.json').read_text()),indent=2,sort_keys=True)+'\n')
        if mode == 'failed' and (isolated/'runner-failed-attempt.json').exists():
            (ROOT/'docs/p1/evidence/runner-failed-attempt.json').write_text(
                json.dumps(json.loads((isolated/'runner-failed-attempt.json').read_text()),indent=2,sort_keys=True)+'\n')
        if proc.returncode:
            evidence = ROOT / 'docs/p1/evidence'
            (evidence/'runner-last-failure.log').write_text(proc.stdout + '\n' + proc.stderr + '\n' + '\n'.join(
                str(p.relative_to(home)) + '\n' + p.read_text(errors='replace')[-30000:]
                for p in (home/'logs').glob('*.log')))
        assert proc.returncode == 0, proc.stdout[-2000:] + '\n' + proc.stderr[-5000:]
        record = json.loads((isolated/f'runner-{mode}-result.json').read_text())
        if mode == 'preflight':
            assert record['summary_http_count'] > 0 and record['effective_threshold'] == 2400
            record['run_id'] = isolated.name
            (ROOT/'docs/p1/evidence/runner-preflight.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return record
        if mode == 'midturn':
            assert record['tool_called'] and record['model_requests_during_turn'] >= 3
            (ROOT/'docs/p1/evidence/runner-midturn.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        if mode == 'failed':
            assert record['page']['turn_outcomes']
            (ROOT/'docs/p1/evidence/runner-failed.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        if mode == 'race':
            assert record['busy_after_post_hook'] and record['second_send_status'] == 409
            (ROOT/'docs/p1/evidence/runner-race.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        assert record['listener_closed'] and record['two_clients'] and record['initial_description']
        evidence = ROOT/'docs/p1/evidence'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/('runner.json' if mode == 'inplace' else f'runner-{mode}.json')).write_text(
            json.dumps(record, indent=2, sort_keys=True)+'\n')
    finally:
        import shutil
        shutil.rmtree(isolated)


@pytest.mark.parametrize('mode', ['inplace', 'idle', 'rotate', 'preflight', 'midturn', 'failed', 'race'])
def test_real_runner_loopback(mode):
    _run_real_runner_loopback(mode)


def test_preflight_repeated_after_settlement():
    records = [_run_real_runner_loopback('preflight') for _ in range(2)]
    assert len({record['run_id'] for record in records}) == 2
    assert all(record['summary_http_count'] > 0 and record['cold_exact'] and
               record['description_count_next_request'] <= 1 and
               record['after_next']['messages'][:len(record['before']['messages'])] ==
               record['before']['messages'] and not record['after_next']['incomplete_turns']
               for record in records)
    (ROOT/'docs/p1/evidence/runner-preflight-repeat.json').write_text(json.dumps({
        'runs':[{'run_id':record['run_id'],'summary_http_count':record['summary_http_count'],
                 'cold_exact':record['cold_exact'],
                 'description_count_next_request':record['description_count_next_request'],
                 'before_count':len(record['before']['messages']),
                 'after_count':len(record['after_next']['messages']),
                 'prefix_exact':record['after_next']['messages'][:len(record['before']['messages'])] ==
                                record['before']['messages'],
                 'settled':not record['after_next']['incomplete_turns']} for record in records]},
        indent=2,sort_keys=True)+'\n')


def test_disabled_platform_does_not_start_listener():
    isolated = Path(tempfile.mkdtemp(prefix='p1d-', dir=os.environ['TMPDIR']))
    home = isolated/'h'; home.mkdir()
    env = {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(isolated),'HERMES_HOME':str(home),
        'XDG_CONFIG_HOME':str(isolated/'x'),'XDG_DATA_HOME':str(isolated/'d'),
        'TMPDIR':os.environ['TMPDIR'],'PYTHONPATH':str(BASE),
        'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
        'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
        'HERMES_APP_ALLOWED_USERS':'owner','P1_DISABLED':'1','LANG':'C.UTF-8',
        'HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1',
        'NO_PROXY':'localhost,127.0.0.1,::1'}
    try:
        proc = subprocess.run([str(BASE/'.venv/bin/python'), str(ROOT/'tests/p1/runner_probe.py')],
            env=env,cwd=ROOT,capture_output=True,text=True,timeout=100)
        assert proc.returncode == 0, proc.stdout[-1000:]+'\n'+proc.stderr[-5000:]
        record = json.loads((isolated/'runner-disabled-result.json').read_text())
        assert record['disabled_adapter_absent'] and record['other_gateway_started']
        evidence = ROOT/'docs/p1/evidence'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/'runner-disabled.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
    finally:
        import shutil
        shutil.rmtree(isolated)
