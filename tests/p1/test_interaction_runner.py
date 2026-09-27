"""P1-04 real plugin loader/GatewayRunner and synthetic local tools."""
import asyncio
import json
import inspect
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

import aiohttp

BASE=Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT=Path(__file__).resolve().parents[2]
TOKEN='synthetic-p1-test-token-with-32-characters'
EVIDENCE=Path(os.environ.get('P1_EVIDENCE_DIR',str(ROOT/'docs/p1/evidence')))


def _env(root):
    return {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(root),'HERMES_HOME':str(root/'h'),
        'XDG_CONFIG_HOME':str(root/'x'),'XDG_DATA_HOME':str(root/'d'),
        'TMPDIR':os.environ.get('TMPDIR','/tmp'),'PYTHONPATH':str(BASE),
        'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
        'HERMES_APP_TOKEN':TOKEN,'HERMES_APP_ALLOWED_USERS':'owner','P1_04':'1',
        'LANG':'C.UTF-8','HTTP_PROXY':'http://127.0.0.1:1',
        'HTTPS_PROXY':'http://127.0.0.1:1','NO_PROXY':'localhost,127.0.0.1,::1'}


async def _wait(predicate, seconds=30):
    deadline=asyncio.get_running_loop().time()+seconds
    while asyncio.get_running_loop().time()<deadline:
        value=predicate()
        if inspect.isawaitable(value):
            value=await value
        if value:
            return value
        await asyncio.sleep(.05)
    raise AssertionError('bounded wait expired')


async def _start(root, phase):
    home=root/'h'
    (home/'ready.json').unlink(missing_ok=True)
    log=(root/f'04-{phase}.log').open('w')
    proc=subprocess.Popen([str(BASE/'.venv/bin/python'),str(ROOT/'tests/p1/delivery_child.py')],
        cwd=ROOT,env=_env(root),stdout=log,stderr=subprocess.STDOUT)
    try:
        await _wait(lambda: (home/'ready.json').exists() or proc.poll() is not None,45)
        assert proc.poll() is None,f'child exited: {proc.returncode}'
        port=json.loads((home/'ready.json').read_text())['port']
        return proc,log,f'http://127.0.0.1:{port}'
    except BaseException:
        proc.kill();proc.wait(timeout=8);log.close()
        raise


def _kill(proc,log):
    if proc.poll() is None:
        proc.kill()
    proc.wait(timeout=8)
    log.close()


async def _json(client,method,url,body=None):
    async with client.request(method,url,json=body) as response:
        data=await response.json() if response.content_type=='application/json' else await response.text()
        return response.status,data


async def _thread(client,root,channel=None,title='04 thread'):
    if channel is None:
        code,data=await _json(client,'POST',root+'/v1/channels',{'name':'04 synthetic'})
        assert code==201,data
        channel=data['channel']['id']
    code,data=await _json(client,'POST',root+f'/v1/channels/{channel}/threads',{'title':title})
    assert code==201,data
    return channel,data['thread']['id']


async def _send(client,root,tid,text,client_id,attachments=None):
    payload={'client_message_id':client_id,'text':text}
    if attachments is not None:
        payload['attachments']=attachments
    code,data=await _json(client,'POST',root+f'/v1/threads/{tid}/messages',payload)
    assert code==202,data
    return data['receipt']['id']


async def _receipt(client,root,receipt_id,states=('completed',),seconds=30):
    last=None
    async def probe():
        nonlocal last
        code,data=await _json(client,'GET',root+'/v1/receipts/'+receipt_id)
        assert code==200,data
        last=data['receipt']
        return data['receipt'] if data['receipt']['state'] in states else None
    try:
        return await _wait(probe,seconds)
    except AssertionError as exc:
        raise AssertionError(f'receipt did not reach {states}: {last}') from exc


async def _interaction(client,root,tid,kind,seconds=30):
    async def probe():
        code,data=await _json(client,'GET',root+'/v1/sync')
        assert code==200,data
        for event in reversed(data['events']):
            if event['kind']=='interaction' and event['thread_id']==tid:
                code,found=await _json(client,'GET',root+f"/v1/threads/{tid}/interactions/{event['ref']}")
                if code==200 and found['interaction']['kind']==kind and found['interaction']['state']=='pending':
                    return found['interaction']
        return None
    return await _wait(probe,seconds)


