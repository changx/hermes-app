"""Public, bounded projection of original assistant tool calls; no results or raw args."""
import ast
import json
import re
import shlex
import unicodedata
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from agent.redact import REDACTION_UNAVAILABLE, redact_for_egress

_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_.]{0,199}\Z')
_UNSAFE_COMMAND = re.compile(
    r'(?i)(?:wss?://|ftp://|\$|\b(?:password|passwd|secret|token|credential|authorization|api[_-]?key|auth[_-]?key)\b'
    r'|--[\w-]*(?:password|passwd|secret|token|credential|auth|key)[\w-]*'
    r'|\s(?:-H|-u|-p|--header|--data|--data-raw|--user|--password|--cookie)(?:\s|=)'
    r'|(?:^|\s)(?:export|env|set|printenv)\b|\b\.env\b)')
_LABELS = {
    'read_file': '阅读文件', 'search_files': '搜索文件', 'web_search': '搜索网页',
    'web_extract': '阅读网页', 'browser_exec': '浏览网页', 'terminal': '运行命令',
    'execute_code': '运行代码', 'patch': '修改文件', 'write_file': '写入文件',
    'parallel': '并行执行工具', 'multi_tool_use.parallel': '并行执行工具',
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
    """Safe shell/script preview, checked in full before truncating."""
    if not isinstance(arguments, dict):
        return None
    command = arguments.get('command')
    if not isinstance(command, str) or not command.strip() or _utf16_length(command) > 4000:
        return None
    if any(ord(char) < 32 and char not in '\n\t' for char in command):
        return None
    if _UNSAFE_COMMAND.search(command):
        return None
    try:
        # Keep quotes so a Python -c body is not mistaken for a shell assignment.
        shell = shlex.shlex(command, posix=False, punctuation_chars=True)
        shell.whitespace_split = True
        shell.commenters = ''
        if any(re.match(r'^[A-Za-z_][A-Za-z_0-9]*=', word) for word in shell):
            return None
    except ValueError:
        return None
    for url in re.findall(r'https?://[^\s\'"<>]+', command, flags=re.IGNORECASE):
        # Arbitrary query values may be credentials even without a known key name.
        if any(mark in url for mark in '@?#') or _safe_url(url) is None:
            return None
    try:
        clean = redact_for_egress(command)
    except Exception:
        return None
    if not isinstance(clean, str) or clean == REDACTION_UNAVAILABLE or 'redacted' in clean.lower() or clean != command:
        return None  # A redaction implies command structure may still reveal sensitive context.
    if _safe_text(command, multiline=True) is None:
        return None
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
    label = '搜索网页：' + ' '.join(clean.split())
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
    if bare in {'write_file', 'patch'}:
        return [field for field in [_field(args, 'path')] if field]
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
                      'label': f'此项及另外 {valid_count - 128} 项工具调用未逐项展示'}
    return result
