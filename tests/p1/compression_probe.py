"""Real AIAgent compression diagnostic against pinned baseline and P1 prompt callback.

This intentionally reports the unmet visible-history equality without masking it.
"""
import json
import os
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
HOME = Path(os.environ['HERMES_HOME'])
MODE = os.environ['P1_COMPACT_MODE']
assert str(BASE) in sys.path and MODE in ('inplace', 'rotate', 'idle', 'inplace_idle')
DESCRIPTION = 'P1_INIT_DESCRIPTION'
USERS = [f'P1_USER_{i:02d} ' + 'alpha beta gamma delta '*65 for i in range(16)]
USERS[7] = USERS[6]  # Distinct sends with identical bodies must keep distinct identities.
REPLIES = [f'P1_REPLY_{i:02d} ' + 'response text '*45 for i in range(16)]
SUMMARY = 'SYNTHETIC_P1_SUMMARY'


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append(request)
        if request.get('stream'):
            chunks = [
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{'role':'assistant','content':SUMMARY},'finish_reason':None}]},
                {'id':'s','object':'chat.completion.chunk','model':'p1-local','choices':[{'index':0,'delta':{},'finish_reason':'stop'}], 'usage':{'prompt_tokens':400,'completion_tokens':30,'total_tokens':430}},
            ]
            data = b''.join(b'data: '+json.dumps(c).encode()+b'\n\n' for c in chunks)+b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            data = json.dumps({'id':'s','object':'chat.completion','model':'p1-local',
                'choices':[{'index':0,'message':{'role':'assistant','content':SUMMARY},'finish_reason':'stop'}],
                'usage':{'prompt_tokens':400,'completion_tokens':30,'total_tokens':430}}).encode()
            mime = 'application/json'
        self.send_response(200); self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)


def main():
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override

    shutil.copytree(PLUGIN, HOME/'plugins'/'hermes-app')
    server = ThreadingHTTPServer(('127.0.0.1',0), Model)
    server.requests = []
    worker = threading.Thread(target=server.serve_forever,daemon=True); worker.start()
    (HOME/'config.yaml').write_text(
        'model:\n  provider: custom\n  default: p1-local\n  context_length: 65536\n'
        f'  base_url: http://127.0.0.1:{server.server_port}/v1\n'
        f'compression:\n  enabled: true\n  in_place: {str(MODE.startswith("inplace")).lower()}\n'
        '  threshold_tokens: 2400\n  protect_first_n: 1\n  protect_last_n: 2\n  tail_mode: legacy\n'
        f'  idle_compact_after_seconds: {1 if MODE.endswith("idle") else 0}\n'
        'auxiliary:\n  compression:\n    provider: main\n    model: p1-local\n  title_generation:\n    enabled: false\n'
        'security:\n  tirith_enabled: false\n'
        'tools:\n  enabled_toolsets: []\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
        'plugins:\n  enabled: [hermes-app]\n')
    (HOME/'.env').write_text('OPENAI_API_KEY=synthetic-local-no-credential\n')
    token = set_hermes_home_override(HOME)
    from hermes_cli.plugins import get_plugin_manager
    from hermes_state import SessionDB
    from run_agent import AIAgent
    from agent.conversation_loop import _restore_or_build_system_prompt
    from agent.turn_context_compaction import CompactionOutcome, _idle_compaction
    from agent.system_prompt import build_system_prompt, invalidate_system_prompt
    from tui_gateway.server import _history_to_messages
    manager = get_plugin_manager(); db = None
    try:
        manager.discover_and_load()
        from hermes_app.storage import Store
        store = Store(HOME/'hermes-app'/'metadata.sqlite')
        sid = 'P1_COMPACT_'+MODE
        store.create_thread('project','Thread',sid,DESCRIPTION)
        db = SessionDB(db_path=HOME/'state.db')
        db.create_session(sid,source='hermes_app',model='p1-local')
        def agent(session_id):
            return AIAgent(api_key='synthetic-local-no-credential',
                base_url=f'http://127.0.0.1:{server.server_port}/v1', model='p1-local',
                provider='custom', platform='hermes_app', quiet_mode=True,
                skip_context_files=True, skip_memory=True, session_id=session_id, session_db=db)
        live = agent(sid)
        for user, reply in zip(USERS,REPLIES):
            db.append_message(sid,'user',user); db.append_message(sid,'assistant',reply)
        original_ids = {m['id'] for m in db.get_messages(sid)}
        history = db.get_messages_as_conversation(sid)
        _restore_or_build_system_prompt(live,None,history)
        initial_prompt_description_count = (live._cached_system_prompt or '').count(DESCRIPTION)
        before = _history_to_messages(history)
        if not MODE.endswith('idle'):
            live._compress_context(history,None,approx_tokens=15000,task_id='p1-compact',force=True)
        else:
            live._last_activity_ts = time.time()-3600
            outcome = CompactionOutcome(messages=history,active_system_prompt=live._cached_system_prompt,
                conversation_history=history,current_turn_user_idx=len(history)-1)
            _idle_compaction(live,outcome,None,USERS[-1],'p1-idle')
        child = live.session_id
        parent_all = db.get_messages(sid,include_inactive=True)
        active_after = db.get_messages(child)
        after = _history_to_messages(db.get_messages_as_conversation(child,include_ancestors=True,include_compacted=True))
        def visible(xs):
            return [(x['role'],x.get('text')) for x in xs if x['role'] in ('user','assistant')]
        before_text, after_text = visible(before),visible(after)
        cold = agent(child)
        os.chdir(HOME.parent)
        invalidate_system_prompt(cold)
        rebuilt = build_system_prompt(cold)
        result = {'mode':MODE,'summary_model_calls':len(server.requests),
            'section_registered':'hermes_app.channel' in manager._system_prompt_sections,
            'initial_prompt_description_count':initial_prompt_description_count,
            'canonical_visible_equal':before_text==after_text,
            'before_count':len(before_text),'after_count':len(after_text),
            'child_is_root':child==sid,
            'original_row_ids_preserved': original_ids <= {m['id'] for m in parent_all},
            'active_rows_with_new_ids':sum(m['id'] not in original_ids for m in active_after),
            'repeated_user_before':sum(role=='user' and str(text).startswith('P1_USER_06 ') for role,text in before_text),
            'repeated_user_after':sum(role=='user' and str(text).startswith('P1_USER_06 ') for role,text in after_text),
            'initial_description_consumed':store.take_initial_description(sid)=='',
            'successor_description_not_injected':store.take_initial_description(child)=='',
            'changed_cwd_rebuild_description_count':rebuilt.count(DESCRIPTION),
            'first_diffs':[{'ordinal':i,'before':before_text[i][1][:30] if i<len(before_text) else None,
                'after':after_text[i][1][:30] if i<len(after_text) else None}
                for i in range(max(len(before_text),len(after_text)))
                if i>=len(before_text) or i>=len(after_text) or before_text[i]!=after_text[i]][:5]}
        (HOME.parent/f'compression-{MODE}.json').write_text(json.dumps(result,sort_keys=True))
        assert result['summary_model_calls']>0
        assert result['changed_cwd_rebuild_description_count']==0
    finally:
        if db: db.close()
        manager.unload(); reset_hermes_home_override(token)
        server.shutdown(); server.server_close(); worker.join(5)
        assert not worker.is_alive()

if __name__=='__main__': main()
