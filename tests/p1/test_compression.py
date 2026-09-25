"""Real model-loopback compaction evidence for all four baseline paths."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import pytest

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PROBE = Path(__file__).with_name('compression_probe.py')

@pytest.mark.parametrize('mode', ['inplace','rotate','idle','inplace_idle'])
def test_description_no_reinjection_and_record_history_gap(mode):
    isolated = Path(tempfile.mkdtemp(prefix='p1c-',dir=os.environ['TMPDIR']))
    home = isolated/'h'; home.mkdir()
    env = {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(isolated),'HERMES_HOME':str(home),
        'XDG_CONFIG_HOME':str(isolated/'x'),'XDG_DATA_HOME':str(isolated/'d'),
        'TMPDIR':os.environ['TMPDIR'],'PYTHONPATH':str(BASE)+':'+str(PROBE.parents[2]/'plugins'),
        'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
        'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
        'HERMES_APP_ALLOWED_USERS':'owner',
        'P1_COMPACT_MODE':mode,'LANG':'C.UTF-8',
        'HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1',
        'NO_PROXY':'localhost,127.0.0.1,::1'}
    try:
        proc = subprocess.run([str(BASE/'.venv/bin/python'),str(PROBE)],env=env,
            cwd=PROBE.parents[2],capture_output=True,text=True,timeout=110)
        assert proc.returncode==0, proc.stdout[-1500:]+'\n'+proc.stderr[-5000:]
        result=json.loads((isolated/f'compression-{mode}.json').read_text())
        evidence = PROBE.parents[2]/'docs/p1/evidence'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/f'compression-{mode}.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
        assert result['summary_model_calls']>0
        assert result['section_registered'] and result['initial_prompt_description_count']==1, (result,proc.stderr[:1800])
        assert result['initial_description_consumed'] and result['successor_description_not_injected']
        assert result['original_row_ids_preserved'] and result['active_rows_with_new_ids']>0
        assert result['repeated_user_before']==2
        assert result['changed_cwd_rebuild_description_count']==0
        assert not result['canonical_visible_equal'], result
    finally:
        shutil.rmtree(isolated)
