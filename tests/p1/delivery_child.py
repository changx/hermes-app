"""Isolated real GatewayRunner process for P1-03 OS crash tests."""
import asyncio
import json
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE=Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT=Path(__file__).resolve().parents[2]
HOME=Path(os.environ['HERMES_HOME'])


class Model(BaseHTTPRequestHandler):
    def log_message(self,*args):
        pass

    def do_POST(self):
        assert self.path=='/v1/chat/completions'
        request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        latest=next((str(m.get('content','')) for m in reversed(request.get('messages',[]))
                     if m.get('role')=='user'),'')
        messages=request.get('messages',[])
        current_start=next((i for i in range(len(messages)-1,-1,-1)
                            if messages[i].get('role')=='user'),0)
        current_turn=messages[current_start:]
        compact=os.environ.get('P1_COMPACT_CRASH')=='1'
        block='P1_BLOCK' in latest and not (HOME/'model-block-once').exists()
        if block:
            (HOME/'model-block-once').write_text('1')
        with (HOME/'model-requests.jsonl').open('a') as stream:
            stream.write(json.dumps({'blocked':block,'tool':'P1_TOOL_WINDOW' in latest,
                                      'compact':'P1_COMPACT_FINAL_WINDOW' in json.dumps(request.get('messages',[])),
                                      'final':'P1_FINAL_WINDOW' in latest,'latest':latest[:200]})+'\n')
            stream.flush(); os.fsync(stream.fileno())
        if block:
            deadline=time.monotonic()+60
            while not (HOME/'model-release').exists() and time.monotonic()<deadline:
                time.sleep(.02)
        interaction=os.environ.get('P1_04')=='1'
        requested=next((name for marker,name in (
            ('P1_APPROVAL','p1_gate'),('P1_CLARIFY','clarify'),('P1_HOLD_TOOL','p1_hold'))
            if marker in latest),None) if interaction else None
        call_tool=('P1_TOOL_WINDOW' in latest and not any(m.get('role')=='tool' for m in current_turn))
        if requested and not any(m.get('role')=='tool' for m in current_turn):
            call_tool=True
        if (compact and self.server.tool_calls<3 and
                any('p1_marker' in json.dumps(tool) for tool in request.get('tools',[])) and
                ('P1_COMPACT_FINAL_WINDOW' in json.dumps(request.get('messages',[])) or self.server.tool_calls>0)):
            self.server.tool_calls+=1
            call_tool=True
        answer='SYNTHETIC_P1_FINAL' if not call_tool else (
            f'P1_INTERIM_{self.server.tool_calls}' if compact else 'P1_TOOL_INTERIM')
        call={'index':0,'id':f'p1_crash_call_{self.server.tool_calls}' if compact else 'p1_crash_call','type':'function',
              'function':{'name':requested or 'p1_marker','arguments':json.dumps(
                  {'question':'Choose synthetic option','choices':['Alpha','Beta']} if requested=='clarify' else {})}}
        prompt_tokens=max(30,len(json.dumps(request.get('messages',[])))//4) if compact else 30
        usage={'prompt_tokens':prompt_tokens,'completion_tokens':5,'total_tokens':prompt_tokens+5}
        if request.get('stream'):
            chunks=[{'id':'s','object':'chat.completion.chunk','model':'p1-local',
                     'choices':[{'index':0,'delta':{'role':'assistant','content':answer},'finish_reason':None}]},
                    *([{'id':'s','object':'chat.completion.chunk','model':'p1-local',
                        'choices':[{'index':0,'delta':{'tool_calls':[call]},'finish_reason':None}]}] if call_tool else []),
                    {'id':'s','object':'chat.completion.chunk','model':'p1-local',
                     'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if call_tool else 'stop'}],
                     'usage':usage}]
            data=b''.join(b'data: '+json.dumps(c).encode()+b'\n\n' for c in chunks)+b'data: [DONE]\n\n'
            mime='text/event-stream'
        else:
            data=json.dumps({'id':'s','object':'chat.completion','model':'p1-local',
                             'choices':[{'index':0,'message':{'role':'assistant','content':answer,
                                        **({'tool_calls':[{k:v for k,v in call.items() if k!='index'}]}
                                           if call_tool else {})},
                                        'finish_reason':'tool_calls' if call_tool else 'stop'}],
                             'usage':usage}).encode()
            mime='application/json'
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)


