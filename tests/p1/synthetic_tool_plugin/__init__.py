import json
import os
import time
from pathlib import Path


def _record(name, **kwargs):
    path = Path(os.environ['HERMES_HOME']) / 'synthetic-events.jsonl'
    with path.open('a') as output:
        output.write(json.dumps({'event': name, 'aux_task': kwargs.get('aux_task'),
                                 'turn_id': kwargs.get('turn_id')}) + '\n')


def _expand(args, **kwargs):
    _record('tool_handler')
    return 'P1_TOOL_RESULT ' + 'synthetic local data ' * 4000


def _hold_after_history(**kwargs):
    history = kwargs.get('conversation_history') or []
    if not any(m.get('role') == 'user' and m.get('content') == 'P1_RACE'
               for m in history if isinstance(m, dict)):
        return
    home = Path(os.environ['HERMES_HOME'])
    (home / 'race-hook-entered').write_text('1')
    deadline = time.monotonic() + 10
    while not (home / 'race-hook-release').exists() and time.monotonic() < deadline:
        time.sleep(.01)
    if not (home / 'race-hook-release').exists():
        raise RuntimeError('race fixture release missing')


def register(ctx):
    ctx.register_hook('pre_auxiliary_call', lambda **kwargs: _record('pre_auxiliary_call', **kwargs))
    ctx.register_hook('post_llm_call', _hold_after_history)
    ctx.register_tool(
        name='p1_synthetic_expand', toolset='p1_synthetic',
        schema={'name': 'p1_synthetic_expand', 'description': 'Return local synthetic text.',
                'parameters': {'type': 'object', 'properties': {}, 'required': []}},
        handler=_expand,
    )
