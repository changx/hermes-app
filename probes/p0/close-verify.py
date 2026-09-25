"""Parent verification; retains negative compaction evidence, never calls it a pass."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'probes/p0/close-verification'
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PY = str(BASE / '.venv/bin/python')
REV = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'


def command(argv, cwd, env, logfile, timeout=180):
    p = subprocess.Popen(argv, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
        err += '\nCONTROLLER TIMEOUT\n'
    logfile.write_text(out + '\nSTDERR:\n' + err)
    return {'command': argv, 'exit_code': p.returncode, 'log': str(logfile.relative_to(ROOT))}


def run(name):
    with tempfile.TemporaryDirectory(prefix='p0-final-' + name + '-', dir=os.environ['TMPDIR']) as tmp:
        env = {'PATH': '/home/hermes/.asdf/installs/nodejs/24.14.1/bin:/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin',
               'HOME': tmp, 'HERMES_HOME': tmp + '/h', 'TMPDIR': tmp,
               'XDG_CONFIG_HOME': tmp + '/x', 'XDG_DATA_HOME': tmp + '/d',
               'PYTHONPATH': str(BASE), 'HERMES_TEST_ISOLATION': '1', 'TIRITH_ENABLED': 'false',
               'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1', 'LANG': 'C.UTF-8',
               'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1',
               'NO_PROXY': 'localhost,127.0.0.1,::1', 'EXPO_NO_TELEMETRY': '1', 'CI': '1'}
        rows = []
        if name == 'compaction':
            rows.append(command([PY, str(ROOT/'probes/p0/close-compaction/run.py'),
                                 'rotate', 'idle', 'inplace', 'inplace_idle'], ROOT, env, OUT/'compaction.log'))
            evidence = json.loads((ROOT/'probes/p0/close-compaction/runs.json').read_text())
            checks = {'fresh_all': len(evidence)==4 and all(x['fresh_evidence'] for x in evidence),
                      'inner_cleanup': all(x['temporary_home_removed'] for x in evidence)}
            detail = [{k: x['checks'].get(k) for k in ('mode','canonical_visible_equal','canonical_counts',
                      'restore_identity','fresh_agent_description_count','successor_rebuild_description_once')}
                      for x in evidence if x['checks']]
        elif name == 'recovery':
            rows.append(command([PY, str(ROOT/'probes/p0/close-recovery/probe.py')], ROOT, env, OUT/'recovery.log'))
            result = json.loads((ROOT/'probes/p0/close-recovery/results.json').read_text())
            checks, detail = result['checks'], result['all_phases_pass']
            tests = ['tests/tui_gateway/test_groups_methods.py::test_rpc_retry_is_idempotent_and_conflict_is_visible',
                     'tests/tui_gateway/test_hosted_room_service.py::test_restart_republishes_terminal_task_before_admitting_more',
                     'tests/tui_gateway/test_hosted_room_driver_runtime.py::test_expired_local_attempt_defers_without_hydrating_or_resubmitting',
                     'tests/tui_gateway/test_hosted_room_driver_runtime.py::test_pending_local_approval_is_reported_with_safe_choices',
                     'tests/tools/test_approval_gateway_wait_late_choice.py',
                     'tests/cron/test_delivery_queue.py::test_dead_delivery_owner_becomes_unknown_and_is_not_retried',
                     'tests/cron/test_delivery_queue.py::test_wait_timeout_leaves_unclaimed_delivery_queued_for_next_gateway',
                     'tests/cron/test_cron_live_delivery_confirmation.py::TestConfirmAdapterDelivery']
            rows.append(command([PY,'-m','pytest','-q','-o','addopts=','-p','no:cacheprovider',*tests],BASE,env,OUT/'recovery-tests.log'))
        else:
            folder = ROOT/'probes/p0/close-mobile'
            deps = Path('/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile')
            assert (folder/'package-lock.json').read_bytes() == (deps/'package-lock.json').read_bytes()
            link = folder/'node_modules'
            if not link.exists(): link.symlink_to(deps/'node_modules', target_is_directory=True)
            assert link.resolve() == (deps/'node_modules').resolve()
            env.update(HERMES_BASELINE=str(BASE), HERMES_EXPO_DEPS=str(deps))
            for script, log in [('export:android-js','export-android-js.log'),('test:protocol','protocol-test.log')]:
                rows.append(command(['/home/hermes/.asdf/installs/nodejs/24.14.1/bin/npm','run',script],folder,env,folder/log,timeout=120))
            rows.append(command(['/home/hermes/.asdf/installs/nodejs/24.14.1/bin/node','verify-results.cjs'],folder,env,OUT/'mobile.log'))
            detail = json.loads((folder/'results.json').read_text())
            checks = {'all_commands_zero': all(x['exit_code']==0 for x in rows)}
    return {'name':name,'commands':rows,'checks':checks,'detail':detail,'outer_cleanup':not Path(tmp).exists()}


def core():
    rev = subprocess.check_output(['git','-C',str(BASE),'rev-parse','HEAD'],text=True).strip()
    dirty = subprocess.check_output(['git','-C',str(BASE),'status','--porcelain','--untracked-files=no'],text=True)
    assert rev == REV and not dirty
    return rev


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    before = core()
    import sys
    selected = sys.argv[1:] or ['compaction','recovery','mobile']
    assert set(selected) <= {'compaction','recovery','mobile'}
    previous = json.loads((OUT/'results.json').read_text())['results'] if (OUT/'results.json').exists() else []
    with ThreadPoolExecutor(max_workers=3) as pool:
        current = list(pool.map(run, selected))
    by_name = {x['name']: x for x in previous}
    by_name.update({x['name']: x for x in current})
    results = list(by_name.values())
    report = {'core_before':before,'core_after':core(),'rerun_lanes':selected,
              'scope':'diagnostic reproduction, NOT all product acceptance passed','results':results}
    (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    assert all(x['outer_cleanup'] and all(x['checks'].values()) for x in results)
    assert all(r['exit_code']==0 for x in results if x['name']!='compaction' for r in x['commands'])
