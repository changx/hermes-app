"""Bounded upstream prompt/compaction regressions in an isolated profile."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
REV = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'


def core():
    revision = subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(BASE), 'status', '--porcelain', '--untracked-files=no'], text=True)
    assert revision == REV and not dirty
    return revision


def main():
    before = core()
    with tempfile.TemporaryDirectory(prefix='p0-prompt-tests-', dir=os.environ['TMPDIR']) as temp:
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': temp,
               'HERMES_HOME': temp + '/h', 'TMPDIR': temp,
               'XDG_CONFIG_HOME': temp + '/x', 'XDG_DATA_HOME': temp + '/d',
               'PYTHONPATH': str(BASE), 'PYTHONDONTWRITEBYTECODE': '1',
               'PYTHONNOUSERSITE': '1', 'PYTEST_ADDOPTS': '-p no:cacheprovider',
               'TIRITH_ENABLED': 'false', 'LANG': 'C.UTF-8',
               'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1',
               'NO_PROXY': 'localhost,127.0.0.1,::1'}
        command = [str(BASE / '.venv/bin/python'), '-m', 'pytest', '-q', '-o', 'addopts=',
                   'tests/hermes_cli/test_plugin_prompt_sections.py',
                   'tests/agent/test_plugin_prompt_sections.py',
                   'tests/agent/test_compaction_prompt_rebuild.py']
        proc = subprocess.Popen(command, cwd=BASE, env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                start_new_session=True)
        try:
            out, err = proc.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            out, err = proc.communicate()
            err += '\nCONTROLLER TIMEOUT\n'
        (ROOT / 'prompt-regressions.log').write_text(out + '\nSTDERR:\n' + err)
    match = re.search(r'(\d+) passed', out)
    result = {'command': command, 'exit_code': proc.returncode,
              'passed': int(match[1]) if match else None,
              'core_before': before, 'core_after': core(),
              'temporary_home_removed': not Path(temp).exists(),
              'test_boundary': 'Upstream unit tests include test doubles; not full summarizer E2E'}
    (ROOT / 'prompt-regressions.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    assert proc.returncode == 0 and match and result['temporary_home_removed']


if __name__ == '__main__':
    main()
