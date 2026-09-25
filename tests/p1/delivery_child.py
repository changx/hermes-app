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
        call_tool=('P1_TOOL_WINDOW' in latest and not any(m.get('role')=='tool' for m in request.get('messages',[])))
        if (compact and self.server.tool_calls<3 and
                any('p1_marker' in json.dumps(tool) for tool in request.get('tools',[])) and
                ('P1_COMPACT_FINAL_WINDOW' in json.dumps(request.get('messages',[])) or self.server.tool_calls>0)):
            self.server.tool_calls+=1
            call_tool=True
        answer='SYNTHETIC_P1_FINAL' if not call_tool else (
            f'P1_INTERIM_{self.server.tool_calls}' if compact else 'P1_TOOL_INTERIM')
        call={'index':0,'id':f'p1_crash_call_{self.server.tool_calls}' if compact else 'p1_crash_call','type':'function',
              'function':{'name':'p1_marker','arguments':'{}'}}
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

    shutil.copytree(ROOT/'plugins'/'hermes_app',HOME/'plugins'/'hermes-app',dirs_exist_ok=True)
    shutil.copytree(Path(__file__).with_name('crash_hook_plugin'),HOME/'plugins'/'a-p1-crash-hook',dirs_exist_ok=True)
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
        'security:\n  tirith_enabled: false\n'
        'platform_toolsets:\n  hermes_app: [p1_crash]\n'
        'tools:\n  tool_search:\n    enabled: "off"\n'
        'agent:\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
        'plugins:\n  enabled: [a-p1-crash-hook, hermes-app]\n'
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
        assert await asyncio.wait_for(runner.start(),45)
        adapter=runner.adapters[Platform('hermes_app')]
        (HOME/'ready.json').write_text(json.dumps({'port':adapter.port,'hook_order_verified':True}))
        while True:
            await asyncio.sleep(1)
            if (HOME/'revoke-token').exists():
                os.environ['HERMES_APP_TOKEN']='rotated-synthetic-p1-token-with-32-characters'
    finally:
        if runner:
            await runner.stop()
        manager.unload()
        reset_hermes_home_override(token)
        model.shutdown();model.server_close();worker.join(5)


if __name__=='__main__':
    asyncio.run(main())