async def main():
    from hermes_constants import set_hermes_home_override,reset_hermes_home_override
    from hermes_cli.plugins import get_plugin_manager
    from gateway.run import GatewayRunner
    from gateway.config import Platform

    plugin_source=Path(os.environ['P1_PACKAGED_PLUGIN_DIR']) if os.environ.get('P1_PACKAGED_PLUGIN_DIR') else ROOT/'plugins'/'hermes_app'
    shutil.copytree(plugin_source,HOME/'plugins'/'hermes-app',dirs_exist_ok=True)
    shutil.copytree(Path(__file__).with_name('crash_hook_plugin'),HOME/'plugins'/'a-p1-crash-hook',dirs_exist_ok=True)
    if os.environ.get('P1_04')=='1':
        shutil.copytree(Path(__file__).with_name('interaction_tool_plugin'),
                        HOME/'plugins'/'p1-interaction-tools',dirs_exist_ok=True)
    model=ThreadingHTTPServer(('127.0.0.1',0),Model)
    model.tool_calls=0
    worker=threading.Thread(target=model.serve_forever,daemon=True)
    worker.start()
    compression_cfg=(
        'compression:\n  enabled: true\n  in_place: true\n  threshold_tokens: 2300\n'
        '  protect_first_n: 1\n  protect_last_n: 2\n  tail_mode: legacy\n'
        if os.environ.get('P1_COMPACT_CRASH')=='1' else 'compression:\n  enabled: false\n')
    (HOME/'config.yaml').write_text(
        'model:\n  provider: custom\n  default: p1-local\n  context_length: 65536\n'
        f'  base_url: http://127.0.0.1:{model.server_port}/v1\n'
        + compression_cfg +
        'auxiliary:\n  title_generation:\n    enabled: false\n'
        'security:\n  tirith_enabled: false\n' +
        ('platform_toolsets:\n  hermes_app: [p1_crash, p1_interaction, clarify]\n'
         if os.environ.get('P1_04')=='1' else 'platform_toolsets:\n  hermes_app: [p1_crash]\n') +
        'tools:\n  tool_search:\n    enabled: "off"\n'
        'agent:\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n' +
        ('plugins:\n  enabled: [a-p1-crash-hook, hermes-app, p1-interaction-tools]\n'
         if os.environ.get('P1_04')=='1' else 'plugins:\n  enabled: [a-p1-crash-hook, hermes-app]\n') +
        ('cron:\n  wrap_response: false\n' if os.environ.get('P1_04')=='1' else '') +
        'gateway:\n  multiplex_profiles: false\n  loop_watchdog: false\n'
        '  platforms:\n    hermes_app:\n      enabled: true\n      typing_indicator: false\n')
    (HOME/'.env').write_text('OPENAI_API_KEY=synthetic-local-no-credential\n')
    token=set_hermes_home_override(HOME)
    manager=get_plugin_manager()
    runner=None
    try:
        manager.discover_and_load()
        callbacks=manager.iter_hook_callbacks('post_llm_call')
        assert callbacks and callbacks[0].__name__=='after_final', [getattr(cb,'__name__','') for cb in callbacks]
        runner=GatewayRunner()
        # This fixture tests delivery rather than first-run home-channel onboarding.
        from gateway.config import HomeChannel
        runner.config.platforms[Platform('hermes_app')].home_channel = HomeChannel(
            Platform('hermes_app'), 'synthetic-home', 'Synthetic home')
        assert await asyncio.wait_for(runner.start(),45)
        adapter=runner.adapters[Platform('hermes_app')]
        (HOME/'ready.json').write_text(json.dumps({'port':adapter.port,'hook_order_verified':True}))
        while True:
            await asyncio.sleep(.1 if os.environ.get('P1_04')=='1' else 1)
            if (HOME/'revoke-token').exists():
                os.environ['HERMES_APP_TOKEN']='rotated-synthetic-p1-token-with-32-characters'
            control=HOME/'cron-fire.json'
            if os.environ.get('P1_04')=='1' and control.exists():
                payload=json.loads(control.read_text())
                control.rename(HOME/'cron-fire.running')
                from cron.jobs import create_job,update_job
                from cron.scheduler_tick import tick
                from datetime import datetime,timedelta,timezone
                due=(datetime.now(timezone.utc)+timedelta(seconds=1)).isoformat()
                scripts=HOME/'scripts'
                scripts.mkdir(exist_ok=True)
                script=scripts/'p1-output.sh'
                script.write_text("#!/bin/sh\nprintf 'P1_CRON_RESULT\\n'\n")
                script.chmod(0o700)
                job_id_file=HOME/'cron-job-id'
                if job_id_file.exists():
                    job=update_job(job_id_file.read_text(),{'next_run_at':due})
                else:
                    job=create_job(prompt=None,schedule='1m',name='p1-local-cron',
                        script=script.name,no_agent=True,deliver='origin',
                        attach_to_session=False,workdir=str(HOME),origin={
                            'platform':'hermes_app','chat_id':payload['project_id'],
                            'thread_id':payload['thread_id'],'chat_type':'thread','user_id':'owner'})
                    job_id_file.write_text(job['id'])
                    job=update_job(job['id'],{'next_run_at':due})
                await asyncio.sleep(1.3)
                count=await asyncio.to_thread(tick,verbose=False,adapters=runner.adapters,
                                               loop=asyncio.get_running_loop(),sync=True)
                from cron.executions import latest_execution
                execution=latest_execution(job['id'])
                assert execution is not None
                for _ in range(400):
                    if adapter._store.delivery_ref(execution['id']):
                        break
                    await asyncio.sleep(.05)
                assert adapter._store.delivery_ref(execution['id'])
                # Retry the same completed scheduler execution after its first
                # adapter delivery. The plugin must return the same visible ref.
                await adapter.send(payload['project_id'],'P1_CRON_RESULT',metadata={
                    'job_id':job['id'],'thread_id':payload['thread_id']})
                (HOME/'cron-fire.done').write_text(json.dumps({'job_id':job['id'],'tick_count':count,
                    'execution':latest_execution(job['id'])}))
            gap=HOME/'cron-gap.json'
            if os.environ.get('P1_04')=='1' and gap.exists():
                payload=json.loads(gap.read_text())
                gap.rename(HOME/'cron-gap.running')
                from hermes_state import SessionDB
                with adapter._store._connect() as meta:
                    link=meta.execute('SELECT session_id FROM session_links WHERE thread_id=? '
                        'ORDER BY rowid DESC LIMIT 1',(payload['thread_id'],)).fetchone()
                assert link is not None
                core=SessionDB(HOME/'state.db')
                try:
                    row_id=core.append_message(link['session_id'],'assistant','P1_CRON_GAP',
                        platform_message_id='cron:synthetic-gap-execution',finish_reason='stop',
                        display_kind='cron_delivery')
                finally:
                    core.close()
                (HOME/'cron-gap.done').write_text(json.dumps({'row_id':row_id}))
    finally:
        if runner:
            await runner.stop()
        manager.unload()
        reset_hermes_home_override(token)
        model.shutdown();model.server_close();worker.join(5)


if __name__=='__main__':
    asyncio.run(main())
