"""Real native steer during a tool, then during the final model response."""
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name('runner_probe.py')


def test_owner_completion_survives_native_continuation_tools():
    source = PROBE.read_text()
    source = source.replace("Path(__file__).resolve().parents[2] / 'plugins'", f"Path({str(ROOT)!r}) / 'plugins'")
    source = source.replace("Path(__file__).with_name('synthetic_tool_plugin')", f"Path({str(PROBE.with_name('synthetic_tool_plugin'))!r})")
    source = source.replace("'security:\\n  tirith_enabled: false\\n'", "'security:\\n  tirith_enabled: false\\n'\n        'display:\\n  busy_input_mode: steer\\n'")
    source = source.replace('    model.requests = []', '    model.final_entered = threading.Event()\n    model.final_release = threading.Event()\n    model.requests = []')
    source = source.replace('        if call_tool:\n', '''        if COMPACT_MODE == 'timeline' and self.server.tool_calls == 1 and 'FOLLOWUP_BETA' in json.dumps(request.get('messages', [])):
            call_tool = True
        if (COMPACT_MODE == 'timeline' and self.server.tool_calls == 1 and not call_tool
                and 'FOLLOWUP_ALPHA' in json.dumps(request.get('messages', []))):
            self.server.final_entered.set()
            assert self.server.final_release.wait(20), 'final response not released'
        if call_tool:
''')
    start = source.index("            if COMPACT_MODE == 'timeline':")
    end = source.index("            if COMPACT_MODE == 'race':", start)
    source = source[:start] + '''            if COMPACT_MODE == 'timeline':
                async def send(ident, text):
                    async with a.post(root+f"/v1/threads/{one['id']}/messages",
                            json={'client_message_id':ident,'text':text}) as response:
                        assert response.status == 202, await response.text()
                        return (await response.json())['receipt']
                async def wait_for(predicate):
                    for _ in range(400):
                        if predicate(): return
                        await asyncio.sleep(.05)
                    raise AssertionError('native continuation did not reach expected checkpoint')
                owner = await send('owner', 'P1_TIMELINE')
                try:
                    await wait_for(lambda: (HOME/'timeline-tool-entered').exists())
                    alpha = await send('alpha', 'FOLLOWUP_ALPHA')
                    assert alpha['handed_off'] is True
                    (HOME/'timeline-tool-release').write_text('1')
                    await wait_for(model.final_entered.is_set)
                    beta = await send('beta', 'FOLLOWUP_BETA')
                    assert beta['handed_off'] is True
                finally:
                    (HOME/'timeline-tool-release').write_text('1')
                    model.final_release.set()
                for _ in range(400):
                    receipts = []
                    for r in (owner,alpha,beta):
                        async with a.get(root+'/v1/receipts/'+r['id']) as response:
                            receipts.append((await response.json())['receipt'])
                    if all(r['state'] not in ('queued','running') for r in receipts): break
                    await asyncio.sleep(.05)
                assert receipts[0]['state'] == 'completed', receipts
                assert all(r['state']=='received' and r['handed_off'] for r in receipts[1:]), receipts
                assert model.tool_calls == 2, model.tool_calls
                async with b.get(root+f"/v1/threads/{one['id']}/messages?limit=100") as response:
                    assert response.status == 200
                    page = await response.json()
                assert not page['incomplete_turns'], page
                messages = page['messages']
                inputs = [m for m in messages if m.get('client_message_id') in ('owner','alpha','beta')]
                assert [m['client_message_id'] for m in inputs] == ['owner','alpha','beta']
                assert all('Gateway message origin' not in m['text'] for m in messages), messages
                assert sum(m['role']=='user' for m in messages) == 4, messages
                tail = [m for m in messages if m['ref_seq'] > inputs[0]['ref_seq']]
                assert sum(bool(m.get('tool_calls')) for m in tail)==2, tail
                assert [m['text'] for m in tail if m['role']=='assistant' and m['text']] == ['SYNTHETIC_P1_FINAL']*2
                for r in model.requests:
                    text=json.dumps(r.get('messages',[]))
                    if 'FOLLOWUP_BETA' in text:
                        assert text.index('P1_TIMELINE') < text.index('FOLLOWUP_ALPHA') < text.index('FOLLOWUP_BETA')
                with sqlite3.connect(HOME/'hermes-app'/'metadata.sqlite') as db:
                    original_turn=db.execute('SELECT turn_id FROM ingress_links WHERE ingress_id=?',('ingress:'+owner['id'],)).fetchone()[0]
                    display_turn=db.execute('SELECT turn_id FROM message_refs WHERE input_receipt_id=?',(owner['id'],)).fetchone()[0]
                    assert original_turn == display_turn
                cold = type(adapter._store)(adapter._store.path)
                assert cold.history_page(one['id'],HOME/'state.db')['messages'] == messages
                for ident,text,r in [('owner','P1_TIMELINE',owner),('alpha','FOLLOWUP_ALPHA',alpha),('beta','FOLLOWUP_BETA',beta)]:
                    assert (await send(ident,text))['id']==r['id']
                assert cold.history_page(one['id'],HOME/'state.db')['messages'] == messages
                (HOME.parent/'ownership-result.json').write_text(json.dumps({'owner_state':receipts[0]['state'],'tool_calls':model.tool_calls,'input_order':[m['client_message_id'] for m in inputs]}))
                return
''' + source[end:]
    scratch = Path('/home/hermes/.hermes/profiles/jamie/cache/scratch')
    with TemporaryDirectory(prefix='owner-runner-', dir=scratch) as tmp:
        isolated = Path(tmp)
        home = isolated / 'h'
        home.mkdir()
        script = isolated / 'probe.py'
        script.write_text(source)
        env = {'PATH':'/usr/local/bin:/usr/bin:/bin', 'HOME':str(isolated), 'HERMES_HOME':str(home),
               'XDG_CONFIG_HOME':str(isolated/'x'), 'XDG_DATA_HOME':str(isolated/'d'),
               'TMPDIR':str(scratch), 'PYTHONPATH':str(BASE), 'PYTHONDONTWRITEBYTECODE':'1',
               'PYTHONNOUSERSITE':'1', 'TIRITH_ENABLED':'false', 'LANG':'C.UTF-8',
               'HERMES_APP_TOKEN':'synthetic-p1-test-token-with-32-characters',
               'HERMES_APP_ALLOWED_USERS':'owner', 'P1_COMPACT_MODE':'timeline',
               'HTTP_PROXY':'http://127.0.0.1:1', 'HTTPS_PROXY':'http://127.0.0.1:1',
               'NO_PROXY':'localhost,127.0.0.1,::1'}
        proc = subprocess.run([str(BASE/'.venv/bin/python'),str(script)], env=env, cwd=ROOT,
                              capture_output=True, text=True, timeout=90)
        assert proc.returncode == 0, proc.stdout[-1500:]+'\n'+proc.stderr[-7000:]
        result = json.loads((isolated/'ownership-result.json').read_text())
        assert result == {'owner_state':'completed', 'tool_calls':2, 'input_order':['owner','alpha','beta']}
