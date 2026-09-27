"""An accepted user's display ref belongs to its first actual turn."""
import sqlite3

from hermes_constants import set_hermes_home_override, reset_hermes_home_override
from hermes_state import SessionDB
from hermes_app import history_hooks as hooks
from hermes_app.storage import Store


def test_continuation_hooks_do_not_steal_completed_owner(tmp_path):
    core = SessionDB(tmp_path / 'state.db')
    core.create_session('s', 'hermes_app')
    store = Store(tmp_path / 'hermes-app' / 'metadata.sqlite')
    tid = store.create_thread('p', 'topic', 's', '')
    token = set_hermes_home_override(tmp_path)
    try:
        owner, _ = store.accept(tid, 'owner', 'first')
        initial = store.history_page(tid, tmp_path / 'state.db')['messages'][0]
        store.claim_next(tid)
        user = core.append_message('s', 'user', 'first', platform_message_id=owner['id'])
        history = [{'role': 'user', 'content': 'first', '_row_id': user}]

        def tool(turn, ident):
            calls = [{'id': ident, 'type': 'function', 'function':
                      {'name': 'web_search', 'arguments': '{"query":"example"}'}}]
            row = core.append_message('s', 'assistant', '', tool_calls=calls, finish_reason='tool_calls')
            history.append({'role': 'assistant', 'content': '', 'tool_calls': calls, '_row_id': row})
            hooks.pre_tool_call(session_id='s', turn_id=turn, tool_call_id=ident)
            hooks.post_tool_call(session_id='s', turn_id=turn, tool_call_id=ident)
            return row

        def final(turn, text):
            row = core.append_message('s', 'assistant', text, finish_reason='stop')
            history.append({'role': 'assistant', 'content': text, '_row_id': row})
            hooks.post_llm_call(platform='hermes_app', session_id='s', turn_id=turn,
                                conversation_history=history)
            return row

        first_tool = tool('first-turn', 'one')
        follow, _ = store.accept(tid, 'follow', 'second')
        store.claim_busy_text(tid)
        store.mark_handed_off(follow['id'])
        row = core.append_message('s', 'user', 'second', display_kind='steer')
        history.append({'role': 'user', 'content': 'second', 'display_kind': 'steer', '_row_id': row})
        first_final = final('first-turn', 'first answer')
        first_refs = [('s', user, 'user'), ('s', first_tool, 'assistant'), ('s', first_final, 'assistant')]
        assert store.turn_refs('first-turn') == first_refs
        assert store.turn_state('first-turn') == 'complete'
        # Same-turn repeated association must also be an exact no-op.
        with store._connect() as db:
            store._insert_core_ref(db, tid, 'first-turn', 's', user, 'user')
        assert store.turn_refs('first-turn') == first_refs

        late, _ = store.accept(tid, 'late', 'third')
        store.claim_busy_text(tid)
        store.mark_handed_off(late['id'])
        # Native leftover steer starts a new turn without a platform ID.
        row = core.append_message('s', 'user', 'third')
        history.append({'role': 'user', 'content': 'third', '_row_id': row})
        second_tool = tool('second-turn', 'two')
        assert store.turn_refs('first-turn') == first_refs
        assert store.turn_refs('second-turn') == [('s', second_tool, 'assistant')]
        second_final = final('second-turn', 'second answer')
        store.settle_ingress(tid, 'ingress:' + owner['id'], owner['id'], tmp_path / 'state.db', owner_finished=True)
        assert store.turn_state('ingress:' + owner['id']) == 'complete'
        assert store.turn_state('first-turn') == store.turn_state('second-turn') == 'complete'
        assert store.turn_refs('first-turn') == first_refs
        assert store.turn_refs('second-turn') == [('s', second_tool, 'assistant'), ('s', second_final, 'assistant')]
        page = store.history_page(tid, tmp_path / 'state.db')
        assert page['messages'][0] == initial
        assert [m['text'] for m in page['messages'] if m['role'] == 'user'] == ['first', 'second', 'third']
        assert [m['text'] for m in page['messages'] if m['role'] == 'assistant' and m['text']] == ['first answer', 'second answer']
        assert Store(store.path).history_page(tid, tmp_path / 'state.db')['messages'] == page['messages']
        with sqlite3.connect(tmp_path / 'state.db') as db:
            assert db.execute("SELECT content FROM messages WHERE role='user' ORDER BY id").fetchall() == [('first',), ('second',), ('third',)]
    finally:
        reset_hermes_home_override(token)
        core.close()
