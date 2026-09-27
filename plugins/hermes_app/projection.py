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


def _public_commentary(message):
    """Codex stores public progress separately; analysis/reasoning is never read."""
    if message.get('role') != 'assistant':
        return ''
    items = message.get('codex_message_items')
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            return ''
    if not isinstance(items, list):
        return ''
    parts = []
    for item in items:
        if (not isinstance(item, dict) or item.get('type') != 'message' or
                item.get('role') != 'assistant' or item.get('phase') != 'commentary' or
                item.get('status') != 'completed' or not isinstance(item.get('content'), list)):
            continue
        for part in item['content']:
            if (isinstance(part, dict) and part.get('type') == 'output_text' and
                    isinstance(part.get('text'), str) and part['text'].strip()):
                parts.append(part['text'])
    return '\n\n'.join(parts)


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
    commentary = _public_commentary(value)
    from .tool_timeline import public_tool_calls
    calls = public_tool_calls(value) if value['role'] == 'assistant' else []
    # The core display projector suppresses empty assistant rows. Supply a
    # local sentinel only to run its existing marker/compaction filtering; the
    # sentinel never leaves this function or changes the original row.
    tool_only = (calls or commentary) and (not isinstance(value['content'], str) or not value['content'].strip())
    if tool_only:
        value['content'] = 'hermes-app-tool-only-projection'
    # Core's one-row display projection needs no raw tool arguments (it uses
    # them only to decorate following *tool* rows, which are never selected).
    # Invalid nested calls must not suppress otherwise valid public prose.
    value['tool_calls'] = []
    if isinstance(value.get('display_metadata'), str):
        try:
            value['display_metadata'] = json.loads(value['display_metadata'])
        except (ValueError, TypeError):
            value['display_metadata'] = None
    try:
        projected = _history_to_messages([value])
    except (ValueError, TypeError, AttributeError):
        return None  # Malformed source must never bypass core filtering.
    if len(projected) != 1 or projected[0].get('role') != value['role']:
        return None
    text = projected[0].get('text')
    text = ('' if calls else None) if tool_only else text if isinstance(text, str) and text.strip() else None
    if commentary:
        # Filter commentary independently so prepending it cannot mask an internal
        # marker in the original body, or bypass the core's display rules.
        try:
            public = _history_to_messages([{**value, 'content': commentary}])
        except (ValueError, TypeError, AttributeError):
            public = []
        if len(public) == 1 and public[0].get('role') == 'assistant':
            progress = public[0].get('text')
            if isinstance(progress, str) and progress.strip() and progress != text:
                return '\n\n'.join(part for part in (progress, text) if part)
    return text
