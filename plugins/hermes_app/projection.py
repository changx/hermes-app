"""Bounded user-facing projection of one pinned-core transcript row."""
import json

_INTERNAL_KINDS = frozenset({
    'hidden', 'session_meta', 'model_switch', 'personality_switch',
    'auto_continue', 'compression_summary',
})


def _content(value):
    if not isinstance(value, str) or value[:1] not in ('[', '{'):
        return value
    try:
        parsed = json.loads(value)
    except ValueError:
        return value
    if isinstance(parsed, list) and parsed and all(
            isinstance(p, dict) and ('type' in p or 'text' in p) for p in parsed):
        return parsed
    if isinstance(parsed, dict) and ('type' in parsed or 'text' in parsed):
        return parsed
    return value


def visible_text(message):
    """Use the core display projection, suppressing internal records entirely."""
    if message.get('role') not in ('user', 'assistant') or message.get('display_kind') in _INTERNAL_KINDS:
        return None
    from agent.context_compressor import is_compaction_summary_message
    if is_compaction_summary_message(message):
        return None  # A handoff carrier can embed old tail text; never publish it as an original.
    from tui_gateway.server import _history_to_messages
    value = dict(message)
    value['content'] = _content(value.get('content'))
    projected = _history_to_messages([value])
    if len(projected) != 1 or projected[0].get('role') != value['role']:
        return None
    text = projected[0].get('text')
    return text if isinstance(text, str) and text.strip() else None
