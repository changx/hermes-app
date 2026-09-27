"""Only explicit public Codex commentary, never private reasoning, enters the timeline."""
import json

from hermes_constants import reset_hermes_home_override
from hermes_app.history_hooks import pre_tool_call, post_tool_call, post_llm_call
from hermes_app.projection import visible_text
from hermes_app.storage import Store
from test_tool_timeline import setup, call


def item(text, **kwargs):
    return {'type': 'message', 'role': 'assistant', 'phase': 'commentary',
            'status': 'completed', 'content': [{'type': 'output_text', 'text': text}], **kwargs}


def test_explicit_public_commentary_and_body_without_duplicate():
    m = {'role': 'assistant', 'content': '', 'codex_message_items': [item('先查官方资料。')],
         'reasoning': 'PRIVATE', 'reasoning_content': 'PRIVATE', 'codex_reasoning_items': [{'text': 'PRIVATE'}]}
    assert visible_text(m) == '先查官方资料。'
    assert visible_text({**m, 'codex_message_items': json.dumps(m['codex_message_items'])}) == '先查官方资料。'
    assert visible_text({**m, 'content': '结论。'}) == '先查官方资料。\n\n结论。'
    assert visible_text({**m, 'content': '先查官方资料。'}) == '先查官方资料。'
    assert visible_text({**m, 'codex_message_items': [item('结论。', phase='final_answer')], 'content': '结论。'}) == '结论。'


def test_commentary_does_not_bypass_visibility_or_expose_other_fields():
    m = {'role': 'assistant', 'content': '', 'codex_message_items': [item('public')]}
    for extra in ({'display_kind': 'hidden'}, {'display_kind': 'auto_continue'}, {'_compressed_summary': True}):
        assert visible_text({**m, **extra}) is None
    for invalid in ([item('PRIVATE', phase='analysis')], [item('PRIVATE', phase=None)],
                    [item('PRIVATE', role='user')], [item('PRIVATE', type='reasoning')],
                    [item('PRIVATE', status='in_progress')], [None, 'PRIVATE'],
                    [item('ignored', content=[{'type': 'reasoning_text', 'text': 'PRIVATE'}])],
                    [item('ignored', content='PRIVATE')], '{', {}, None):
        assert visible_text({**m, 'codex_message_items': invalid}) is None
        assert visible_text({**m, 'content': '正文', 'codex_message_items': invalid}) == '正文'
    assert visible_text({**m, 'role': 'user', 'content': '我的原文'}) == '我的原文'
    assert visible_text({**m, 'role': 'tool'}) is None


def test_real_rows_commentary_before_and_between_calls_reconnect_search(tmp_path):
    home, core, store, tid, token = setup(tmp_path)
    try:
        user = core.append_message('s', 'user', '查官方资料', platform_message_id='rc-one')
        rows = []
        history = [{'role': 'user', 'content': '查官方资料', '_row_id': user}]
        for ident, name, text in [('c1', 'web_search', '先查官方资料。'), ('c2', 'web_extract', '找到文档，接着核实授权条件。')]:
            calls = [call(ident, name)]
            items = [item(text)]
            row = core.append_message('s', 'assistant', '', tool_calls=calls, codex_message_items=items, reasoning='PRIVATE')
            rows.append(row)
            history.append({'role': 'assistant', 'content': '', '_row_id': row, 'tool_calls': calls, 'codex_message_items': items})
            pre_tool_call(turn_id='t', session_id='s', tool_call_id=ident, platform='hermes_app')
            page = store.history_page(tid, home/'state.db')['messages']
            assert page[-1]['text'] == text
            assert page[-1]['tool_calls'][0]['id'] == ident
            post_tool_call(turn_id='t', session_id='s', tool_call_id=ident, platform='hermes_app')
            assert store.history_page(tid, home/'state.db')['messages'] == page
        final = core.append_message('s', 'assistant', '需要授权。', codex_message_items=[item('需要授权。', phase='final_answer')])
        history.append({'role': 'assistant', 'content': '需要授权。', '_row_id': final})
        post_llm_call(platform='hermes_app', session_id='s', turn_id='t', conversation_history=history)
        page = store.history_page(tid, home/'state.db')['messages']
        assert [m['id'] for m in page] == list(map(str, [user, *rows, final]))
        assert [m['text'] for m in page] == ['查官方资料', '先查官方资料。', '找到文档，接着核实授权条件。', '需要授权。']
        assert Store(store.path).history_page(tid, home/'state.db')['messages'] == page
        assert store.search_page(tid, home/'state.db', '授权条件')['messages'][0]['text'] == page[2]['text']
        assert 'PRIVATE' not in json.dumps(page)
    finally:
        core.close()
        reset_hermes_home_override(token)