async def _answer(client,root,tid,item,choice,**overrides):
    payload={'choice':choice,'receipt_id':item['receipt_id'],'generation':item['generation']}
    payload.update(overrides)
    return await _json(client,'POST',root+f"/v1/threads/{tid}/interactions/{item['id']}/answer",payload)


async def _ws_event(ws,kind,tid,seconds=15):
    deadline=asyncio.get_running_loop().time()+seconds
    while asyncio.get_running_loop().time()<deadline:
        message=await ws.receive(timeout=max(.1,deadline-asyncio.get_running_loop().time()))
        if message.type==aiohttp.WSMsgType.TEXT:
            value=json.loads(message.data)
            if value.get('type')=='event' and value.get('kind')==kind and value.get('thread_id')==tid:
                return value
    raise AssertionError(f'WS {kind} event missing')


async def _scenario(root):
    home=root/'h'
    proc,log,url=await _start(root,'first')
    evidence={}
    try:
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as a, \
                   aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as b:
            channel,tid=await _thread(a,url)
            _,other=await _thread(a,url,channel,'other owner')
            ws_url=url.replace('http:','ws:')+'/v1/events'
            async with a.ws_connect(ws_url) as ws_a,b.ws_connect(ws_url) as ws_b:
                approval_receipt=await _send(a,url,tid,'P1_APPROVAL','approval-1')
                prompt=await _interaction(a,url,tid,'approval')
                assert prompt['receipt_id']==approval_receipt and prompt['state']=='pending'
                assert prompt['generation']
                await _ws_event(ws_a,'interaction',tid)
                await _ws_event(ws_b,'interaction',tid)
                bad,_=await _answer(a,url,tid,prompt,'invalid')
                foreign,_=await _answer(b,url,other,prompt,'once')
                assert bad==400 and foreign==404
                generation_bad,_=await _answer(a,url,tid,prompt,'once',generation='old-generation')
                receipt_bad,_=await _answer(a,url,tid,prompt,'once',receipt_id='rc_foreign')
                assert generation_bad==409 and receipt_bad==409
                outcomes=await asyncio.gather(_answer(a,url,tid,prompt,'once'),
                                              _answer(b,url,tid,prompt,'deny'))
                assert sorted(code for code,_ in outcomes)==[200,409],outcomes
                assert (home/'gate-executed').exists()==(outcomes[0][0]==200)
                await _ws_event(ws_a,'interaction',tid)
                await _ws_event(ws_b,'interaction',tid)
                await _receipt(a,url,approval_receipt,('completed','failed'))
                evidence['approval_two_client_codes']=[code for code,_ in outcomes]
            clarify_receipt=await _send(a,url,other,'P1_CLARIFY','clarify-1')
            clarify=await _interaction(a,url,other,'clarify')
            assert clarify['receipt_id']==clarify_receipt
            wrong,_=await _answer(a,url,other,clarify,'Gamma')
            assert wrong==400
            valid=clarify['choices'][0]
            code,_=await _answer(b,url,other,clarify,valid)
            assert code==200
            await _receipt(a,url,clarify_receipt,('completed','failed'))
            evidence['clarify_answered']=True

            # A stopped tool cannot execute its post-release side effect. A
            # queued receipt is cancelled independently; another Thread runs.
            held=await _send(a,url,tid,'P1_HOLD_TOOL','hold-1')
            await _wait(lambda:(home/'hold-entered').exists())
            queued=await _send(a,url,tid,'queued after hold','hold-queued')
            code,_=await _json(a,'POST',url+f'/v1/threads/{tid}/receipts/{queued}/cancel',{})
            assert code==200
            code,_=await _json(a,'POST',url+f'/v1/threads/{tid}/stop',{})
            assert code==200
            await _receipt(a,url,held,('interrupted','unknown','failed'),seconds=20)
            (home/'hold-release').write_text('release')
            await asyncio.sleep(.2)
            assert not (home/'hold-side-effect').exists()
            other_receipt=await _send(b,url,other,'other thread lives','other-lives')
            await _receipt(b,url,other_receipt)
            evidence['stop_isolated']=True

            blob=b'local attachment bytes\x00\x01'
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=blob,
                              headers={'X-File-Name':'notes.txt'}) as response:
                assert response.status==201,await response.text()
                uploaded=(await response.json())['attachment']['id']
            path=url+f'/v1/threads/{tid}/attachments/{uploaded}'
            async with b.get(path) as response:
                assert response.status==200 and await response.read()==blob
                assert response.headers['X-Content-Type-Options']=='nosniff'
            async with aiohttp.ClientSession() as anonymous:
                async with anonymous.get(path) as response:
                    assert response.status==401
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'bad',
                              headers={'X-File-Name':'../escape.txt'}) as response:
                assert response.status==400
            assert (await _json(b,'GET',url+f'/v1/threads/{other}/attachments/{uploaded}'))[0]==404
            wrong_ref,_=await _json(b,'POST',url+f'/v1/threads/{other}/messages',
                {'client_message_id':'wrong-attachment','text':'bad ref','attachments':[uploaded]})
            assert wrong_ref==400
            with sqlite3.connect(home/'hermes-app'/'metadata.sqlite') as meta:
                assert meta.execute('SELECT receipt_id FROM attachments WHERE id=?',(uploaded,)).fetchone()==(None,)
            attachment_receipt=await _send(a,url,tid,'Read attached file','file-1',[uploaded])
            await _receipt(a,url,attachment_receipt)
            assert (await _json(a,'DELETE',path))[0]==409
            requests=[json.loads(line) for line in (home/'model-requests.jsonl').read_text().splitlines()]
            assert any(uploaded in item['latest'] for item in requests),requests[-3:]
            evidence['agent_saw_attachment_path']=True
            # Real runner must also process a user turn containing only files.
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'attachment-only synthetic content',
                              headers={'X-File-Name':'%E4%B8%AD%E6%96%87%20%E9%99%84%E4%BB%B6.txt','X-File-Name-Encoding':'percent-utf8'}) as response:
                assert response.status==201,await response.text()
                metadata=(await response.json())['attachment']
                assert metadata['name']=='中文 附件.txt'
                only=metadata['id']
            only_receipt=await _send(a,url,tid,'','files-only',[only])
            await _receipt(a,url,only_receipt)
            assert await _send(a,url,tid,'','files-only',[only])==only_receipt
            requests=[json.loads(line) for line in (home/'model-requests.jsonl').read_text().splitlines()]
            assert any(only in item['latest'] for item in requests)
            code,history=await _json(a,'GET',url+f'/v1/threads/{tid}/messages?limit=100')
            assert code==200
            only_rows=[m for m in history['messages'] if m.get('receipt_id')==only_receipt and m['role']=='user']
            assert len(only_rows)==1,only_rows
            assert [item['id'] for item in only_rows[0]['attachments']]==[only]
            evidence['attachment_only_history']=True
            for invalid_name in ('%2e%2e%2fsecret.txt','%FF.txt','bad%XX.txt','name%0A.txt'):
                async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'invalid filename',
                                  headers={'X-File-Name':invalid_name,'X-File-Name-Encoding':'percent-utf8'}) as response:
                    assert response.status==400
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'garbage',
                              headers={'X-File-Name':'loose.txt'}) as response:
                loose=(await response.json())['attachment']['id']
            assert (await _json(a,'DELETE',url+f'/v1/threads/{tid}/attachments/{loose}'))[0]==200
            assert not (home/'hermes-app'/'attachments'/loose).exists()
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'temporary',
                              headers={'X-File-Name':'symlink.txt'}) as response:
                linked=(await response.json())['attachment']['id']
            linked_path=home/'hermes-app'/'attachments'/linked
            linked_path.unlink()
            linked_path.symlink_to(home/'config.yaml')
            assert (await _json(a,'GET',url+f'/v1/threads/{tid}/attachments/{linked}'))[0]==409
            assert (await _json(a,'DELETE',url+f'/v1/threads/{tid}/attachments/{linked}'))[0]==200
            blocked=await _send(a,url,tid,'P1_APPROVAL','symlink-ingress-block')
            pending=await _interaction(a,url,tid,'approval')
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'ingress',
                              headers={'X-File-Name':'ingress.txt'}) as response:
                ingress=(await response.json())['attachment']['id']
            ingress_path=home/'hermes-app'/'attachments'/ingress
            ingress_path.unlink()
            ingress_path.symlink_to(home/'config.yaml')
            denied=await _send(a,url,tid,'symlink ingress must fail','symlink-ingress',[ingress])
            assert (await _answer(a,url,tid,pending,'deny'))[0]==200
            await _receipt(a,url,blocked,('completed','failed'))
            await _receipt(a,url,denied,('failed',))
            assert (await _json(a,'GET',url+f'/v1/threads/{tid}/attachments/{ingress}/metadata'))[1]['attachment']['state']=='missing'
            ingress_path.unlink()
            evidence['symlink_ingress_rejected']=True
            async with a.post(url+f'/v1/threads/{tid}/attachments',data=b'x'*(10*1024*1024+1),
                              headers={'X-File-Name':'oversize.bin'}) as response:
                assert response.status==413,await response.text()
            assert not list((home/'hermes-app'/'attachments').glob('.partial-*'))
            async def broken_upload():
                yield b'partial synthetic bytes'
                raise RuntimeError('synthetic upload interruption')
            try:
                await a.post(url+f'/v1/threads/{tid}/attachments',data=broken_upload(),
                             headers={'X-File-Name':'partial.txt'})
            except (RuntimeError,aiohttp.ClientError):
                pass
            await asyncio.sleep(.1)
            assert not list((home/'hermes-app'/'attachments').glob('.partial-*'))
            symlink='att_'+'a'*32
            (home/'hermes-app'/'attachments'/symlink).symlink_to(home/'config.yaml')
            assert (await _json(a,'GET',url+f'/v1/threads/{tid}/attachments/{symlink}'))[0]==404
            (home/'hermes-app'/'attachments'/symlink).unlink()

            code,search=await _json(b,'GET',url+f'/v1/threads/{tid}/search?q=Read%20attached&limit=1')
            assert code==200 and len(search['messages'])==1,search
            ref=search['messages'][0]['ref_seq']
            assert (await _json(a,'DELETE',url+f'/v1/threads/{tid}'))[0]==200
            code,again=await _json(b,'GET',url+f'/v1/threads/{tid}/search?q=Read%20attached&limit=1')
            assert code==200 and again['messages'][0]['ref_seq']==ref
            retry=await _send(a,url,tid,'Read attached file','file-1',[uploaded])
            assert retry==attachment_receipt
            evidence['archived_search_retry']=True

            # Cron fires from the real isolated scheduler, through live adapter.
            _,cron_thread=await _thread(a,url,channel,'cron target')
            (home/'cron-fire.json').write_text(json.dumps({'project_id':channel,'thread_id':cron_thread}))
            await _wait(lambda:(home/'cron-fire.done').exists(),40)
            fired=json.loads((home/'cron-fire.done').read_text())
            assert fired['tick_count']>=1,fired
            assert fired['execution']['status']=='completed',fired['execution'].get('error')
            code,history=await _json(b,'GET',url+f'/v1/threads/{cron_thread}/messages')
            assert code==200 and len(history['messages'])==1,history
            assert history['messages'][0]['role']=='assistant'
            assert 'P1_CRON_RESULT' in history['messages'][0]['text']
            first_ref=history['messages'][0]['ref_seq']
            (home/'cron-fire.done').unlink()
            (home/'cron-fire.json').write_text(json.dumps({'project_id':channel,'thread_id':cron_thread}))
            await _wait(lambda:(home/'cron-fire.done').exists(),40)
            fired_second=json.loads((home/'cron-fire.done').read_text())
            assert fired_second['job_id']==fired['job_id'] and fired_second['tick_count']>=1
            code,history=await _json(b,'GET',url+f'/v1/threads/{cron_thread}/messages')
            assert code==200 and len(history['messages'])==2,history
            assert history['messages'][0]['text']==history['messages'][1]['text'],history
            assert history['messages'][0]['ref_seq']!=history['messages'][1]['ref_seq']
            evidence['cron_jobs']=[fired['job_id'],fired_second['job_id']]
            evidence['same_recurring_job_two_fires']=True
            evidence['cron_refs']=[item['ref_seq'] for item in history['messages']]
            assert evidence['cron_refs'][0]==first_ref
            before=await _json(b,'GET',url+'/v1/sync')
            assert any(e['kind']=='message' and e['thread_id']==cron_thread for e in before[1]['events'])
            (home/'cron-gap.json').write_text(json.dumps({'thread_id':cron_thread}))
            await _wait(lambda:(home/'cron-gap.done').exists())
            code,before_repair=await _json(b,'GET',url+f'/v1/threads/{cron_thread}/messages')
            assert code==200 and len(before_repair['messages'])==2
    finally:
        _kill(proc,log)

    proc,log,url=await _start(root,'cold')
    try:
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as client:
            async with client.get(url+f'/v1/threads/{tid}/attachments/{uploaded}') as response:
                assert response.status==200 and await response.read()==blob
            code,history=await _json(client,'GET',url+f'/v1/threads/{cron_thread}/messages')
            assert code==200 and [item['ref_seq'] for item in history['messages'][:2]]==evidence['cron_refs']
            assert len(history['messages'])==3 and history['messages'][2]['text']=='P1_CRON_GAP'
            evidence['cron_crash_window_repaired']=True
            evidence['cold_download_and_cron']=True
    finally:
        _kill(proc,log)
    return evidence


