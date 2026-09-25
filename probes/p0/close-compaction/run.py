"""Run each mode with isolated credentials/home and bounded child lifetime."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PY = str(BASE / '.venv/bin/python')

def main():
    output = []
    for mode in sys.argv[1:] or ('rotate', 'idle'):
        assert mode in ('rotate', 'idle', 'inplace', 'inplace_idle')
        evidence = ROOT / f'{mode}.json'
        evidence.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory(prefix='p0-comp-', dir=os.environ['TMPDIR']) as temp:
            env = {'PATH':'/usr/local/bin:/usr/bin:/bin', 'HOME':temp, 'HERMES_HOME':temp+'/h',
                   'XDG_CONFIG_HOME':temp+'/x', 'XDG_DATA_HOME':temp+'/d',
                   'TMPDIR':os.environ['TMPDIR'], 'PYTHONPATH':str(BASE),
                   'PYTHONDONTWRITEBYTECODE':'1', 'PYTHONNOUSERSITE':'1',
                   'TIRITH_ENABLED':'false', 'P0_E2E_MODE':'header', 'P0_COMPACT_MODE':mode,
                   'LANG':'C.UTF-8', 'HTTP_PROXY':'http://127.0.0.1:1',
                   'HTTPS_PROXY':'http://127.0.0.1:1', 'NO_PROXY':'localhost,127.0.0.1,::1'}
            proc = subprocess.Popen([PY, str(ROOT/'probe.py')], cwd=ROOT, env=env,
                                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    start_new_session=True)
            try:
                stdout, stderr = proc.communicate(timeout=150)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                stdout, stderr = proc.communicate()
                stderr += '\nCONTROLLER TIMEOUT: killed process group\n'
            (ROOT/f'{mode}.log').write_text(stdout+'\nSTDERR:\n'+stderr)
            fresh = evidence.exists()
            record = {'mode':mode, 'exit_code':proc.returncode, 'fresh_evidence':fresh,
                      'checks':json.loads(evidence.read_text()) if fresh else None,
                      'last_log_lines':(stdout+'\n'+stderr).splitlines()[-12:]}
        record['temporary_home_removed'] = not Path(temp).exists()
        output.append(record)
    (ROOT/'runs.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps(output, indent=2))
    assert all(r['exit_code']==0 and r['fresh_evidence'] and r['temporary_home_removed'] for r in output)

if __name__=='__main__':
    main()
