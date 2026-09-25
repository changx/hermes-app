"""Formal lifecycle hooks. Only stable row references enter plugin metadata."""
import logging
import sqlite3
import json

from .storage import Store
from hermes_constants import get_hermes_home

log = logging.getLogger(__name__)


def _store():
    return Store(get_hermes_home() / 'hermes-app' / 'metadata.sqlite')


def _compression_parent(session_id, source_db=None):
    """Only a core compression child inherits the Thread; a branch owns its history."""
    with sqlite3.connect(f'file:{source_db or get_hermes_home() / "state.db"}?mode=ro', uri=True) as db:
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
    # The current turn is the suffix beginning at its last user row. Never match
    # text: identical messages are independent rows, even across compression.
    users = [i for i, m in enumerate(history) if isinstance(m, dict) and m.get('role') == 'user']
    if not users:
        log.error('Hermes App turn %s has no user row', turn_id)
        return None
    user = history[users[-1]]
    assistants = [m for m in history[users[-1]+1:] if isinstance(m, dict) and
                  m.get('role') == 'assistant' and isinstance(m.get('content'), str) and m['content'].strip()]
    if not assistants:
        log.error('Hermes App turn %s has no visible assistant row', turn_id)
        return None
    assistant = assistants[-1]
    if not isinstance(user.get('_row_id'), int) or not isinstance(assistant.get('_row_id'), int):
        log.error('Hermes App turn %s lacks original row IDs: user=%s assistant=%s',
                  turn_id, user.get('_row_id'), assistant.get('_row_id'))
        return None
    ids = (user['_row_id'], assistant['_row_id'])
    with sqlite3.connect(f'file:{get_hermes_home() / "state.db"}?mode=ro', uri=True) as db:
        rows = {r[0]: (r[1], r[2]) for r in db.execute(
            'SELECT id,session_id,role FROM messages WHERE id IN (?,?)', ids)}
    if any(row_id not in rows or rows[row_id][1] != role for row_id, role in zip(ids, ('user','assistant'))):
        log.error('Hermes App turn %s references unavailable rows %s', turn_id, ids)
        return None
    store.record_turn(thread_id, turn_id, [
        (rows[user['_row_id']][0], user['_row_id'], 'user'),
        (rows[assistant['_row_id']][0], assistant['_row_id'], 'assistant')])
    return None
