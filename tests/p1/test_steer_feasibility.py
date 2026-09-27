"""Disposable real-runner native-steer spike; no application or core edits."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import shutil

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name('runner_probe.py')


def test_real_gateway_busy_steer_at_blocked_tool():
    source = PROBE.read_text()
    source = source.replace("Path(__file__).resolve().parents[2] / 'plugins'", "Path('" + str(ROOT) + "') / 'plugins'")
    source = source.replace("Path(__file__).with_name('synthetic_tool_plugin')", "Path('" + str(PROBE.with_name('synthetic_tool_plugin')) + "')")
    source = source.replace("'security:\\n  tirith_enabled: false\\n'",  "'security:\\n  tirith_enabled: false\\n'\n        'display:\\n  busy_input_mode: steer\\n'")
    start = source.index("            if COMPACT_MODE == 'timeline':")
    end = source.index("            if COMPACT_MODE == 'race':", start)
    replacement = '''            if COMPACT_MODE == 'timeline':
                from gateway.platforms.base import MessageEvent
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':uuid.uuid4().hex,'text':'P1_TIMELINE'}) as resp:
                    assert resp.status == 202, await resp.text()
                for _ in range(200):
                    if (HOME/'timeline-tool-entered').exists():
                        break
                    await asyncio.sleep(.05)
                assert (HOME/'timeline-tool-entered').exists()
                steer_ids = ['native-steer-id-A', 'native-steer-id-B']
                steer_texts = ['FOLLOWUP_ALPHA', 'FOLLOWUP_BETA']
                events = []
                try:
                    for message_id, text in zip(steer_ids, steer_texts):
                        async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                json={'client_message_id':message_id,'text':text}) as resp:
                            assert resp.status == 202, await resp.text()
                            receipt=(await resp.json())['receipt']
                        async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                json={'client_message_id':message_id,'text':text}) as resp:
                            retry=(await resp.json())['receipt']
                        assert receipt['id']==retry['id']
                        events.append(receipt)
                    state = runner._peek_session_state(adapter._event_session_key(
                        MessageEvent(text='x',source=adapter._source(one['project_id'],one['id']))))
                    pending = state.turn.agent._pending_steer if state and state.turn.agent else None
                finally:
                    (HOME/'timeline-tool-release').write_text('1')
                for _ in range(200):
                    if any('FOLLOWUP_BETA' in json.dumps(r.get('messages',[]))
                           for r in model.requests):
                        break
                    await asyncio.sleep(.05)
                for _ in range(200):
                    async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        page = await resp.json()
                    if (not page['incomplete_turns'] and
                            all(any(m['id']=='receipt:'+e['id'] for m in page['messages']) for e in events)):
                        break
                    await asyncio.sleep(.05)
                async with a.get(root+f"/v1/threads/{one['id']}/messages?latest=true&limit=100") as resp:
                    latest=await resp.json()
                    assert resp.status==200
                assert [(m['id'],m['ref_seq']) for m in latest['messages']]==[
                    (m['id'],m['ref_seq']) for m in page['messages']]
                with sqlite3.connect(HOME/'state.db') as raw:
                    raw.row_factory = sqlite3.Row
                    rows = [dict(r) for r in raw.execute(
                        'SELECT id,session_id,role,content,display_kind,platform_message_id '
                        'FROM messages WHERE session_id=? ORDER BY id', (one['session_id'],))]
                receipts=[]
                for _ in range(200):
                    receipts=[]
                    for receipt in events:
                        async with a.get(root+'/v1/receipts/'+receipt['id']) as resp:
                            receipts.append((await resp.json())['receipt'])
                    if all(r['state']!='running' for r in receipts):
                        break
                    await asyncio.sleep(.05)
                result = {'events':events,'receipts':receipts,'pending_before_release':pending,
                    'model_followup_requests':[
                        [{'role':m.get('role'),'content':m.get('content')}
                         for m in r.get('messages',[]) if m.get('role')=='user'
                         and ('FOLLOWUP_' in str(m.get('content')))]
                        for r in model.requests if 'FOLLOWUP_' in json.dumps(r.get('messages',[]))],
                    'core_rows':rows,'plugin_page':page,
                    'tool_call_count':model.tool_calls}
                # A busy guard with no live agent must use native FIFO, not
                # complete against the preceding primary's assistant row.
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                        json={'client_message_id':'boundary-owner','text':'P1_RACE'}) as resp:
                    assert resp.status==202
                for _ in range(200):
                    if (HOME/'race-hook-entered').exists(): break
                    await asyncio.sleep(.05)
                assert (HOME/'race-hook-entered').exists()
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                        json={'client_message_id':'boundary-next','text':'FOLLOWUP_BOUNDARY'}) as resp:
                    assert resp.status==202, await resp.text()
                    boundary=(await resp.json())['receipt']
                async with a.post(root+f"/v1/threads/{one['id']}/stop",json={}) as resp:
                    result['stopped']=(await resp.json())
                    assert resp.status==200
                (HOME/'race-hook-release').write_text('1')
                for _ in range(300):
                    async with a.get(root+'/v1/receipts/'+boundary['id']) as resp:
                        boundary_final=(await resp.json())['receipt']
                    if boundary_final['state'] not in ('queued','running'): break
                    await asyncio.sleep(.05)
                result['boundary']={'initial':boundary,'final':boundary_final}
                async with a.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                    result['boundary']['history']=await resp.json()
                with sqlite3.connect(HOME/'state.db') as raw:
                    result['boundary']['core_user_rows']=raw.execute(
                        "SELECT COUNT(*) FROM messages WHERE session_id=? AND role='user' "
                        'AND platform_message_id=?', (one['session_id'],boundary['id'])).fetchone()[0]
                reopened=type(adapter._store)(adapter._store.path)
                result['boundary']['reopened']=reopened.history_page(one['id'],HOME/'state.db')
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                        json={'client_message_id':'boundary-next','text':'FOLLOWUP_BOUNDARY'}) as resp:
                    result['boundary']['retry']=(await resp.json())['receipt']
                # Uploaded media remains on the ordinary queued owner path.
                async with a.post(root+f"/v1/threads/{one['id']}/attachments",
                        data=b'proof',headers={'X-File-Name':'proof.txt'}) as resp:
                    assert resp.status==201,await resp.text()
                    attachment=(await resp.json())['attachment']['id']
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                        json={'client_message_id':'media-next','text':'MEDIA_FOLLOWS',
                              'attachments':[attachment]}) as resp:
                    assert resp.status==202,await resp.text()
                    media=(await resp.json())['receipt']
                for _ in range(300):
                    async with a.get(root+'/v1/receipts/'+media['id']) as resp:
                        media_final=(await resp.json())['receipt']
                    if media_final['state'] not in ('queued','running'): break
                    await asyncio.sleep(.05)
                result['media']={'initial':media,'final':media_final}
                (HOME.parent/'native-steer-result.json').write_text(json.dumps(result, sort_keys=True))
                return
'''
    source = source[:start] + replacement + source[end:]
    assert "'display:\\n  busy_input_mode: steer\\n'" in source
    scratch = Path('/home/hermes/.hermes/profiles/jamie/home')
    isolated = Path(tempfile.mkdtemp(prefix='s-', dir=scratch))
    home = isolated/'h'; home.mkdir()
    script = isolated/'probe.py'; script.write_text(source)
    env = {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(isolated),'HERMES_HOME':str(home),
        'XDG_CONFIG_HOME':str(isolated/'x'),'XDG_DATA_HOME':str(isolated/'d'),
        'TMPDIR':str(scratch),'PYTHONPATH':str(BASE),'PYTHONDONTWRITEBYTECODE':'1',
        'PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
        'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
        'HERMES_APP_ALLOWED_USERS':'owner','P1_COMPACT_MODE':'timeline','LANG':'C.UTF-8',
        'HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1',
        'NO_PROXY':'localhost,127.0.0.1,::1'}
    try:
        proc = subprocess.run([str(BASE/'.venv/bin/python'),str(script)],env=env,cwd=ROOT,
                              capture_output=True,text=True,timeout=90)
        assert proc.returncode == 0, proc.stdout[-1500:]+'\n'+proc.stderr[-5000:]
        result = json.loads((isolated/'native-steer-result.json').read_text())
        assert result['tool_call_count'] == 1
        assert len(result['model_followup_requests']) == 1
        assert len({event['id'] for event in result['events']})==2
        assert all(event['admission']=='followup' and event['state']=='running'
                   for event in result['events'])
        assert all(text in result['pending_before_release']
                   for text in ('FOLLOWUP_ALPHA', 'FOLLOWUP_BETA'))
        delivered = result['model_followup_requests'][0]
        assert len(delivered) == 1 and delivered[0]['role'] == 'user'
        rows = [r for r in result['core_rows'] if r['display_kind'] == 'steer']
        assert len(rows) == 1 and rows[0]['platform_message_id'] is None
        for message_id, text in [('native-steer-id-A', 'FOLLOWUP_ALPHA'),
                                 ('native-steer-id-B', 'FOLLOWUP_BETA')]:
            assert delivered[0]['content'].count(text) == 1
            assert rows[0]['content'].count('"message_id": "'+next(
                e['id'] for e in result['events'] if e['client_message_id']==message_id)+'"') == 1
        assert [r['role'] for r in result['core_rows'][-5:]] == [
            'user', 'assistant', 'tool', 'user', 'assistant']
        assert not result['plugin_page']['incomplete_turns']
        page=result['plugin_page']['messages']
        projected=[m for m in page if m['id'].startswith('receipt:')]
        assert [(m['receipt_id'],m['client_message_id'],m['text']) for m in projected]==[
            (event['id'],event['client_message_id'],text) for event,text in
            zip(result['events'],('FOLLOWUP_ALPHA','FOLLOWUP_BETA'))]
        assert projected[0]['ref_seq']<projected[1]['ref_seq']
        assert [m['id'] for m in page].index(projected[1]['id']) < len(page)-1
        assert all('Gateway message origin' not in m['text'] for m in page)
        assert not any(m['id']==str(rows[0]['id']) for m in page)
        assert result['receipts'] and all(r['state']=='received' and r['admission']=='followup'
                                          for r in result['receipts'])
        assert result['boundary']['initial']['admission']=='followup'
        assert result['stopped']['stopped'] is True
        assert result['boundary']['final']['state']=='received'
        assert result['boundary']['final']['admission']=='followup'
        assert result['boundary']['core_user_rows']==0
        assert any(m['id']=='receipt:'+result['boundary']['initial']['id'] and
                   m['text']=='FOLLOWUP_BOUNDARY' for m in result['boundary']['history']['messages'])
        assert result['boundary']['history']['messages']==result['boundary']['reopened']['messages']
        assert result['boundary']['retry']['id']==result['boundary']['initial']['id']
        assert sum(m['id']=='receipt:'+result['boundary']['initial']['id']
                   for m in result['boundary']['reopened']['messages'])==1
        assert 'admission' not in result['media']['initial']
        assert result['media']['final']['state']=='completed'
        print('native_busy_steer: 2 distinct original inputs, no aggregate duplicate, next model request consumed both')
    finally:
        shutil.rmtree(isolated)