def test_real_interactions_stop_attachment_search_cron():
    root=Path(tempfile.mkdtemp(prefix='p104-',dir=os.environ['TMPDIR']))
    (root/'h').mkdir()
    try:
        result=asyncio.run(asyncio.wait_for(_scenario(root),180))
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        (EVIDENCE/'04-runner.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    except BaseException:
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        for log in root.glob('04-*.log'):
            (EVIDENCE/('04-'+log.name)).write_text(log.read_text(errors='replace')[-50000:])
        raise
    finally:
        shutil.rmtree(root)


async def _restart_scenario(root):
    home=root/'h'
    proc,log,url=await _start(root,'restart-before')
    try:
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as client:
            _,tid=await _thread(client,url)
            old_receipt=await _send(client,url,tid,'P1_APPROVAL','old-approval')
            old=await _interaction(client,url,tid,'approval')
            assert old['receipt_id']==old_receipt
    finally:
        _kill(proc,log)
    attachment_root=home/'hermes-app'/'attachments'
    attachment_root.mkdir(exist_ok=True)
    orphan=attachment_root/('att_'+'b'*32)
    partial=attachment_root/('.partial-'+'c'*32)
    orphan.write_bytes(b'orphan')
    partial.write_bytes(b'partial')
    proc,log,url=await _start(root,'restart-after')
    try:
        assert not orphan.exists() and not partial.exists()
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as client:
            code,expired=await _json(client,'GET',url+f"/v1/threads/{tid}/interactions/{old['id']}")
            assert code==200 and expired['interaction']['state']=='expired',expired
            stale,_=await _answer(client,url,tid,old,'once')
            assert stale==409 and not (home/'gate-executed').exists()
            receipt=await _send(client,url,tid,'P1_APPROVAL','new-approval')
            new=await _interaction(client,url,tid,'approval')
            assert new['id']!=old['id'] and new['generation']!=old['generation']
            assert (await _answer(client,url,tid,old,'once'))[0]==409
            assert (await _answer(client,url,tid,new,'deny'))[0]==200
            await _receipt(client,url,receipt,('completed','failed'))
            assert not (home/'gate-executed').exists()
            _,clarify_thread=await _thread(client,url,title='stop clarify')
            waiting=await _send(client,url,clarify_thread,'P1_CLARIFY','stop-clarify')
            prompt=await _interaction(client,url,clarify_thread,'clarify')
            stopped,_=await _json(client,'POST',url+f'/v1/threads/{clarify_thread}/stop',{})
            assert stopped==200
            assert (await _answer(client,url,clarify_thread,prompt,prompt['choices'][0]))[0]==409
            await _receipt(client,url,waiting,('interrupted','unknown','failed'))
            _,approval_thread=await _thread(client,url,title='stop approval')
            waiting_approval=await _send(client,url,approval_thread,'P1_APPROVAL','stop-approval')
            approval=await _interaction(client,url,approval_thread,'approval')
            assert (await _json(client,'POST',url+f'/v1/threads/{approval_thread}/stop',{}))[0]==200
            assert (await _answer(client,url,approval_thread,approval,'once'))[0]==409
            await _receipt(client,url,waiting_approval,('interrupted','unknown','failed'))
            assert not (home/'gate-executed').exists()
            return {'old_generation_expired':True,'new_generation_rejected_old_id':True,
                    'stopped_clarify_waiter':True,'stopped_approval_waiter':True}
    finally:
        _kill(proc,log)


def test_restart_expires_waiters_and_stop_wakes_clarify():
    root=Path(tempfile.mkdtemp(prefix='p104-',dir=os.environ['TMPDIR']))
    (root/'h').mkdir()
    try:
        result=asyncio.run(asyncio.wait_for(_restart_scenario(root),120))
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        (EVIDENCE/'04-restart.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    except BaseException:
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        for log in root.glob('04-*.log'):
            (EVIDENCE/('04-'+log.name)).write_text(log.read_text(errors='replace')[-50000:])
        raise
    finally:
        shutil.rmtree(root)
