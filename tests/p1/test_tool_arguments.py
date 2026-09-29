"""Whitelist-only parameter summaries from original tool calls and persisted rows."""
import asyncio
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from hermes_app import adapter, tool_timeline
from hermes_app.history_hooks import pre_tool_call
from hermes_app.storage import Store
from test_tool_timeline import call, setup
from hermes_constants import reset_hermes_home_override


def project(name, args):
    return tool_timeline.public_tool_calls({'tool_calls': [call('real-id', name, args)]})[0]


def test_urls_safe_and_compact():
    result = project('web_extract', {'urls': [
        'https://bob:very-private@example.org/a?q=hello&access_token=private&X-Amz-Signature=private#private',
        'http://site.test/?page=2', 'file:///etc/passwd', 'javascript:alert(1)',
        'https://ignored.test/'
    ], 'headers': {'Authorization': 'Bearer private'}})
    assert result == {'id': 'real-id', 'name': 'web_extract', 'label': 'Read webpage',
                      'detail': 'URL=https://example.org/a?q=hello · URL=http://site.test/?page=2 · …'}
    for name in ('browser_navigate', 'browser_open', 'functions.browser_navigate'):
        assert project(name, {'url': 'https://u:p@example.org/path?q=%E4%B8%AD%E6%96%87&%61pi_key=x#secret'})['detail'] == (
            'URL=https://example.org/path?q=%E4%B8%AD%E6%96%87')
    assert 'detail' not in project('browser_navigate', {'url': 'file:///etc/passwd'})
    assert 'detail' not in project('browser_navigate', {'url': 'https://[bad'})
    assert 'detail' not in project('browser_navigate', {'url': 'https://example.org/?q=Bearer%20private'})


def test_browser_exec_only_literal_helper_urls_no_script_body():
    code = '''# Don't show script itself\nnew_tab("https://user:pass@example.org/page?q=public&token=opaque#fragment")
url = "https://private.test/?secret=raw"
goto_url(url)
goto_url("https://site.test/next")
other.new_tab("https://not-ours.test/")'''
    result = project('browser_exec', {'code': code, 'timeout_s': 50})
    assert result['detail'] == 'URL=https://example.org/page?q=public · URL=https://site.test/next'
    assert 'private' not in result['detail'] and 'other' not in result['detail']
    assert 'detail' not in project('browser_exec', {'code': 'new_tab(open("https://x.test"))'})
    assert 'detail' not in project('browser_exec', {'code': 'new_tab("https://x.test")\n<'})
    assert 'detail' not in project('execute_code', {'code': 'new_tab("https://x.test")'})


def test_only_named_tool_fields_and_no_parallel_expansion():
    result = project('read_file', {'path': '/docs/file.md', 'offset': 11, 'limit': 30,
                                   'headers': {'Authorization': 'Bearer hidden'}, 'content': 'PRIVATE'})
    assert result['detail'] == 'path=/docs/file.md · offset=11 · limit=30'
    assert project('search_files', {'pattern': '*.py', 'target': 'files', 'path': '/repo'})['detail'] == (
        'pattern=*.py · path=/repo')
    assert project('skill_view', {'name': 'hermes-agent'})['detail'] == 'name=hermes-agent'
    assert project('patch', {'path': '/repo/a.py', 'patch': 'PRIVATE'})['detail'] == 'path=/repo/a.py'
    assert project('patch', {'mode': 'patch', 'patch': '''*** Begin Patch
*** Update File: /repo/a.py
@@
-old
+new
*** Add File: /repo/b.py
+new
*** Delete File: /repo/c.py
*** End Patch'''})['detail'] == 'path=/repo/a.py · path=/repo/b.py · path=/repo/c.py'
    assert project('functions.patch', {'mode': 'patch', 'patch': '''*** Begin Patch
*** Update File: /repo/a.py
*** Update File: /repo/a.py
*** Update File: /repo/.env
*** End Patch'''})['detail'] == 'path=/repo/a.py'
    assert project('write_file', {'path': '/repo/b.py', 'content': 'PRIVATE'})['detail'] == 'path=/repo/b.py'
    assert project('unknown.tool', {'path': '/private', 'model': 'gpt-6', 'password': 'PRIVATE'}) == {
        'id': 'real-id', 'name': 'unknown.tool', 'label': 'unknown.tool'}
    assert 'detail' not in project('browser_vault_fill', {'handle': 'vault_PRIVATE', 'path': '/secret'})
    result = project('multi_tool_use.parallel', {'tool_uses': [
        {'recipient_name': 'functions.web_extract', 'parameters': {'urls': ['https://foo.test/?q=yes&key=hidden']}},
        {'recipient_name': 'read_file', 'parameters': {'path': '/repo/README.md', 'password': 'PRIVATE'}},
        {'recipient_name': 'browser_vault_fill', 'parameters': {'handle': 'vault_PRIVATE'}}]})
    assert 'detail' not in result
    assert 'detail' not in project('execute_code', {'code': 'PRIVATE', 'path': '/secret'})
    assert [c['id'] for c in tool_timeline.public_tool_calls({'tool_calls': [
        call('first', 'read_file', {'path': '/file'}),
        call('wrapper', 'parallel', {'calls': [{'name': 'read_file', 'arguments': {'path': '/a'}}]})]})] == (
        ['first', 'wrapper'])


