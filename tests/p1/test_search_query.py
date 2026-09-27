"""Search query summaries use existing labels without exposing other arguments."""
import pytest

from hermes_app import tool_timeline
from test_tool_timeline import call


def label(query, name='web_search'):
    return tool_timeline.public_tool_calls({'tool_calls': [call('search', name, {
        'query': query, 'private_other_argument': 'not-visible', 'limit': 5
    })]})[0]


@pytest.mark.parametrize('name', ['web_search', 'functions.web_search'])
def test_query_visible_with_chinese_and_search_operators(name):
    result = label('  site:example.org "API 价格"\n 文档\t2026 ', name)
    assert result == {'id': 'search', 'name': name,
                      'label': 'Search web: site:example.org "API 价格" 文档 2026'}


@pytest.mark.parametrize('query', [None, 0, [], {}, '', ' \n ', 'bad\x00query',
                                   '\ud800', 'bad\u202equery', 'x' * 4001])
def test_malformed_or_unsafe_query_falls_back(query):
    assert label(query)['label'] == 'Search web'


def test_long_queries_truncate_in_utf16_and_show_ellipsis():
    result = label('中文😀' * 500)['label']
    assert result.startswith('Search web: 中文😀') and result.endswith('…')
    assert len(result.encode('utf-16-le')) // 2 <= 240


@pytest.mark.parametrize('query', ['lookup sk-' + 'a' * 40,
                                   'https://example.org/?access_token=shortsecret',
                                   'password=shortsecret'])
def test_credentials_do_not_appear_even_with_redaction_opt_out(query, monkeypatch):
    monkeypatch.setenv('HERMES_REDACT_SECRETS', 'false')
    assert label(query)['label'] == 'Search web'


def test_checks_full_query_before_truncation_and_fails_closed(monkeypatch):
    seen = []
    def redact(query):
        seen.append(query)
        return tool_timeline.REDACTION_UNAVAILABLE
    monkeypatch.setattr(tool_timeline, 'redact_for_egress', redact)
    query = 'q' * 500
    assert label(query)['label'] == 'Search web'
    assert seen == [query]


def test_malformed_json_and_unknown_tools_remain_safe():
    c = call('bad', 'web_search')
    c['function']['arguments'] = '{invalid'
    assert tool_timeline.public_tool_calls({'tool_calls': [c]})[0]['label'] == 'Search web'
    assert label('do not expose', 'custom_search')['label'] == 'custom_search'
