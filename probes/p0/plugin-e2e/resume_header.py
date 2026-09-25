"""Cold-process prompt restore and controlled rebuild, NOT a summarizer test."""
import json
import os
from pathlib import Path
import sys

from agent.conversation_loop import _restore_or_build_system_prompt
from agent.system_prompt import build_system_prompt, invalidate_system_prompt
from hermes_cli.plugins import get_plugin_manager
from hermes_state import SessionDB
from run_agent import AIAgent
import yaml


def main():
    home = Path(os.environ['HERMES_HOME'])
    assert os.environ['P0_E2E_MODE'] == 'header'
    config = yaml.safe_load((home / 'config.yaml').read_text())
    manager = get_plugin_manager()
    manager.discover_and_load()
    db = SessionDB(db_path=home / 'state.db')
    try:
        sid = sys.argv[1]
        before = (home / 'p0-header-calls.jsonl').read_text().splitlines()
        stored = db.get_session(sid)['system_prompt']
        assert stored.count('P0 Channel A description') == 1
        assert 'P0 Channel B description' not in stored
        history = db.get_messages(sid)
        agent = AIAgent(api_key='synthetic-local-no-credential',
                        base_url=config['model']['base_url'], model='p0-local', provider='custom',
                        platform='p0_e2e', quiet_mode=True, skip_context_files=True,
                        skip_memory=True, session_id=sid, session_db=db)
        _restore_or_build_system_prompt(agent, None, history)
        assert agent._cached_system_prompt == stored, 'cold restore changed full prompt'
        assert (home / 'p0-header-calls.jsonl').read_text().splitlines() == before
        # Exercise the real invalidation/rebuild functions, not actual compaction.
        # Snapshot metadata returns the original description, not the current Channel value.
        invalidate_system_prompt(agent)
        rebuilt = build_system_prompt(agent)
        assert rebuilt.count('P0 Channel A description') == 1
        assert 'P0 Channel B description' not in rebuilt
        after = (home / 'p0-header-calls.jsonl').read_text().splitlines()
        assert len(after) == len(before) + 1
        assert all('P0 Channel A description' not in str(m.get('content')) for m in history)
        print(json.dumps({'cold_restore_full_prompt_identical': True,
                          'cold_restore_callback_added': 0,
                          'controlled_rebuild_callback_added': 1,
                          'rebuild_original_description_once': True,
                          'description_absent_from_message_rows': True,
                          'actual_summarizer_compaction_tested': False}))
    finally:
        db.close()
        manager.unload()


if __name__ == '__main__':
    main()
