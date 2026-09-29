"""Real GatewayRunner regression: native leftover steer after the final tool."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ.get('HERMES_BASELINE', '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'))
PROBE = Path(__file__).with_name('runner_probe.py')


def test_last_tool_followup_uses_core_turn_without_duplicate_input():
    source = PROBE.read_text()
    source = source.replace("Path(__file__).resolve().parents[2] / 'plugins'", f"Path({str(ROOT)!r}) / 'plugins'")
    source = source.replace("Path(__file__).with_name('synthetic_tool_plugin')",
                            f"Path({str(PROBE.with_name('synthetic_tool_plugin'))!r})")
    source = source.replace("'security:\\n  tirith_enabled: false\\n'",
                            "'security:\\n  tirith_enabled: false\\n'\n        'display:\\n  busy_input_mode: steer\\n'")
    source = source.replace("self.server.tool_calls < (1 if COMPACT_MODE == 'timeline' else 3)",
                            "self.server.tool_calls < (2 if COMPACT_MODE == 'timeline' else 3)\n"
                            "                     and (self.server.tool_calls == 0 or 'FOLLOWUP_FINAL' in json.dumps(request.get('messages', [])))")
    source = source.replace("        if request.get('stream'):\n", '''        if (COMPACT_MODE == 'timeline' and not call_tool and self.server.tool_calls == 1
                and 'P1_TIMELINE' in json.dumps(request.get('messages', []))):
            (HOME/'final-entered').write_text('1')
            deadline = time.monotonic() + 15
            while not (HOME/'final-release').exists() and time.monotonic() < deadline:
                time.sleep(.01)
            assert (HOME/'final-release').exists(), 'final release missing'
        if request.get('stream'):
''')
    start = source.index("            if COMPACT_MODE == 'timeline':")
    end = source.index("            if COMPACT_MODE == 'race':", start)
    branch = '''            if COMPACT_MODE == 'timeline':
                async with a.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'final-owner','text':'P1_TIMELINE'}) as resp:
                    assert resp.status==202,await resp.text()
                for _ in range(200):
                    if (HOME/'timeline-tool-entered').exists(): break
                    await asyncio.sleep(.05)
                assert (HOME/'timeline-tool-entered').exists()
                (HOME/'timeline-tool-release').write_text('1')
                for _ in range(200):
                    if (HOME/'final-entered').exists(): break
                    await asyncio.sleep(.05)
                assert (HOME/'final-entered').exists(), 'final model response did not block'
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'followup-final','text':'FOLLOWUP_FINAL'}) as resp:
                    assert resp.status==202,await resp.text()
                    receipt=(await resp.json())['receipt']
                async with b.post(root+f"/v1/threads/{one['id']}/messages",
                                  json={'client_message_id':'followup-final','text':'FOLLOWUP_FINAL'}) as resp:
                    assert resp.status==202,await resp.text()
                    retry=(await resp.json())['receipt']
                assert retry['id']==receipt['id']
                (HOME/'final-release').write_text('1')
                for _ in range(300):
                    async with a.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as resp:
                        status=resp.status
                        page=await resp.json() if status==200 else {}
                    if (status==200 and model.tool_calls==2 and
                        sum(m['role']=='assistant' for m in page['messages'])>=4 and
                        not page['incomplete_turns']): break
                    await asyncio.sleep(.05)
                assert status==200,(status,page)
                async with a.get(root+f"/v1/threads/{one['id']}/messages?latest=true&limit=100") as resp:
                    latest=await resp.json(); assert resp.status==200
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=2") as resp:
                    first_page=await resp.json(); assert resp.status==200
                paged=first_page['messages'][:]
                cursor=first_page['next_cursor']
                while cursor:
                    async with b.get(root+f"/v1/threads/{one['id']}/messages",params={'limit':'2','after':cursor}) as resp:
                        assert resp.status==200,await resp.text()
                        segment=await resp.json()
                    paged.extend(segment['messages']); cursor=segment['next_cursor']
                async with b.get(root+f"/v1/threads/{one['id']}/search",params={'q':'FOLLOWUP_FINAL'}) as resp:
                    search_status=resp.status
                    search=await resp.json() if resp.status==200 else {}
                with sqlite3.connect(HOME/'state.db') as db:
                    db.row_factory=sqlite3.Row
                    rows=[dict(r) for r in db.execute('SELECT id,role,content,platform_message_id,display_kind,tool_calls '
                        'FROM messages WHERE session_id=? ORDER BY id',(one['session_id'],))]
                for _ in range(200):
                    async with a.get(root+'/v1/receipts/'+receipt['id']) as resp:
                        final_receipt=(await resp.json())['receipt']
                    if final_receipt['state']!='running': break
                    await asyncio.sleep(.05)
                events=[json.loads(x) for x in (HOME/'synthetic-events.jsonl').read_text().splitlines()]
                result={'page':page,'latest':latest,'paged':paged,'search':search,'search_status':search_status,
                        'rows':rows,'model_tool_calls':model.tool_calls,'events':events,
                        'receipt':final_receipt,'retry':retry,
                        'model_requests':len(model.requests)}
                (HOME.parent/'followup-final-result.json').write_text(json.dumps(result))
                return
'''
    source=source[:start]+branch+source[end:]
    assert "'display:\\n  busy_input_mode: steer\\n'" in source
    isolated = Path(tempfile.mkdtemp(prefix='followup-final-', dir=os.environ.get('TMPDIR', str(ROOT))))
    home = isolated/'h'; home.mkdir()
    script = isolated/'probe.py'; script.write_text(source)
    env = {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(isolated),'HERMES_HOME':str(home),
           'XDG_CONFIG_HOME':str(isolated/'x'),'XDG_DATA_HOME':str(isolated/'d'),
           'TMPDIR':os.environ.get('TMPDIR',str(isolated)),'PYTHONPATH':str(BASE),
           'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','TIRITH_ENABLED':'false',
           'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
           'HERMES_APP_ALLOWED_USERS':'owner','P1_COMPACT_MODE':'timeline','P1_SMALL_TOOLS':'1',
           'LANG':'C.UTF-8','HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1',
           'NO_PROXY':'localhost,127.0.0.1,::1'}
    try:
        proc=subprocess.run([str(BASE/'.venv/bin/python'),str(script)],env=env,cwd=ROOT,
                            capture_output=True,text=True,timeout=90)
        assert proc.returncode==0,proc.stdout[-2000:]+'\n'+proc.stderr[-7000:]
        result=json.loads((isolated/'followup-final-result.json').read_text())
        page=result['page']['messages']
        assert result['model_tool_calls']==2,result
        assert sum(e['event']=='tool_handler' for e in result['events'])==2,result
        assert page==result['latest']['messages']==result['paged'],result
        assert sum(m['role']=='user' and m['text']=='FOLLOWUP_FINAL' for m in page)==1,page
        assert sum(m.get('receipt_id')==result['receipt']['id'] for m in page)==1,page
        assert not any('Gateway message origin' in m['text'] for m in page),page
        assert sum(bool(m['role']=='assistant' and m.get('tool_calls')) for m in page)==2,page
        assert sum(m['role']=='assistant' and m['text']=='SYNTHETIC_P1_FINAL' for m in page)==3,page
        assert len([r for r in result['rows'] if r['role']=='user' and r['platform_message_id'] is None])==1
        assert result['search_status']==200,result
        assert sum(m['text']=='FOLLOWUP_FINAL' for m in result['search']['messages'])==1,result
        assert result['receipt']['state']=='received',result
        assert result['retry']['id']==result['receipt']['id']
    finally:
        shutil.rmtree(isolated)
