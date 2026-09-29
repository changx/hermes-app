"""Public, bounded projection of original assistant tool calls; no results or raw args."""
import ast
import json
import re
import unicodedata
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

from agent.redact import REDACTION_UNAVAILABLE, redact_for_egress

_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_.]{0,199}\Z')
_COMMAND_URL = re.compile(r'(?i)(?:https?|wss?|ftp)://[^\s\'"<>]+')
_SENSITIVE_COMMAND_OPTION = re.compile(
    r'(?i)(?P<prefix>(?:^|\s)(?:'
    r'--(?:[A-Za-z0-9]+[-_])*(?:password|passwd|secret|token|credential|auth|api[_-]?key|cookie)'
    r'(?:[-_][A-Za-z0-9]+)*|--header|--data|--data-raw|--user))'
    r'(?:(?P<equals>=)(?P<equal_value>[^\s]+)|(?P<space>\s+)'
    r'(?P<space_value>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[^\s]+))')
_CURL_SENSITIVE_OPTION = re.compile(
    r'(?i)(?P<prefix>(?:^|\s)(?:-H|-u))'
    r'(?:(?P<equals>=)(?P<equal_value>[^\s]+)|(?P<space>\s+)'
    r'(?P<space_value>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[^\s]+)'
    r'|(?P<attached>[^\s]+))')
_MYSQL_PASSWORD_OPTION = re.compile(
    r'(?i)(?P<prefix>(?:^|\s)-p)'
    r'(?:(?P<equals>=)(?P<equal_value>[^\s]+)|(?P<space>\s+)'
    r'(?P<space_value>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[^\s]+)'
    r'|(?P<attached>[^\s]+))')
_COMMAND_ASSIGNMENT = re.compile(
    r'(?i)(?P<prefix>\b(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*)'
    r'(?P<value>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[^\s;]+)')
_SENSITIVE_ASSIGNMENT_KEY = re.compile(
    r'(?i)(?:password|passwd|secret|token|credential|api[_-]?key|auth[_-]?key)')
_PATCH_FILE = re.compile(r'^\*\*\* (?:Add|Update|Delete) File: (.+)$', re.MULTILINE)
_LABELS = {
    'read_file': 'Read file', 'search_files': 'Search files', 'web_search': 'Search web',
    'web_extract': 'Read webpage', 'browser_exec': 'Browse web', 'terminal': 'Run command',
    'execute_code': 'Run code', 'patch': 'Edit file', 'write_file': 'Write file',
    'parallel': 'Run tools in parallel', 'multi_tool_use.parallel': 'Run tools in parallel',
}
_TERMINAL = frozenset({'terminal', 'functions.terminal'})
_SENSITIVE_KEY = re.compile(
    r'(?i)(?:pass(?:word|wd|phrase)?|secret|token|credential|auth|api[_-]?key|'
    r'private[_-]?key|cookie|session[_-]?id|signature|signed|sig|jwt|code|state|'
    r'x[_-]amz|x[_-]goog|access[_-]?key|client[_-]?id|^key$)')
_SENSITIVE_TEXT = re.compile(
    r'(?i)(?:\b(?:bearer|basic)\s+\S+|\b(?:password|passwd|token|secret|'
    r'authorization|api[_-]?key|cookie|credential|signature)\s*[:=]\s*\S+)')
_SECRET_SHAPE = re.compile(r'(?i)(?:sk-[A-Za-z0-9_-]{10,}|(?:ghp|github_pat|xoxb|sk_live)_[A-Za-z0-9_-]{10,})')
_SECRET_FILE = re.compile(r'(?i)(?:^|[/\\])(?:\.env(?:\.[^/\\]+)?|credentials\.json|[^/\\]+\.(?:pem|key|p12|pfx))(?:$|[/\\])')
_CREDENTIAL_TOOL = re.compile(r'(?i)(?:vault|login|payment|credential|password|secret|auth|cookie|token)')