@pytest.mark.parametrize('bad', ['x\ud800', 'x\u202e', 'x\u200b', 'x\x00', 'x\n'])
def test_unicode_controls_and_bidi_fail_closed(bad):
    for name, args in [('read_file', {'path': bad}), ('browser_open', {'url': 'https://x.test/' + bad}),
                       ('browser_exec', {'code': f'new_tab("https://x.test/{bad}")'})]:
        assert 'detail' not in project(name, args)


def test_sanitize_before_truncate_redaction_fail_closed(monkeypatch):
    seen = []
    def redact(text):
        seen.append(text)
        if 'SECRET_AFTER_BOUNDARY' in text:
            return tool_timeline.REDACTION_UNAVAILABLE
        return text
    monkeypatch.setattr(tool_timeline, 'redact_for_egress', redact)
    long = 'a' * 500 + 'SECRET_AFTER_BOUNDARY'
    assert 'detail' not in project('read_file', {'path': long})
    assert 'detail' not in project('browser_open', {'url': 'https://x.test/' + long})
    assert 'detail' not in project('terminal', {'command': 'git status ' + long})
    assert any('SECRET_AFTER_BOUNDARY' in s for s in seen)
    monkeypatch.setattr(tool_timeline, 'redact_for_egress', lambda text: 1/0)
    assert 'detail' not in project('read_file', {'path': '/safe'})
    assert 'detail' not in project('web_extract', {'urls': ['https://safe.test/']})


def test_sensitive_shape_and_encoded_query_even_if_core_redaction_opted_out(monkeypatch):
    monkeypatch.setattr(tool_timeline, 'redact_for_egress', lambda text: text)
    secret = 'sk-' + 'p' * 30
    assert 'detail' not in project('read_file', {'path': '/tmp/' + secret})
    assert 'detail' not in project('read_file', {'path': '/repo/.env'})
    assert 'detail' not in project('read_file', {'path': '/repo/client.key'})
    assert 'detail' not in project('browser_open', {'url': 'https://site.test/?q=' + secret})
    assert 'detail' not in project('browser_open', {'url': 'https://site.test/?q=Bearer%20private'})
    assert project('browser_open', {'url': 'https://site.test/?%61ccess_token=private&q=ok'})['detail'] == (
        'URL=https://site.test/?q=ok')
    assert project('browser_open', {'url': 'https://site.test/?key=private&page=2'})['detail'] == (
        'URL=https://site.test/?page=2')
    assert 'detail' not in project('browser_open', {'url': 'https://site.test/%73k-' + 'p' * 30})
    assert 'detail' not in project('browser_open', {'url': 'https://site.test/x%0Ay'})


