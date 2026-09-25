"""Isolated real AIAgent/SessionDB compressor; local HTTP summary model only.

Uses the formally loaded plugin fixture from plugin-e2e, without replacing core methods.
Modes: rotate (explicit legacy physical successor), idle (actual idle entrypoint).
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT.parent / 'plugin-e2e' / 'plugin'
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
assert str(BASE) in sys.path and os.environ['TIRITH_ENABLED'] == 'false'
assert os.environ['HOME'] == str(Path(os.environ['HERMES_HOME']).parent)
DESCRIPTION = 'P0 Channel A description'
USER_ROWS = [f'ORIGINAL_USER_{i:02d} ' + ('alpha beta gamma delta ' * 65) for i in range(16)]
ASSISTANT_ROWS = [f'ORIGINAL_REPLY_{i:02d} ' + ('response text ' * 45) for i in range(16)]
SUMMARY = 'Synthetic summary of earlier turns; retained markers ORIGINAL_USER_00 and ORIGINAL_REPLY_00.'

class LocalModel(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        assert self.path == '/v1/chat/completions' and 0 < length < 500000
        data = json.loads(self.rfile.read(length))
        self.server.calls.append({'path': self.path, 'model': data.get('model'), 'stream': data.get('stream'),
                                  'prompt_chars': len(json.dumps(data.get('messages', [])))})
        if data.get('stream'):
            payload = b''.join(b'data: ' + json.dumps(x).encode() + b'\n\n' for x in [
                {'id':'local','object':'chat.completion.chunk','model':'p0-local','choices':[{'index':0,'delta':{'role':'assistant','content':SUMMARY},'finish_reason':None}]},
                {'id':'local','object':'chat.completion.chunk','model':'p0-local','choices':[{'index':0,'delta':{},'finish_reason':'stop'}], 'usage':{'prompt_tokens':400,'completion_tokens':30,'total_tokens':430}}]) + b'data: [DONE]\n\n'
            mime = 'text/event-stream'
        else:
            payload = json.dumps({'id':'local','object':'chat.completion','model':'p0-local',
                'choices':[{'index':0,'message':{'role':'assistant','content':SUMMARY},'finish_reason':'stop'}],
                'usage':{'prompt_tokens':400,'completion_tokens':30,'total_tokens':430}}).encode()
            mime = 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    mode = os.environ['P0_COMPACT_MODE']
    assert mode in ('rotate', 'idle')
    outer = Path(os.environ['HERMES_HOME']).parent
    home = Path(os.environ['HERMES_HOME'])
    home.mkdir(exist_ok=True)
    shutil.copytree(FIXTURE, home / 'plugins' / 'p0-e2e-platform')
    server = ThreadingHTTPServer(('127.0.0.1', 0), LocalModel)
    server.calls = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manager = None
    db = None
    home_token = set_hermes_home_override(home)
    try:
        (home / 'config.yaml').write_text(
            'model:\n  provider: custom\n  default: p0-local\n  context_length: 65536\n'
            f'  base_url: http://127.0.0.1:{server.server_port}/v1\n'
            'compression:\n  enabled: true\n  in_place: false\n  threshold_tokens: 2400\n'
            '  protect_first_n: 1\n  protect_last_n: 2\n  tail_mode: legacy\n'
            f'  idle_compact_after_seconds: {1 if mode == "idle" else 0}\n'
            'auxiliary:\n  compression:\n    provider: main\n    model: p0-local\n  title_generation:\n    enabled: false\n'
            'security:\n  tirith_enabled: false\n'
            'tools:\n  enabled_toolsets: []\n  disabled_toolsets: [terminal, execute_code, browser, web, files, automation]\n'
            'plugins:\n  enabled: [p0-e2e-platform]\n', encoding='utf8')
        (home / '.env').write_text('OPENAI_API_KEY=synthetic-local-no-credential\n', encoding='utf8')
        sid = f'P0_COMPACT_{mode}'
        (home / 'p0-header-snapshots.json').write_text(json.dumps({sid: DESCRIPTION}))
        from agent.conversation_loop import _restore_or_build_system_prompt
        from agent.turn_context_compaction import CompactionOutcome, _idle_compaction
        from hermes_cli.plugins import get_plugin_manager
        from hermes_state import SessionDB
        from run_agent import AIAgent
        from agent.system_prompt import build_system_prompt, invalidate_system_prompt
        from agent.compaction_display import project_compaction_message_for_display
        manager = get_plugin_manager()
        manager.discover_and_load()
        db = SessionDB(db_path=home / 'state.db')
        db.create_session(sid, source='p0_e2e', model='p0-local')
        agent = AIAgent(api_key='synthetic-local-no-credential', base_url=f'http://127.0.0.1:{server.server_port}/v1',
                        model='p0-local', provider='custom', platform='p0_e2e', quiet_mode=True,
                        skip_context_files=True, skip_memory=True, session_id=sid, session_db=db)
        for user, reply in zip(USER_ROWS, ASSISTANT_ROWS):
            for role, content in [('user',user), ('assistant',reply)]:
                db.append_message(sid, role, content)
        # Load through Hermes' persisted-marker restore, not hand-crafted dicts:
        # rotating a raw in-memory copy would flush all rows again as new.
        history = db.get_messages_as_conversation(sid)
        _restore_or_build_system_prompt(agent, None, history)
        original = agent._cached_system_prompt
        db.update_system_prompt(sid, original)

        assert original.count(DESCRIPTION) == 1
        calls_before = len((home / 'p0-header-calls.jsonl').read_text().splitlines())
        assert calls_before == 1
        if mode == 'rotate':
            result, rebuilt = agent._compress_context(history, None, approx_tokens=15000, task_id='p0-rotate', force=True)
        else:
            agent._last_activity_ts = time.time() - 3600
            outcome = CompactionOutcome(messages=history, active_system_prompt=original,
                                        conversation_history=history, current_turn_user_idx=len(history)-1)
            _idle_compaction(agent, outcome, None, USER_ROWS[-1], 'p0-idle')
            result, rebuilt = outcome.messages, outcome.active_system_prompt
        child = agent.session_id
        row = db.get_session(child)
        raw_parent = db.get_messages(sid, include_compacted=True)
        original_user = [m['content'] for m in raw_parent if m['role']=='user']
        original_reply = [m['content'] for m in raw_parent if m['role']=='assistant']
        # The display read dedupes generations; the ordinary display projector
        # removes model-only handoff rows. No core function is replaced.
        display_rows = db.get_messages_as_conversation(child, include_ancestors=True, include_compacted=True)
        projected = [v for m in display_rows if (v := project_compaction_message_for_display(m)) is not None]
        visible_users = [m['content'] for m in projected if m['role']=='user']
        visible_replies = [m['content'] for m in projected if m['role']=='assistant']
        calls_after = len((home / 'p0-header-calls.jsonl').read_text().splitlines())
        result_checks = {
            'summary_http_calls': len(server.calls),
            'rotated': child != sid,
            'child_parent_matches': row['parent_session_id'] == sid,
            'parent_end_reason': db.get_session(sid)['end_reason'],
            'rebuilt_description_once': rebuilt.count(DESCRIPTION) == 1,
            'callback_reinvoked_once': calls_after == calls_before + 1,
            'parent_original_users_intact': original_user == USER_ROWS,
            'parent_original_replies_intact': original_reply == ASSISTANT_ROWS,
            'display_original_users_once': visible_users == USER_ROWS,
            'display_original_replies_once': visible_replies == ASSISTANT_ROWS,
            'display_description_absent': DESCRIPTION not in json.dumps(projected),
            'display_summary_absent': SUMMARY not in json.dumps(projected),
            'display_counts': {'user':len(visible_users),'assistant':len(visible_replies)},
            'summary_in_child': SUMMARY in json.dumps(db.get_messages(child)),
            'child_stored_header_once': row['system_prompt'].count(DESCRIPTION) == 1,
            'child_active_count': len(db.get_messages(child)),
            'result_count': len(result),
            'source_count': len(history),
        }
        # Cold new agent loads persisted child header without rendering the callback.
        cold = AIAgent(api_key='synthetic-local-no-credential', base_url=f'http://127.0.0.1:{server.server_port}/v1',
                       model='p0-local', provider='custom', platform='p0_e2e', quiet_mode=True,
                       skip_context_files=True, skip_memory=True, session_id=child, session_db=db)
        _restore_or_build_system_prompt(cold, None, db.get_messages(child))
        result_checks['fresh_agent_header_identical'] = cold._cached_system_prompt == rebuilt
        result_checks['fresh_agent_callback_not_rerun'] = len((home / 'p0-header-calls.jsonl').read_text().splitlines()) == calls_after
        result_checks['fresh_agent_description_count'] = cold._cached_system_prompt.count(DESCRIPTION)
        # Physical successor mapping absent in this probe: force the actual rebuild; never count cold restore as this.
        invalidate_system_prompt(cold)
        cold_rebuilt = build_system_prompt(cold)
        result_checks['successor_rebuild_description_once'] = cold_rebuilt.count(DESCRIPTION) == 1
        result_checks['successor_rebuild_callback_called'] = len((home / 'p0-header-calls.jsonl').read_text().splitlines()) == calls_after + 1
        result_checks['mode'] = mode
        result_checks['local_model_calls'] = server.calls
        result_checks['baseline'] = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'
        (ROOT / f'{mode}.json').write_text(json.dumps(result_checks, indent=2) + '\n')
        print(json.dumps(result_checks))
        assert len(server.calls) > 0 and all(result_checks[k] for k in (
            'rotated','child_parent_matches','rebuilt_description_once','callback_reinvoked_once',
            'parent_original_users_intact','parent_original_replies_intact','summary_in_child',
            'child_stored_header_once','display_original_users_once','display_original_replies_once',
            'display_description_absent','display_summary_absent'))
        assert result_checks['successor_rebuild_description_once'], 'physical successor lacks original snapshot mapping'
    finally:
        if db: db.close()
        if manager: manager.unload()
        reset_hermes_home_override(home_token)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()

if __name__ == '__main__':
    main()
