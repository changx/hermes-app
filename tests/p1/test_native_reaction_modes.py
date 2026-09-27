"""App forwards busy text to the native mode, including queue and redirect."""
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name('runner_probe.py')


@pytest.mark.parametrize('mode', ['queue', 'interrupt'])
def test_native_mode_callbacks_are_the_reaction_source(mode):
    source = PROBE.read_text()
    source = source.replace("Path(__file__).resolve().parents[2] / 'plugins'", f"Path({str(ROOT)!r}) / 'plugins'")
    source = source.replace("Path(__file__).with_name('synthetic_tool_plugin')", f"Path({str(PROBE.with_name('synthetic_tool_plugin'))!r})")
    source = source.replace("'security:\\n  tirith_enabled: false\\n'", "'security:\\n  tirith_enabled: false\\n'\n        " + repr(f'display:\n  busy_input_mode: {mode}\n'))
    start = source.index("            if COMPACT_MODE == 'timeline':")
    end = source.index("            if COMPACT_MODE == 'race':", start)
    source = source[:start] + '''            if COMPACT_MODE == 'timeline':
                callback_states = {}
                original_start, original_complete = adapter.on_processing_start, adapter.on_processing_complete
                async def observed_start(event):
                    callback_states[event.message_id]='running'
                    await original_start(event)
                async def observed_complete(event, outcome):
                    from gateway.platforms.base import ProcessingOutcome
                    callback_states[event.message_id]={ProcessingOutcome.SUCCESS:'completed',
                        ProcessingOutcome.FAILURE:'failed',ProcessingOutcome.CANCELLED:'interrupted'}[outcome]
                    await original_complete(event,outcome)
                adapter.on_processing_start,adapter.on_processing_complete=observed_start,observed_complete
                async def send(ident,text):
                    async with a.post(root+f"/v1/threads/{one['id']}/messages",
                            json={'client_message_id':ident,'text':text}) as response:
                        assert response.status==202,await response.text()
                        return (await response.json())['receipt']
                owner=await send('mode-owner','P1_TIMELINE')
                try:
                    for _ in range(400):
                        if (HOME/'timeline-tool-entered').exists(): break
                        await asyncio.sleep(.05)
                    assert (HOME/'timeline-tool-entered').exists()
                    alpha=await send('mode-alpha','MODE_ALPHA')
                    beta=await send('mode-beta','MODE_BETA')
                    assert alpha['handed_off'] and beta['handed_off']
                finally:
                    (HOME/'timeline-tool-release').write_text('1')
                for _ in range(400):
                    receipts=[]
                    for r in (owner,alpha,beta):
                        async with a.get(root+'/v1/receipts/'+r['id']) as response:
                            receipts.append((await response.json())['receipt'])
                    if all(r['state'] not in ('queued','running') for r in receipts): break
                    await asyncio.sleep(.05)
                assert all(r['state'] not in ('queued','running') for r in receipts),receipts
                assert any('MODE_BETA' in json.dumps(r.get('messages',[])) for r in model.requests)
                assert owner['id'] in callback_states
                for r in receipts:
                    assert r['processing']==callback_states.get(r['id']),(r,callback_states)
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as response:
                    assert response.status==200
                    page=await response.json()
                inputs=[m for m in page['messages'] if m.get('client_message_id','').startswith('mode-')]
                assert [m['client_message_id'] for m in inputs]==['mode-owner','mode-alpha','mode-beta']
                (HOME.parent/'mode-result.json').write_text(json.dumps({'receipts':receipts,'callbacks':callback_states}))
                return
''' + source[end:]
    scratch = Path('/home/hermes/.hermes/profiles/jamie/cache/scratch')
    with TemporaryDirectory(prefix='reaction-mode-',dir=scratch) as tmp:
        isolated=Path(tmp); home=isolated/'h';home.mkdir()
        script=isolated/'probe.py';script.write_text(source)
        env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(isolated),'HERMES_HOME':str(home),
             'XDG_CONFIG_HOME':str(isolated/'x'),'XDG_DATA_HOME':str(isolated/'d'),
             'TMPDIR':str(scratch),'PYTHONPATH':str(BASE),'PYTHONDONTWRITEBYTECODE':'1',
             'PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false','LANG':'C.UTF-8',
             'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
             'HERMES_APP_ALLOWED_USERS':'owner','P1_COMPACT_MODE':'timeline',
             'HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1',
             'NO_PROXY':'localhost,127.0.0.1,::1'}
        result=subprocess.run([str(BASE/'.venv/bin/python'),str(script)],env=env,cwd=ROOT,
                              capture_output=True,text=True,timeout=90)
        assert result.returncode==0,result.stdout[-1500:]+'\n'+result.stderr[-8000:]
        proof=json.loads((isolated/'mode-result.json').read_text())
        print(mode,[(r['client_message_id'],r['state'],r['processing']) for r in proof['receipts']])
