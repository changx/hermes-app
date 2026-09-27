"""Public, bounded projection of original assistant tool calls; no results or raw args."""
import json
import re

from agent.redact import REDACTION_UNAVAILABLE, redact_for_egress

_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_.]{0,199}\Z')
_UNSAFE_COMMAND = re.compile(
    r'(?i)(?:https?://|wss?://|ftp://|\$|\b(?:password|passwd|secret|token|credential|authorization|api[_-]?key|auth[_-]?key)\b'
    r'|--[\w-]*(?:password|passwd|secret|token|credential|auth|key)[\w-]*'
    r'|(?:^|\s)[A-Za-z_][A-Za-z_0-9]*=\S|\s(?:-H|-u|-p|--header|--data|--data-raw|--user|--password|--cookie)(?:\s|=)'
    r'|(?:^|\s)(?:export|env|set|printenv)\b|\b\.env\b)')
_LABELS = {
    'read_file': '阅读文件', 'search_files': '搜索文件', 'web_search': '搜索网页',
    'web_extract': '阅读网页', 'browser_exec': '浏览网页', 'terminal': '运行命令',
    'execute_code': '运行代码', 'patch': '修改文件', 'write_file': '写入文件',
    'parallel': '并行执行工具', 'multi_tool_use.parallel': '并行执行工具',
}
_TERMINAL = frozenset({'terminal', 'functions.terminal'})


def _calls(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []
    return value if isinstance(value, list) else []


def _utf16_length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def _command_detail(arguments):
    """Only simple, non-sensitive shell lines; fail closed on ambiguous command shapes."""
    if not isinstance(arguments, dict):
        return None
    command = arguments.get('command')
    if not isinstance(command, str) or not command.strip() or _utf16_length(command) > 4000:
        return None
    if any(ord(char) < 32 and char not in '\n\t' for char in command):
        return None
    if _UNSAFE_COMMAND.search(command):
        return None
    clean = redact_for_egress(command)
    if clean == REDACTION_UNAVAILABLE or 'redacted' in clean.lower() or clean != command:
        return None  # A redaction implies command structure may still reveal sensitive context.
    return clean


def _search_label(arguments):
    """Expose only the query, checked before truncation; never raw arguments."""
    if not isinstance(arguments, dict):
        return None
    query = arguments.get('query')
    if not isinstance(query, str) or not query.strip() or _utf16_length(query) > 4000:
        return None
    if any((ord(c) < 32 and c not in '\n\r\t') or
           0xD800 <= ord(c) <= 0xDFFF or 0x202A <= ord(c) <= 0x202E or
           0x2066 <= ord(c) <= 0x2069 for c in query):
        return None
    # Core redaction intentionally preserves web URL query/userinfo for OAuth.
    # Search labels must not echo credentials from those ambiguous URL parts.
    if re.search(r'://\S*[?@#]', query):
        return None
    clean = redact_for_egress(query)
    if clean == REDACTION_UNAVAILABLE or clean != query:
        return None
    label = '搜索网页：' + ' '.join(clean.split())
    if _utf16_length(label) > 240:
        label = label.encode('utf-16-le')[:478].decode('utf-16-le', errors='ignore') + '…'
    return label


def public_tool_calls(message):
    """Keep IDs/order of valid calls. Last slot honestly accounts for overflow."""
    result = []
    calls = _calls(message.get('tool_calls'))
    valid_count = 0
    for call in calls:
        if not isinstance(call, dict):
            continue
        ident, function = call.get('id'), call.get('function')
        name = function.get('name') if isinstance(function, dict) else None
        if not (isinstance(ident, str) and 0 < _utf16_length(ident) <= 200 and
                isinstance(name, str) and _NAME.fullmatch(name)):
            continue
        valid_count += 1
        if valid_count > 128:
            continue
        label = _LABELS.get(name, _LABELS.get(name.removeprefix('functions.'), name))
        record = {'id': ident, 'name': name, 'label': label[:240]}
        if name in _TERMINAL or name in {'web_search', 'functions.web_search'}:
            raw = function.get('arguments')
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                args = None
            if name in _TERMINAL:
                detail = _command_detail(args)
                if detail:
                    record['detail'] = detail
            else:
                record['label'] = _search_label(args) or label
        result.append(record)
    # Count valid omitted calls, rather than silently truncating a model batch.
    if valid_count > 128:
        result[-1] = {'id': result[-1]['id'], 'name': result[-1]['name'],
                      'label': f'此项及另外 {valid_count - 128} 项工具调用未逐项展示'}
    return result