def _calls(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []
    return value if isinstance(value, list) else []


def _utf16_length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def _valid_text(value, *, multiline=False):
    if not isinstance(value, str) or not value.strip() or _utf16_length(value) > 16000:
        return False
    return not any(unicodedata.category(c) in {'Cc', 'Cf', 'Cs'} and
                   not (multiline and c in '\n\t') for c in value)


def _safe_text(value, *, multiline=False):
    """Check the ENTIRE original scalar before display or truncation; fail closed."""
    if not _valid_text(value, multiline=multiline):
        return None
    if _SENSITIVE_TEXT.search(value) or _SECRET_SHAPE.search(value) or _SECRET_FILE.search(value):
        return None
    try:
        clean = redact_for_egress(value)
    except Exception:
        return None
    return value.strip() if isinstance(clean, str) and clean == value and clean != REDACTION_UNAVAILABLE else None


def _short(text, cap=160):
    if _utf16_length(text) <= cap:
        return text
    return text.encode('utf-16-le')[:(cap - 1) * 2].decode('utf-16-le', errors='ignore') + '…'


def _command_detail(arguments):
    """Show the command structure while masking sensitive values."""
    if not isinstance(arguments, dict):
        return None
    command = arguments.get('command')
    if not isinstance(command, str) or not command.strip() or _utf16_length(command) > 16000:
        return None
    if any(ord(char) < 32 and char not in '\n\t' for char in command):
        return None
    try:
        clean = redact_for_egress(command)
    except Exception:
        return None
    if not isinstance(clean, str) or clean == REDACTION_UNAVAILABLE:
        return None
    clean = _SENSITIVE_COMMAND_OPTION.sub(
        lambda match: match.group('prefix') + ('=' if match.group('equals') else ' ') + '***', clean)
    if re.search(r'(?i)\bcurl\b', clean):
        clean = _CURL_SENSITIVE_OPTION.sub(
            lambda match: match.group('prefix') + ('=' if match.group('equals') else
                                                   ' ' if match.group('space') else '') + '***', clean)
    if re.search(r'(?i)\b(?:mysql|mariadb)\b', clean):
        clean = _MYSQL_PASSWORD_OPTION.sub(
            lambda match: match.group('prefix') + ('=' if match.group('equals') else
                                                   ' ' if match.group('space') else '') + '***', clean)
    clean = _COMMAND_ASSIGNMENT.sub(
        lambda match: match.group('prefix') + '***'
        if _SENSITIVE_ASSIGNMENT_KEY.search(match.group('key')) else match.group(0), clean)
    clean = _COMMAND_URL.sub(lambda match: _safe_command_url(match.group(0)) or '[redacted-url]', clean)
    # Redact again after normalization and require a stable egress-safe result.
    try:
        second = redact_for_egress(clean)
    except Exception:
        return None
    if not isinstance(second, str) or second == REDACTION_UNAVAILABLE or not _valid_text(second, multiline=True):
        return None
    clean = second
    return _short(clean, 600)


def _search_label(arguments):
    """Keep the established web_search label semantics and UTF-16 budget."""
    if not isinstance(arguments, dict):
        return None
    query = arguments.get('query')
    if not isinstance(query, str) or not query.strip() or _utf16_length(query) > 4000:
        return None
    if any((unicodedata.category(c) == 'Cc' and c not in '\n\r\t') or
           unicodedata.category(c) in {'Cf', 'Cs'} for c in query):
        return None
    if re.search(r'://\S*[?@#]', query) or _SENSITIVE_TEXT.search(query) or _SECRET_SHAPE.search(query):
        return None
    try:
        clean = redact_for_egress(query)
    except Exception:
        return None
    if not isinstance(clean, str) or clean == REDACTION_UNAVAILABLE or clean != query:
        return None
    label = 'Search web: ' + ' '.join(clean.split())
    return _short(label, 240)


def _safe_url(value):
    """HTTP URL only; remove userinfo, fragments and credential-like query pairs."""
    if not _valid_text(value) or any(c.isspace() for c in value):
        return None
    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in {'http', 'https'} or not parts.hostname or parts.port == 0:
            return None
        host = parts.hostname
        if any(c.isspace() for c in host):
            return None
        if parts.path and _safe_text(unquote(parts.path)) is None:
            return None
        netloc = f'[{host}]' if ':' in host else host
        if parts.port is not None:
            netloc += f':{parts.port}'
        # parse_qsl decodes percent-encoded key names, including signed URL aliases.
        safe_pairs = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            if not _valid_text(key):
                return None
            if _SENSITIVE_KEY.search(key):
                continue
            # URL encoding can conceal credential text until parse_qsl decodes it.
            if item and (_safe_text(item) is None or
                         ('://' in item and any(mark in item for mark in '@?#'))):
                return None
            safe_pairs.append((key, item))
        query = urlencode(safe_pairs)
        clean = urlunsplit((parts.scheme.lower(), netloc, parts.path, query, ''))
        return clean if _safe_text(clean) is not None else None
    except (ValueError, UnicodeError):
        return None


def _safe_command_url(value):
    """Keep a command URL's public location, never arbitrary query values."""
    clean = _safe_url(value)
    if clean is None:
        return None
    parts = urlsplit(clean)
    query = '&'.join(
        f'{quote(key, safe="")}=***' if item else f'{quote(key, safe="")}='
        for key, item in parse_qsl(parts.query, keep_blank_values=True)
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ''))