def test_lengths_and_malformed_arguments():
    for name, args in [('read_file', {'path': '😀' * 2000}),
                       ('terminal', {'command': 'git status ' + 'a' * 3000, 'workdir': '/repo'}),
                       ('web_extract', {'urls': ['https://site.test/' + 'a' * 1000]})]:
        result = project(name, args)
        assert len(result['label'].encode('utf-16-le')) // 2 <= 240
        assert len(result['detail'].encode('utf-16-le')) // 2 <= 600
        assert '…' in result['detail']
    c = call('x', 'browser_exec')
    c['function']['arguments'] = '{invalid'
    assert tool_timeline.public_tool_calls({'tool_calls': [c]}) == [
        {'id': 'x', 'name': 'browser_exec', 'label': 'Browse web'}]
    assert project('web_extract', {'urls': {'url': 'https://x.test'}}) == {
        'id': 'real-id', 'name': 'web_extract', 'label': 'Read webpage'}


def test_real_db_hooks_history_api_reread_urls(tmp_path, monkeypatch):
    home, core, store, tid, token = setup(tmp_path)
    try:
        monkeypatch.setenv('HERMES_APP_TOKEN', 'x' * 32)
        monkeypatch.setattr(adapter, 'get_hermes_home', lambda: home)
        user = core.append_message('s', 'user', 'browse', platform_message_id='rc-one')
        source = call('url-call', 'browser_exec', {'code': 'new_tab("https://u:pass@site.test/page?q=ok&token=hidden#hidden")'})
        row = core.append_message('s', 'assistant', '', tool_calls=[source], finish_reason='tool_calls')
        pre_tool_call(turn_id='turn-url', session_id='s', tool_call_id='url-call')
        expected = [{'id': 'url-call', 'name': 'browser_exec', 'label': 'Browse web',
                     'detail': 'URL=https://site.test/page?q=ok'}]
        page = store.history_page(tid, home/'state.db')
        assert [x['id'] for x in page['messages']] == [str(user), str(row)]
        assert page['messages'][-1]['tool_calls'] == expected
        assert Store(store.path).history_page(tid, home/'state.db')['messages'] == page['messages']
        owner = object.__new__(adapter.HermesAppAdapter)
        owner._store = store
        app = web.Application(middlewares=[adapter._authentication])
        app.router.add_get('/v1/threads/{id}/messages', owner._history)
        app.router.add_get('/v1/threads/{id}/search', owner._search)
        async def probe():
            async with TestServer(app) as server:
                async with TestClient(server) as client:
                    auth = {'Authorization': 'Bearer ' + 'x' * 32}
                    history = await client.get(f'/v1/threads/{tid}/messages', headers=auth)
                    search = await client.get(f'/v1/threads/{tid}/search?q=browser_exec', headers=auth)
                    assert history.status == search.status == 200
                    messages = (await history.json())['messages']
                    hits = (await search.json())['messages']
                    assert messages[-1]['tool_calls'] == hits[0]['tool_calls'] == expected
                    assert 'hidden' not in json.dumps(messages[-1])
        asyncio.run(probe())
    finally:
        core.close()
        reset_hermes_home_override(token)


def test_patch_mode_paths_persist_through_history_and_cold_read(tmp_path):
    home, core, store, tid, token = setup(tmp_path)
    try:
        core.append_message('s', 'user', 'edit files', platform_message_id='rc-one')
        source = call('patch-call', 'patch', {'mode': 'patch', 'patch': '''*** Begin Patch
*** Update File: /repo/a.py
@@
-old
+new
*** Add File: /repo/b.py
+new
*** End Patch'''})
        row = core.append_message('s', 'assistant', '', tool_calls=[source], finish_reason='tool_calls')
        pre_tool_call(turn_id='turn-patch', session_id='s', tool_call_id='patch-call')
        expected = [{'id': 'patch-call', 'name': 'patch', 'label': 'Edit file',
                     'detail': 'path=/repo/a.py · path=/repo/b.py'}]
        page = store.history_page(tid, home/'state.db')
        assert page['messages'][-1]['id'] == str(row)
        assert page['messages'][-1]['tool_calls'] == expected
        assert Store(store.path).history_page(tid, home/'state.db')['messages'] == page['messages']
    finally:
        core.close()
        reset_hermes_home_override(token)
