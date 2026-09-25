"""Real isolated GatewayRunner crash windows with a local synthetic model."""
import asyncio
import base64
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import tempfile
from pathlib import Path

import aiohttp
import pytest

BASE=Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT=Path(__file__).resolve().parents[2]
EVIDENCE=Path(os.environ.get('P1_EVIDENCE_DIR',str(ROOT/'docs/p1/evidence')))
TOKEN='synthetic-p1-test-token-with-32-characters'


def _env(root):
    return {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(root),'HERMES_HOME':str(root/'h'),
            'XDG_CONFIG_HOME':str(root/'x'),'XDG_DATA_HOME':str(root/'d'),
            'TMPDIR':os.environ.get('TMPDIR','/tmp'),'PYTHONPATH':str(BASE),
            'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
            'HERMES_APP_TOKEN':TOKEN,'HERMES_APP_ALLOWED_USERS':'owner',
            'LANG':'C.UTF-8','HTTP_PROXY':'http://127.0.0.1:1',
            'HTTPS_PROXY':'http://127.0.0.1:1','NO_PROXY':'localhost,127.0.0.1,::1'}


async def _wait(path, proc=None, seconds=35):
    for _ in range(int(seconds*20)):
        if path.exists():
            return
        if proc and proc.poll() is not None:
            raise AssertionError(f'child exited {proc.returncode}: {path}')
        await asyncio.sleep(.05)
    raise AssertionError(f'timed out waiting for {path}')


