import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import pytest

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize('mode', ['inplace', 'idle', 'rotate', 'preflight', 'midturn', 'failed'])
def test_real_runner_loopback(mode):
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
        assert proc.returncode == 0, proc.stdout[-2000:] + '\n' + proc.stderr[-5000:]
        record = json.loads((isolated/f'runner-{mode}-result.json').read_text())
        if mode == 'preflight':
            assert record['summary_http_count_min'] > 0 and record['effective_threshold'] == 2400
            (ROOT/'docs/p1/evidence/runner-preflight.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        if mode == 'midturn':
            assert record['tool_called'] and record['model_requests_during_turn'] >= 3
            (ROOT/'docs/p1/evidence/runner-midturn.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        if mode == 'failed':
            assert record['page']['turn_outcomes']
            (ROOT/'docs/p1/evidence/runner-failed.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
            return
        assert record['listener_closed'] and record['two_clients'] and record['initial_description']
        evidence = ROOT/'docs/p1/evidence'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/('runner.json' if mode == 'inplace' else f'runner-{mode}.json')).write_text(
            json.dumps(record, indent=2, sort_keys=True)+'\n')
    finally:
        import shutil
        shutil.rmtree(isolated)


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
