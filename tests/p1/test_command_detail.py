"""Command previews preserve ordinary scripts without weakening secret guards."""
import json

import pytest

from hermes_app import tool_timeline
from hermes_app.history_hooks import pre_tool_call
from hermes_app.storage import Store
from hermes_constants import reset_hermes_home_override
from test_tool_arguments import project
from test_tool_timeline import call, setup


@pytest.mark.parametrize('command', [
    'python3 -c "import pathlib; p=pathlib.Path(\'/repo/README.md\'); print(p.exists())"',
    'python3 -c "p=42; print(p)"',
    'python3 -c "import urllib.request as u; req=u.Request(\'https://example.org/docs\'); print(req.full_url)"',
    'git status --short\ngit log -3 --oneline',
    'python3 -c "import pathlib\np=pathlib.Path(\'/repo\')\nprint(p.exists())"',
    'printf\t\'done\'\n',
    'pytest -p no:warnings',
    'env | sort',
    'printf "$HOME"',
    'python3 -c "unterminated',
    'python -m pytest ' + 'x' * 4001,
])
def test_safe_scripts_and_multiline_show_exact_command(command):
    for name in ('terminal', 'functions.terminal'):
        detail = project(name, {'command': command})['detail']
        if tool_timeline._utf16_length(command) <= 600:
            assert detail == command
        else:
            assert detail.endswith('…')


@pytest.mark.parametrize('command', [
    'git status\u202e', 'git status\ud800', 'git status\x1b[31m',
])
def test_sensitive_or_ambiguous_commands_stay_hidden(command):
    assert 'detail' not in project('terminal', {'command': command})


@pytest.mark.parametrize(('command', 'visible', 'hidden'), [
    ('VALUE=opaque python3 script.py', 'VALUE=opaque python3 script.py', None),
    ('git status; VALUE=opaque python3 script.py', 'git status; VALUE=opaque python3 script.py', None),
    ('git status\nVALUE=opaque python3 script.py', 'git status\nVALUE=opaque python3 script.py', None),
    ('python3 -c "password=\'private\'; print(password)"', 'password=***', 'private'),
    ('python3 -c "password=\'two words\'; print(password)"', 'password=***', 'two words'),
    ('curl -H "Authorization: Bearer opaque-secret-value" https://example.org', '-H ***', 'opaque-secret-value'),
    ('env curl -HAuthorization:opaque-secret-value https://example.org', '-H***', 'opaque-secret-value'),
    ('curl -ubob:opaque-secret-value https://example.org', '-u***', 'opaque-secret-value'),
    ('curl --api-key=opaque-secret-value https://example.org', '--api-key=***', 'opaque-secret-value'),
    ('pytest -p no:warnings', 'pytest -p no:warnings', None),
    ('ssh -p 2222 example.org', 'ssh -p 2222 example.org', None),
    ('mysql -popaque-secret-value database', 'mysql -p*** database', 'opaque-secret-value'),
    ('mysql -p opaque-secret-value database', 'mysql -p *** database', 'opaque-secret-value'),
    ('API_TOKEN=opaque-secret-value python script.py\n' + 'x' * 650, 'API_TOKEN=***', 'opaque-secret-value'),
    ('curl https://user:private@example.org/path', 'https://example.org/path', 'private'),
    ('curl https://example.org/?token=opaque-secret-value&page=2', 'https://example.org/', 'opaque-secret-value'),
    ('curl https://example.org/#private', 'https://example.org/', '#private'),
    ('curl ftp://example.org/file', '[redacted-url]', 'ftp://'),
])
def test_sensitive_command_values_are_masked_without_hiding_the_command(command, visible, hidden):
    detail = project('terminal', {'command': command})['detail']
    assert visible in detail
    if hidden:
        assert hidden not in detail


def test_multiline_is_checked_before_truncation_and_redactor_failure(monkeypatch):
    safe = 'git status\n' + 'a' * 1000
    assert project('terminal', {'command': safe})['detail'].endswith('…')
    assert tool_timeline._utf16_length(project('terminal', {'command': safe})['detail']) <= 600
    seen = []
    def redact(value):
        seen.append(value)
        return tool_timeline.REDACTION_UNAVAILABLE
    monkeypatch.setattr(tool_timeline, 'redact_for_egress', redact)
    assert 'detail' not in project('terminal', {'command': safe})
    assert safe in seen


def test_real_history_preserves_script_details_and_identity(tmp_path):
    home, core, store, tid, token = setup(tmp_path)
    command = 'python3 -c "import pathlib; p=pathlib.Path(\'/repo\'); print(p.exists())"\ngit status'
    try:
        core.append_message('s', 'user', 'check repo', platform_message_id='rc-one')
        row = core.append_message('s', 'assistant', '检查文件。', tool_calls=[call('script', 'terminal', {'command': command})])
        pre_tool_call(turn_id='script-turn', session_id='s', tool_call_id='script')
        first = store.history_page(tid, home/'state.db')
        assert first['messages'][-1]['id'] == str(row)
        assert first['messages'][-1]['tool_calls'][0]['detail'] == command
        assert Store(store.path).history_page(tid, home/'state.db') == first
        hit = store.search_page(tid, home/'state.db', 'Run command')['messages'][0]
        assert hit['tool_calls'] == first['messages'][-1]['tool_calls']
        pre_tool_call(turn_id='script-turn', session_id='s', tool_call_id='script')
        assert store.history_page(tid, home/'state.db') == first
    finally:
        core.close()
        reset_hermes_home_override(token)
