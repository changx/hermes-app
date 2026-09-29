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
                async def full_page():
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?latest=true&limit=100") as response:
                        assert response.status==200,await response.text()
                        return await response.json()
                # A duplicate HTTP POST with the exact client id has one input
                # and one command reply, even after a cold metadata read.
                prior=await full_page()
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'native-real-help','text':'/help'}) as response:
                    assert response.status==202
                same=await full_page()
                assert same==prior,'Idempotent POST published another reply'
                target=same['messages'][-1]
                async with b.get(root+f"/v1/threads/{one['id']}/messages?ref_seq={target['ref_seq']}") as response:
                    exact=await response.json()
                    assert response.status==200 and exact['messages']==[target] and exact['next_cursor'] is None
                for bad in ('0','-1','junk',str(10**9)):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?ref_seq={bad}") as response:
                        assert response.status==400,(bad,response.status)
                async with b.get(root+f"/v1/threads/{two['id']}/messages?ref_seq={target['ref_seq']}") as response:
                    assert response.status==400
                export=await send_command('save md','native-save-md')
                exported=(await full_page())['messages'][-2]
                assert exported['attachments'] and exported['attachments'][0]['state']=='available',exported
                att=exported['attachments'][0]
                async with b.get(root+f"/v1/threads/{one['id']}/attachments/{att['id']}") as response:
                    content=await response.read()
                    assert response.status==200 and b'P1_FIRST' in content
                assert 'Export complete' in export['text']
                assert (await send_command('compress --preview','native-compress-preview'))['text']
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'native-busy-owner','text':'P1_TIMELINE'}) as response:
                    assert response.status==202
                for _ in range(100):
                    if (HOME/'timeline-tool-entered').exists(): break
                    await asyncio.sleep(.05)
                assert (HOME/'timeline-tool-entered').exists()
                try:
                    busy=[]
                    for command in ('/status','/model'):
                        async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                          json={'client_message_id':'native-busy-'+command[1:],
                                                'text':command}) as response:
                            assert response.status==202
                            busy.append((command,(await response.json())['receipt']['id']))
                    for command,rid in busy:
                        for _ in range(100):
                            async with b.get(root+'/v1/receipts/'+rid) as response:
                                receipt=(await response.json())['receipt']
                            if receipt['state'] not in ('queued','running'): break
                            await asyncio.sleep(.03)
                        assert receipt['state']=='completed',(command,receipt)
                        assert adapter._store.direct_receipt_has_output(rid),(command,receipt)
                    during=await full_page()
                    assert any('running' in m['text'].lower() or "can't run" in m['text'].lower()
                               for m in during['messages'][-4:] if m.get('display_kind')=='direct'),during['messages'][-5:]
                finally:
                    (HOME/'timeline-tool-release').write_text('1')
                for _ in range(200):
                    finished=await full_page()
                    if not finished['incomplete_turns'] and finished['messages'][-1]['text']=='SYNTHETIC_P1_FINAL': break
                    await asyncio.sleep(.03)
                assert not finished['incomplete_turns']
                branched=await send_command('branch --here native-check','native-branch')
                assert branched['text'] and adapter._store.thread_for_session(
                    (await runner.async_session_store.get_or_create_session(adapter._source(channel['id'],one['id']))).session_id)==one['id']
                switched=await send_command('new','native-new')
                assert switched['text'] and adapter._store.thread_for_session(
                    (await runner.async_session_store.get_or_create_session(adapter._source(channel['id'],one['id']))).session_id)==one['id']
                session_before_resume=(await runner.async_session_store.get_or_create_session(
                    adapter._source(channel['id'],one['id']))).session_id
                # A session already owned by the sibling App thread cannot be
                # imported into this thread, including via a native --all resume.
                forbidden=await send_command('resume '+two['session_id']+' --all','native-foreign-resume')
                assert forbidden['text'] and adapter._store.thread_for_session(two['session_id'])==two['id']
                now=await runner.async_session_store.get_or_create_session(adapter._source(channel['id'],one['id']))
                assert now.session_id==session_before_resume and adapter._store.thread_for_session(now.session_id)==one['id']
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'native-model-after-switch','text':'MODEL_AFTER_SWITCH'}) as response:
                    assert response.status==202
                for _ in range(200):
                    later=await full_page()
                    if later['messages'][-1]['text']=='SYNTHETIC_P1_FINAL' and not later['incomplete_turns']:
                        break
                    await asyncio.sleep(.03)
                assert [m['text'] for m in later['messages'][-2:]]==['MODEL_AFTER_SWITCH','SYNTHETIC_P1_FINAL'],later
                assert later['messages'][-1].get('display_kind')!='direct'
                assert not adapter._store.direct_receipt_has_output(later['messages'][-2]['receipt_id'])
                before_btw=core_rows()
                started=await send_command('btw what is the answer','native-btw-real')
                for _ in range(200):
                    side=await full_page()
                    if len([m for m in side['messages'] if m.get('display_kind')=='direct'
                            and m['ref_seq']>started['ref_seq']])>=1:
                        break
                    await asyncio.sleep(.03)
                answers=[m for m in side['messages'] if m.get('display_kind')=='direct'
                         and m['ref_seq']>started['ref_seq']]
                assert len(answers)==1 and answers[0]['text'] and core_rows()==before_btw,answers
                assert answers[0]['ref_seq']>started['ref_seq']
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'native-retry-real','text':'/retry'}) as response:
                    assert response.status==202
                    retry_receipt=(await response.json())['receipt']
                for _ in range(200):
                    retry_page=await full_page()
                    async with b.get(root+'/v1/receipts/'+retry_receipt['id']) as response:
                        retry_receipt=(await response.json())['receipt']
                    if retry_receipt['state'] not in ('queued','running') and not retry_page['incomplete_turns']:
                        break
                    await asyncio.sleep(.03)
                assert retry_receipt['state']=='completed',(retry_receipt,retry_page['messages'][-5:],
                    adapter._store.turn_state('ingress:'+retry_receipt['id']))
                assert not adapter._store.direct_receipt_has_output(retry_receipt['id'])
                assert retry_page['messages'][-1]['text']=='SYNTHETIC_P1_FINAL',retry_page
                assert retry_page['messages'][-1].get('display_kind')!='direct'
                async with b.get(root+f"/v1/threads/{one['id']}/search?q=MODEL_AFTER_SWITCH") as response:
                    found=await response.json()
                    assert response.status==200 and [m['text'] for m in found['messages']]==['MODEL_AFTER_SWITCH'],found
                async with b.get(root+f"/v1/threads/{one['id']}/messages?ref_seq={later['messages'][-1]['ref_seq']}") as response:
                    old=await response.json()
                    assert response.status==200 and old['messages']==[later['messages'][-1]],old
                # Native background-free output remains on a cold history read.
                cold=type(adapter._store)(HOME/'hermes-app/metadata.sqlite').history_page(one['id'],HOME/'state.db',latest=True,limit=100)
                assert cold['messages'][-1]['text']=='SYNTHETIC_P1_FINAL'
                (HOME.parent/'command-result.json').write_text(json.dumps({'real':real,'dispatch':covered,'model_session_unchanged':True,'save_download_bytes':len(content),'exact_ref':target['ref_seq'],'retry_receipt':retry_receipt['state'],'cross_thread_reply':forbidden['text']}))
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
