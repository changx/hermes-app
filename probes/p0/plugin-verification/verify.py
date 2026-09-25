"""Controller rerun of reviewed P0 plugin probes; no model or external calls.

Run using Python 3, from any directory. Requires the retained fixed Hermes
baseline with its existing development .venv. Does not install dependencies.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
REV = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'
PY = str(BASE / '.venv/bin/python')


def core_state():
    rev = subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(BASE), 'status', '--porcelain', '--untracked-files=no'], text=True)
    assert rev == REV and not dirty, (rev, dirty)
    return {'revision': rev, 'tracked_status': dirty}


def run_case(item):
    name, command, cwd = item
    evidence_paths = {
        'transport': ROOT / 'probes/p0/plugin-transport/results.json',
        'history': ROOT / 'probes/p0/plugin-history/evidence.json',
        'execution': ROOT / 'probes/p0/plugin-execution/results.json',
    }
    evidence = evidence_paths.get(name)
    before_mtime = evidence.stat().st_mtime_ns if evidence and evidence.exists() else None
    with tempfile.TemporaryDirectory(prefix='p0-parent-' + name + '-', dir=os.environ['TMPDIR']) as temp:
        env = {
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'HOME': temp, 'HERMES_HOME': temp + '/hermes',
            'XDG_CONFIG_HOME': temp + '/xdg-config', 'XDG_DATA_HOME': temp + '/xdg-data',
            'TMPDIR': os.environ['TMPDIR'], 'LANG': 'C.UTF-8',
            'PYTHONPATH': str(BASE), 'PYTHONDONTWRITEBYTECODE': '1',
            'PYTHONNOUSERSITE': '1', 'UV_OFFLINE': '1',
            'PYTEST_ADDOPTS': '-p no:cacheprovider',
        }
        try:
            result = subprocess.run(command, cwd=cwd, env=env, text=True,
                                    capture_output=True, timeout=180)
            code = result.returncode
            stdout, stderr = result.stdout, result.stderr
        except subprocess.TimeoutExpired as exc:
            code = 124
            stdout = (exc.stdout or b'').decode(errors='replace') if isinstance(exc.stdout, bytes) else (exc.stdout or '')
            stderr = 'TIMEOUT\n' + ((exc.stderr or b'').decode(errors='replace') if isinstance(exc.stderr, bytes) else (exc.stderr or ''))
        (OUT / (name + '.log')).write_text(stdout + '\nSTDERR:\n' + stderr)
    fresh = evidence is None or (evidence.exists() and evidence.stat().st_mtime_ns != before_mtime)
    return {'name': name, 'exit_code': code, 'command': command, 'evidence_updated': fresh,
            'temporary_home_removed': not Path(temp).exists(),
            'stdout': stdout.strip(), 'last_stderr_line': stderr.strip().splitlines()[-1] if stderr.strip() else ''}


def main():
    before = core_state()
    cases = [
        ('transport', [PY, str(ROOT / 'probes/p0/plugin-transport/run.py'),
                       str(ROOT / 'probes/p0/plugin-transport/results.json')], ROOT),
        ('history', [PY, str(ROOT / 'probes/p0/plugin-history/probe.py')], ROOT),
        ('execution', [PY, str(ROOT / 'probes/p0/plugin-execution/probe.py')], ROOT),
        ('regressions', [PY, '-m', 'pytest', '-q', '-o', 'addopts=',
                         'tests/hermes_cli/test_plugin_ownership_ledger.py',
                         'tests/gateway/test_browser_control_artifacts.py'], BASE),
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(run_case, cases))
    after = core_state()
    report = {'core_before': before, 'core_after': after, 'runs': results,
              'all_commands_passed': all(r['exit_code'] == 0 and r['evidence_updated'] for r in results),
              'all_outer_temp_homes_removed': all(r['temporary_home_removed'] for r in results)}
    if report['all_commands_passed']:
        transport = json.loads((ROOT / 'probes/p0/plugin-transport/results.json').read_text())
        history = json.loads((ROOT / 'probes/p0/plugin-history/evidence.json').read_text())
        execution = json.loads((ROOT / 'probes/p0/plugin-execution/results.json').read_text())
        assert transport['assertions_passed'] == len(transport['checks'])
        assert history['passed'] == history['total'] == len(history['checks'])
        assert all(c['passed'] for c in history['checks'])
        assert transport['temporary_home_removed'] and history['temporary_directory_removed']
        assert execution['adapter']['stop_reaped'] and execution['crash']['child_exit'] == 73
        match = re.search(r'(\d+) passed', next(r['stdout'] for r in results if r['name'] == 'regressions'))
        assert match, 'No pytest passing count in real output'
        report['observations'] = {
            'transport_assertions': len(transport['checks']),
            'history_checks': len(history['checks']),
            'regression_tests_passed': int(match[1]),
            'execution_scope': 'synthetic handler through real plugin adapter/approval/cron paths; NOT real GatewayRunner',
        }
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert report['all_commands_passed'] and report['all_outer_temp_homes_removed']


if __name__ == '__main__':
    main()
