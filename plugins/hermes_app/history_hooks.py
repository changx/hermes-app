"""Formal lifecycle hooks. Only stable row references enter plugin metadata."""
import logging
import sqlite3
import json
from contextlib import closing

from .storage import Store
from hermes_constants import get_hermes_home

log = logging.getLogger(__name__)


def _store():
    return Store(get_hermes_home() / 'hermes-app' / 'metadata.sqlite')


def _compression_parent(session_id, source_db=None):
    """Only a core compression child inherits the Thread; a branch owns its history."""
    with closing(sqlite3.connect(f'file:{source_db or get_hermes_home() / "state.db"}?mode=ro', uri=True)) as db:
        row = db.execute('SELECT child.parent_session_id,child.model_config,parent.end_reason '
                         'FROM sessions child LEFT JOIN sessions parent ON parent.id=child.parent_session_id '
                         'WHERE child.id=?', (session_id,)).fetchone()
    if not row or row[2] != 'compression':
        return ''
    try:
        config = json.loads(row[1] or '{}')
    except (ValueError, TypeError):
        return ''
    if config.get('_branched_from') or config.get('_reset_from'):
        return ''
    return row[0] or ''


def pre_llm_call(**kwargs):
    if kwargs.get('platform') != 'hermes_app':
        return None
    turn_id, session_id = kwargs.get('turn_id'), kwargs.get('session_id')
    if turn_id and session_id:
        _store().bind_turn(turn_id, session_id, _compression_parent(session_id))
    return None


def post_llm_call(**kwargs):
    if kwargs.get('platform') != 'hermes_app':
        return None
    turn_id, session_id = kwargs.get('turn_id'), kwargs.get('session_id')
    if not turn_id or not session_id:
        return None
    store = _store()
    thread_id = store.bind_turn(turn_id, session_id)
    if thread_id is None:
        log.error('unmapped Hermes App post_llm_call session=%s turn=%s', session_id, turn_id)
        return None
    history = kwargs.get('conversation_history') or []
    # The core's post hook carries the final turn history. The last durable user
    # anchor bounds this turn; row IDs, never text, identify its visible rows.
    users = [i for i, m in enumerate(history) if isinstance(m, dict) and m.get('role') == 'user']
    if not users:
        log.error('Hermes App turn %s has no user row', turn_id)
        return None
    from .projection import visible_text
    candidates = [m for m in history[users[-1]:] if isinstance(m, dict) and
                  m.get('role') in ('user', 'assistant')]
    visible = [m for m in candidates if visible_text(m) is not None]
    if not visible or visible[0].get('role') != 'user':
        log.error('Hermes App turn %s has no visible user anchor', turn_id)
        return None
    ids = [m.get('_row_id') for m in visible]
    if any(type(i) is not int for i in ids) or len(set(ids)) != len(ids):
        log.error('Hermes App turn %s has missing or duplicate original row IDs', turn_id)
        return None
    with closing(sqlite3.connect(f'file:{get_hermes_home() / "state.db"}?mode=ro', uri=True)) as db:
        rows = {r[0]: (r[1], r[2]) for r in db.execute(
            f"SELECT id,session_id,role FROM messages WHERE id IN ({','.join('?' for _ in ids)})", ids)}
    if any(i not in rows or rows[i][1] != m['role'] for i, m in zip(ids, visible)):
        log.error('Hermes App turn %s references unavailable rows %s', turn_id, ids)
        return None
    store.record_turn(thread_id, turn_id, [(rows[i][0], i, m['role']) for i, m in zip(ids, visible)])
    return None


def on_session_end(**kwargs):
    """Surface failed/interrupted turns. Adapter task settlement maps late writes."""
    if kwargs.get('platform') != 'hermes_app' or kwargs.get('completed') is True:
        return None
    turn_id, session_id = kwargs.get('turn_id'), kwargs.get('session_id')
    if not turn_id or not session_id:
        return None
    store = _store()
    thread_id = store.bind_turn(turn_id, session_id)
    if thread_id is None:
        thread_id = store.bind_turn(turn_id, session_id, _compression_parent(session_id))
    if thread_id is None:
        return None
    state = ('interrupted' if kwargs.get('interrupted') else
             'failed' if kwargs.get('failed') else 'unknown')
    store.finish_turn(thread_id, turn_id, state)
    return None