def _field(arguments, key):
    if not isinstance(arguments, dict):
        return None
    text = _safe_text(arguments.get(key))
    return f'{key}={_short(text, 160)}' if text else None


def _urls(arguments, field):
    if not isinstance(arguments, dict):
        return []
    values = arguments.get(field)
    if field == 'url':
        values = [values]
    if not isinstance(values, list):
        return []
    result = []
    for raw in values[:3]:
        url = _safe_url(raw)
        if url:
            result.append(f'URL={_short(url, 180)}')
    if result and len(values) > 3:
        result.append('…')
    return result


def _browser_urls(arguments):
    if not isinstance(arguments, dict) or not isinstance(arguments.get('code'), str):
        return []
    code = arguments['code']
    if len(code) > 16000:
        return []
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, UnicodeError):
        return []
    result = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and
                node.func.id in {'new_tab', 'goto_url'}):
            arg = node.args[0] if node.args else next((k.value for k in node.keywords if k.arg == 'url'), None)
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                url = _safe_url(arg.value)
                if url:
                    result.append(f'URL={_short(url, 180)}')
            if len(result) >= 3:
                break
    return result


def _summary(name, args):
    """Only product-approved tools and exact argument fields, never raw objects."""
    bare = name.removeprefix('functions.')
    if _CREDENTIAL_TOOL.search(bare) or not isinstance(args, dict):
        return []
    if bare == 'browser_exec':
        return _browser_urls(args)
    if bare == 'web_extract':
        return _urls(args, 'urls')
    if bare in {'browser_navigate', 'browser_open', 'browser_open_url'}:
        return _urls(args, 'url')
    if bare == 'read_file':
        fields = [_field(args, 'path')]
        for key in ('offset', 'limit'):
            value = args.get(key)
            if type(value) is int and 0 <= value <= 1000000:
                fields.append(f'{key}={value}')
        return [field for field in fields if field]
    if bare == 'search_files':
        return [field for key in ('pattern', 'path') if (field := _field(args, key))]
    if bare == 'write_file':
        return [field for field in [_field(args, 'path')] if field]
    if bare == 'patch':
        direct = _field(args, 'path')
        if direct:
            return [direct]
        patch = args.get('patch')
        if args.get('mode') != 'patch' or not isinstance(patch, str) or len(patch) > 4_000_000:
            return []
        paths = []
        for raw in _PATCH_FILE.findall(patch):
            path = _safe_text(raw)
            if path and path not in paths:
                paths.append(path)
        fields = [f'path={_short(path, 160)}' for path in paths[:5]]
        if len(paths) > 5:
            fields.append('…')
        return fields
    if bare == 'skill_view':
        return [field for field in [_field(args, 'name')] if field]
    return []


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
        raw = function.get('arguments')
        try:
            args = json.loads(raw) if isinstance(raw, str) else raw
        except (ValueError, TypeError):
            args = None
        if name in {'web_search', 'functions.web_search'}:
            record['label'] = _search_label(args) or label
        elif name in _TERMINAL:
            detail = _command_detail(args)
            if detail:
                record['detail'] = detail
        else:
            fields = _summary(name, args)
            if fields:
                record['detail'] = _short(' · '.join(fields), 600)
        result.append(record)
    if valid_count > 128:
        result[-1] = {'id': result[-1]['id'], 'name': result[-1]['name'],
                      'label': f'This and {valid_count - 128} more tool calls are not shown individually'}
    return result
