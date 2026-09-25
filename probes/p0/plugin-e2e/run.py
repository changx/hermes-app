"""Run normal and busy-submit P0 cases in isolated processes and retain real logs."""
from concurrent.futures import ThreadPoolExecutor
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


def run(mode):
    output = ROOT / ('results.json' if mode == 'normal' else f'results-{mode}.json')
    old_mtime = output.stat().st_mtime_ns if output.exists() else None
    with tempfile.TemporaryDirectory(prefix='pe-', dir=os.environ['TMPDIR']) as temp:
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': temp,
               'HERMES_HOME': temp + '/h', 'XDG_CONFIG_HOME': temp + '/x',
               'XDG_DATA_HOME': temp + '/d', 'TMPDIR': os.environ['TMPDIR'],
               'PYTHONPATH': str(BASE), 'PYTHONDONTWRITEBYTECODE': '1',
               'PYTHONNOUSERSITE': '1', 'TIRITH_ENABLED': 'false',
               'P0_E2E_MODE': mode, 'LANG': 'C.UTF-8',
               'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1',
               'NO_PROXY': 'localhost,127.0.0.1,::1'}
        proc = subprocess.Popen([PY, str(ROOT / 'probe.py')], env=env, cwd=ROOT,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                start_new_session=True)
        try:
            stdout, stderr = proc.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            stdout, stderr = proc.communicate()
            stderr += '\nCONTROLLER: timeout; process group killed\n'
        (ROOT / (mode + '.log')).write_text(stdout + '\nSTDERR:\n' + stderr)
        fresh = output.exists() and output.stat().st_mtime_ns != old_mtime
        evidence = json.loads(output.read_text()) if fresh else None
    return {'mode': mode, 'exit_code': proc.returncode, 'fresh_evidence': fresh,
            'outer_home_removed': not Path(temp).exists(),
            'request_checks': evidence.get('request_checks') if evidence else None,
            'busy_submit_observation': evidence.get('busy_submit_observation') if evidence else None,
            'last_output_lines': (stdout + '\n' + stderr).splitlines()[-8:]}


def main():
    modes = sys.argv[1:] or ['header']
    assert len(set(modes)) == len(modes) and set(modes) <= {'normal', 'after_persist', 'gated', 'header'}
    with ThreadPoolExecutor(max_workers=len(modes)) as pool:
        results = list(pool.map(run, modes))
    name = 'runs.json' if len(modes) == 3 else 'runs-' + '-'.join(modes) + '.json'
    (ROOT / name).write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(results, ensure_ascii=False, indent=2))
    assert all(r['exit_code'] == 0 and r['fresh_evidence'] and r['outer_home_removed'] for r in results)
    # Missing prompts are recorded as acceptance gaps, not hidden behind an exit code.


if __name__ == '__main__':
    main()
