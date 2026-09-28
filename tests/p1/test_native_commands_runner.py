"""Actual pinned Gateway command dispatch, with an isolated local provider."""
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name('runner_probe.py')


def test_real_native_command_replies_are_history_only():
    source = PROBE.read_text()
    source = source.replace("Path(__file__).resolve().parents[2] / 'plugins'", f"Path({str(ROOT)!r}) / 'plugins'")
    source = source.replace("Path(__file__).with_name('synthetic_tool_plugin')", f"Path({str(PROBE.with_name('synthetic_tool_plugin'))!r})")
    start = source.index("            if COMPACT_MODE == 'timeline':")
    end = source.index("            if COMPACT_MODE == 'race':", start)
    source = source[:start] + '''            if COMPACT_MODE == 'timeline':
                async def send_command(name, ident):
                    async with a.post(root+f"/v1/threads/{one['id']}/messages",json={'client_message_id':ident,'text':'/'+name}) as response:
                        assert response.status==202,await response.text()
                        receipt=(await response.json())['receipt']
                    for _ in range(300):
                        async with a.get(root+'/v1/receipts/'+receipt['id']) as response:
                            receipt=(await response.json())['receipt']
                        if receipt['state'] not in ('queued','running'): break
                        await asyncio.sleep(.02)
                    assert receipt['state']=='completed',(name,receipt)
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?latest=true&limit=100") as response:
                        assert response.status==200,await response.text()
                        page=await response.json()
                    assert not page['incomplete_turns'],(name,page)
                    assert page['messages'][-1].get('display_kind')=='direct',(name,page)
                    return page['messages'][-1]
                def core_rows():
                    with sqlite3.connect(HOME/'state.db') as db:
                        return db.execute('SELECT id,session_id,role,content FROM messages ORDER BY id').fetchall()
                before=core_rows();requests_before=len(model.requests)
                real=[]
                for name in ('help','commands','status','usage','context','version','whoami','platform'):
                    output=await send_command(name,'native-real-'+name)
                    assert output['text'].strip(),name
                    real.append(name)
                assert core_rows()==before,'Native direct replies polluted model session'
                assert len(model.requests)==requests_before,'Read-only native commands called model'
                # Every shared/idle built-in is dispatched through the same real
                # gateway path. Stub ONLY command effects: never reboot, log in,
                # spend credits or change account settings during this test.
                covered=[]
                for name in dict.fromkeys((*runner._PLAIN_COMMANDS,*runner._IDLE_COMMANDS)):
                    method=runner._COMMAND_HANDLER_ALIASES.get(name,f"_handle_{name.replace('-', '_')}_command")
                    original=getattr(runner,method)
                    async def reply(event,label=name): return 'DIRECT_DISPATCH:'+label
                    setattr(runner,method,reply)
                    try:
                        output=await send_command(name,'native-dispatch-'+name)
                        assert output['text']=='DIRECT_DISPATCH:'+name,(name,output)
                        covered.append(name)
                    finally: setattr(runner,method,original)
                assert core_rows()==before,'Dispatch probe polluted model session'
                # Native background-free output remains on a cold history read.
                cold=type(adapter._store)(HOME/'hermes-app/metadata.sqlite').history_page(one['id'],HOME/'state.db',latest=True,limit=100)
                assert cold['messages'][-1]['text']=='DIRECT_DISPATCH:'+covered[-1]
                (HOME.parent/'command-result.json').write_text(json.dumps({'real':real,'dispatch':covered,'model_session_unchanged':True}))
                return
''' + source[end:]
    scratch = Path('/home/hermes/.hermes/profiles/jamie/cache/scratch')
    with TemporaryDirectory(prefix='native-command-', dir=scratch) as tmp:
        isolated=Path(tmp);home=isolated/'h';home.mkdir()
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
                              capture_output=True,text=True,timeout=180)
        assert result.returncode==0,result.stdout[-1500:]+'\n'+result.stderr[-9000:]
        proof=json.loads((isolated/'command-result.json').read_text())
        assert proof['model_session_unchanged']
        print(json.dumps(proof,ensure_ascii=False))