async def _start(root, phase):
    ready=root/'h'/'ready.json'
    ready.unlink(missing_ok=True)
    log=(root/f'child-{phase}.log').open('w')
    proc=subprocess.Popen([str(BASE/'.venv/bin/python'),str(ROOT/'tests/p1/delivery_child.py')],
                          env=_env(root),cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
    try:
        await _wait(ready,proc)
        info=json.loads(ready.read_text())
        assert info['hook_order_verified']
        return proc,log,f"http://127.0.0.1:{info['port']}"
    except BaseException:
        proc.kill();proc.wait(timeout=5);log.close()
        raise


def _kill(proc,log):
    if proc.poll() is None:
        proc.kill()
    proc.wait(timeout=8)
    log.close()


async def _post(client,url,payload):
    async with client.post(url,json=payload) as response:
        body=await response.json() if response.content_type=='application/json' else await response.text()
        return response.status,body


async def _get(client,url):
    async with client.get(url) as response:
        return response.status,await response.json()


async def _new_thread(client,root):
    status,data=await _post(client,root+'/v1/channels',{'name':'Crash channel'})
    assert status==201,data
    status,data=await _post(client,root+f"/v1/channels/{data['channel']['id']}/threads",{'title':'Crash thread'})
    assert status==201,data
    return data['thread']['id']


async def _receipt(client,root,receipt_id,state,seconds=30):
    for _ in range(int(seconds*20)):
        status,data=await _get(client,root+'/v1/receipts/'+receipt_id)
        assert status==200,data
        if data['receipt']['state']==state:
            return data['receipt']
        if data['receipt']['state'] in ('completed','failed','interrupted','unknown'):
            raise AssertionError(f'receipt reached {data}')
        await asyncio.sleep(.05)
    raise AssertionError(f'receipt {receipt_id} did not reach {state}: {data}')


def _requests(home):
    path=home/'model-requests.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def _assert_artifact_bound(root):
    size=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
    assert size<=64*1024*1024,f'isolated probe exceeded 64 MiB: {size}'


async def _scenario(root,mode):
    home=root/'h'
    proc,log,url=await _start(root,'before')
    try:
        async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as first, \
                   aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as second:
            thread=await _new_thread(first,url)
            endpoint=url+f'/v1/threads/{thread}/messages'
            content={'queued':'P1_BLOCK','tool':'P1_TOOL_WINDOW','final':'P1_FINAL_WINDOW'}[mode]
            message_id=f'client-{mode}'
            status,data=await _post(first,endpoint,{'client_message_id':message_id,'text':content})
            assert status==202,data
            receipt=data['receipt']['id']
            assert data['receipt']['durable']
            duplicate=await asyncio.gather(*[
                _post(second,endpoint,{'client_message_id':message_id,'text':content}) for _ in range(4)])
            assert all(s==202 and x['receipt']['id']==receipt for s,x in duplicate)
            status,_=await _post(second,endpoint,{'client_message_id':message_id,'text':'different'})
            assert status==409
            cursor=(await _get(second,url+'/v1/sync'))[1]['waterline']
            queued=None
            if mode=='queued':
                await _wait(home/'model-requests.jsonl',proc)
                assert _requests(home)[0]['blocked']
                for _ in range(40):
                    with sqlite3.connect(home/'hermes-app'/'metadata.sqlite') as meta:
                        linked=meta.execute('SELECT user_row_id,pending_text FROM receipts WHERE id=?',
                                            (receipt,)).fetchone()
                    if linked[0] is not None:
                        break
                    await asyncio.sleep(.05)
                assert linked[0] is not None and linked[1] is None,linked
                status,data=await _post(second,endpoint,{'client_message_id':'client-second','text':'P1_SECOND_QUEUED'})
                assert status==202,data
                queued=data['receipt']['id']
                assert (await _get(second,url+'/v1/receipts/'+queued))[1]['receipt']['state']=='queued'
            elif mode=='tool':
                await _wait(home/'tool-marker',proc)
                assert (home/'tool-marker').read_text().splitlines()==['called']
            else:
                await _wait(home/'final-hook-marker',proc)
                with sqlite3.connect(home/'state.db') as core:
                    rows=core.execute("SELECT id,role,content FROM messages WHERE platform_message_id=? "
                                      "OR (role='assistant' AND content LIKE '%SYNTHETIC_P1_FINAL%')",
                                      (receipt,)).fetchall()
                assert any(r[1]=='user' for r in rows),rows
                assert any(r[1]=='assistant' for r in rows),rows
            before_count=len(_requests(home))
            _kill(proc,log)
            proc=None
            proc,log,url=await _start(root,'after')
            endpoint=url+f'/v1/threads/{thread}/messages'
            await _receipt(second,url,receipt,'unknown')
            if queued:
                await _receipt(second,url,queued,'completed')
            status,retry=await _post(second,endpoint,{'client_message_id':message_id,'text':content})
            assert status==202 and retry['receipt']['id']==receipt and retry['receipt']['state']=='unknown'
            status,page=await _get(second,url+f'/v1/threads/{thread}/messages?limit=100')
            assert status==200,page
            assert sum(m['text']==content for m in page['messages'])==1,page
            if mode=='final':
                assert sum('SYNTHETIC_P1_FINAL' in m['text'] for m in page['messages'])==1,page
            if queued:
                assert [(m['role'],m['text']) for m in page['messages']][-2:]==[
                    ('user','P1_SECOND_QUEUED'),('assistant','SYNTHETIC_P1_FINAL')],page
            assert len(_requests(home))==before_count+(1 if queued else 0),_requests(home)
            if mode=='tool':
                assert (home/'tool-marker').read_text().splitlines()==['called']
            status,replay=await _get(second,url+'/v1/sync?cursor='+cursor)
            assert status==200 and replay['events'],replay
            assert len({e['event_id'] for e in replay['events']})==len(replay['events'])
            ws_url=url.replace('http:','ws:')+'/v1/events?cursor='+cursor
            ws1=await first.ws_connect(ws_url)
            ws2=await second.ws_connect(ws_url)
            assert (await ws1.receive_json())['type']=='hello'
            assert (await ws2.receive_json())['type']=='hello'
            event1=await ws1.receive_json();event2=await ws2.receive_json()
            assert event1['event_id']==event2['event_id']==replay['events'][0]['event_id']
            await ws1.close();await ws2.close()
            return {'mode':mode,'receipt':receipt,'state':'unknown',
                    'queued_recovered':bool(queued),'hook_order_verified':True,
                    'model_requests_before':before_count,'model_requests_after':len(_requests(home)),
                    'visible_messages':len(page['messages']),'replayed_events':len(replay['events'])}
    finally:
        if proc is not None:
            _kill(proc,log)


@pytest.mark.parametrize('mode',['queued','tool','final'])
def test_real_crash_recovery(mode):
    root=Path(tempfile.mkdtemp(prefix='p103-',dir=os.environ['TMPDIR']))
    (root/'h').mkdir()
    try:
        result=asyncio.run(_scenario(root,mode))
        _assert_artifact_bound(root)
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        (EVIDENCE/f'delivery-{mode}.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    except BaseException:
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        logs='\n'.join(p.name+'\n'+p.read_text(errors='replace')[-10000:]
                       for p in root.glob('child-*.log'))
        logs+='\n'+'\n'.join(str(p.relative_to(root))+'\n'+p.read_text(errors='replace')[-20000:]
                            for p in (root/'h'/'logs').glob('*.log'))
        if (root/'h'/'model-requests.jsonl').exists():
            logs+='\nmodel requests: '+(root/'h'/'model-requests.jsonl').read_text()
        for filename,tables in [('h/hermes-app/metadata.sqlite',('receipts','turns','ingress_links','message_refs')),
                                ('h/state.db',('messages',))]:
            dbpath=root/filename
            if dbpath.exists():
                with sqlite3.connect(dbpath) as db:
                    for table in tables:
                        rows=db.execute(f'SELECT * FROM {table} LIMIT 30').fetchall()
                        logs+=f'\n{filename} {table}: {rows!r}'
        (EVIDENCE/f'delivery-{mode}-failure.log').write_text(logs[-20000:])
        raise
    finally:
        shutil.rmtree(root)


async def _offline_and_sync(root):
    home=root/'h'
    proc,log,url=await _start(root,'online')
    try:
        first=aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN})
        second=aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN})
        try:
            thread=await _new_thread(first,url)
            endpoint=url+f'/v1/threads/{thread}/messages'
            status,snapshot=await _get(second,url+'/v1/snapshot')
            assert status==200 and snapshot['threads'][0]['id']==thread
            cursor=snapshot['waterline']
            first_ws=await first.ws_connect(url.replace('http:','ws:')+'/v1/events?cursor='+cursor)
            second_ws=await second.ws_connect(url.replace('http:','ws:')+'/v1/events?cursor='+cursor)
            assert (await first_ws.receive_json())['type']=='hello'
            assert (await second_ws.receive_json())['type']=='hello'
            status,data=await _post(first,endpoint,{'client_message_id':'offline-first','text':'P1_BLOCK'})
            assert status==202
            receipt=data['receipt']['id']
            await _wait(home/'model-block-once',proc)
            await first_ws.close();await first.close()
            (home/'model-release').write_text('1')
            await _receipt(second,url,receipt,'completed')
            status,page=await _get(second,url+f'/v1/threads/{thread}/messages?limit=100')
            assert status==200 and [(m['role'],m['text']) for m in page['messages']]==[
                ('user','P1_BLOCK'),('assistant','SYNTHETIC_P1_FINAL')]
            received=[]
            for _ in range(10):
                event=await asyncio.wait_for(second_ws.receive_json(),5)
                received.append(event)
                if sum(e.get('kind')=='message' for e in received)==2:
                    break
            assert sum(e.get('kind')=='message' for e in received)==2,received
            await second_ws.close()
            async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as reconnected:
                status,replay=await _get(reconnected,url+'/v1/sync?cursor='+cursor)
                assert status==200
                assert [e['event_id'] for e in replay['events'][:len(received)]]==[
                    e['event_id'] for e in received if e.get('type')=='event']
                status,retry=await _post(reconnected,endpoint,
                                         {'client_message_id':'offline-first','text':'P1_BLOCK'})
                assert status==202 and retry['receipt']['id']==receipt
            # More than the old in-memory replay window, via real durable metadata writes.
            for index in range(520):
                async with second.patch(url+f'/v1/threads/{thread}',json={'title':f'T{index}'}) as response:
                    assert response.status==200
            ids=[]
            after=cursor
            while True:
                status,part=await _get(second,url+'/v1/sync?limit=100&cursor='+after)
                assert status==200
                ids.extend(e['event_id'] for e in part['events'])
                after=part['next_cursor']
                if not part['has_more']:
                    break
            assert len(ids)>=525 and ids==sorted(set(ids))
            status,later=await _get(second,url+'/v1/snapshot')
            assert status==200 and later['waterline']==after
            last=page['messages'][-1]['ref_seq']
            status,read=await _post(second,url+f'/v1/threads/{thread}/read',{'ref_seq':last})
            assert status==200 and read=={'ref_seq':last,'unread_count':0}
            status,read=await _post(second,url+f'/v1/threads/{thread}/read',{'ref_seq':0})
            assert status==200 and read['ref_seq']==last and read['unread_count']==0
            status,seen=await _get(second,url+'/v1/snapshot')
            assert status==200 and seen['threads'][0]['read_ref']==last
            async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+TOKEN}) as other_device:
                status,other_seen=await _get(other_device,url+'/v1/snapshot')
                assert status==200 and other_seen['threads'][0]['read_ref']==last
                assert other_seen['threads'][0]['unread_count']==0
            decoded=json.loads(base64.urlsafe_b64decode(after+'='*(-len(after)%4)))
            foreign=base64.urlsafe_b64encode(json.dumps(['foreign',decoded[1]]).encode()).decode().rstrip('=')
            future=base64.urlsafe_b64encode(json.dumps([decoded[0],decoded[1]+100]).encode()).decode().rstrip('=')
            for bad in (foreign,future,'bad'):
                async with second.get(url+'/v1/sync?cursor='+bad) as response:
                    assert response.status==400
            status,current=await _get(second,url+'/v1/snapshot')
            revoke_ws=await second.ws_connect(url.replace('http:','ws:')+
                                              '/v1/events?cursor='+current['waterline'])
            assert (await revoke_ws.receive_json())['type']=='hello'
            (home/'revoke-token').write_text('1')
            for _ in range(20):
                item=await asyncio.wait_for(revoke_ws.receive(),10)
                if item.type in (aiohttp.WSMsgType.CLOSE,aiohttp.WSMsgType.CLOSED):
                    break
            else:
                raise AssertionError('old authenticated socket survived rotation')
            async with second.get(url+'/v1/capabilities') as response:
                assert response.status==401
            return {'mode':'offline_sync','events_after_cursor':len(ids),
                    'two_ws_clients':True,'offline_final_visible':True,
                    'read_ref':last,'unread_count':0,'future_foreign_rejected':True,
                    'revocation_closes_socket':True}
        finally:
            await first.close();await second.close()
    finally:
        _kill(proc,log)


def test_real_offline_sync_and_read():
    root=Path(tempfile.mkdtemp(prefix='p103-sync-',dir=os.environ['TMPDIR']))
    (root/'h').mkdir()
    try:
        result=asyncio.run(_offline_and_sync(root))
        _assert_artifact_bound(root)
        EVIDENCE.mkdir(parents=True,exist_ok=True)
        (EVIDENCE/'delivery-offline-sync.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    finally:
        shutil.rmtree(root)
