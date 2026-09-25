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
        store=_store()
        thread_id=store.bind_turn(turn_id, session_id, _compression_parent(session_id))
        _link_core_user(store,thread_id)
    return None


def _link_core_user(store,thread_id):
    """Clear transient queued body once core persisted its exact inbound user ID."""
    ingress=store.pending_ingress_id(thread_id) if thread_id else None
    if ingress:
        store.link_user_from_core(ingress,get_hermes_home() / 'state.db')


def post_tool_call(**kwargs):
    """Capture a visible assistant tool-call row by its formal call ID."""
    turn_id, session_id, call_id = (kwargs.get(k) for k in
                                    ('turn_id', 'session_id', 'tool_call_id'))
    if not turn_id or not session_id or not call_id:
        return None
    store = _store()
    thread_id = store.thread_for_session(session_id)
    ingress_id = store.pending_ingress_id(thread_id) if thread_id else None
    if not ingress_id:
        return None
    from .projection import visible_text
    with closing(sqlite3.connect(f'file:{get_hermes_home() / "state.db"}?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        anchor = db.execute("SELECT * FROM messages WHERE session_id=? AND role='user' "
                            'AND platform_message_id=? ORDER BY id LIMIT 1',
                            (session_id, ingress_id)).fetchone()
        assistant = db.execute("SELECT * FROM messages WHERE session_id=? AND role='assistant' "
                               'AND active=1 ORDER BY id DESC LIMIT 1', (session_id,)).fetchone()
    if not anchor or not assistant:
        return None
    try:
        calls = json.loads(assistant['tool_calls'] or '[]')
    except (TypeError, ValueError):
        return None
    if not any(isinstance(c, dict) and c.get('id') == call_id for c in calls):
        return None
    if visible_text(dict(anchor)) is None or visible_text(dict(assistant)) is None:
        return None
    store.bind_turn(turn_id, session_id)
    old = store.turn_refs(turn_id)
    refs = ([] if old else [(session_id, anchor['id'], 'user')])
    if not old or assistant['id'] > old[-1][1]:
        refs.append((session_id, assistant['id'], 'assistant'))
    if refs:
        store.append_hook_refs(thread_id, turn_id, refs)
    return None


def pre_auxiliary_call(**kwargs):
    """Snapshot original interim rows before a same-turn compression archive."""
    if kwargs.get('platform') != 'hermes_app' or kwargs.get('aux_task') != 'compression':
        return None
    turn_id, session_id = kwargs.get('turn_id'), kwargs.get('session_id')
    if not turn_id or not session_id:
        return None
    store = _store()
    thread_id = store.bind_turn(turn_id, session_id, _compression_parent(session_id))
    ingress_id = store.pending_ingress_id(thread_id) if thread_id else None
    if not ingress_id:
        return None
    from .projection import visible_text
    with closing(sqlite3.connect(f'file:{get_hermes_home() / "state.db"}?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        anchor = db.execute("SELECT id FROM messages WHERE session_id=? AND role='user' "
                            'AND platform_message_id=? ORDER BY id LIMIT 1',
                            (session_id, ingress_id)).fetchone()
        tool = db.execute("SELECT id FROM messages WHERE session_id=? AND role='tool' "
                          'AND active=1 ORDER BY id DESC LIMIT 1', (session_id,)).fetchone()
        if not anchor or not tool or tool['id'] <= anchor['id']:
            return None
        old = store.turn_refs(turn_id)
        if old:
            # The latest active assistant immediately preceding this tool was
            # created by this tool round. Earlier active rows may be compaction
            # copies and are deliberately ignored.
            rows = db.execute("SELECT * FROM messages WHERE session_id=? AND role='assistant' "
                              'AND active=1 AND id>? AND id<? ORDER BY id DESC LIMIT 1',
                              (session_id, old[-1][1], tool['id'])).fetchall()
        else:
            rows = db.execute('SELECT * FROM messages WHERE session_id=? AND id>=? AND id<? '
                              'ORDER BY id', (session_id, anchor['id'], tool['id'])).fetchall()
        refs = [(session_id, r['id'], r['role']) for r in rows if visible_text(dict(r)) is not None]
    if refs:
        store.append_hook_refs(thread_id, turn_id, refs)
    return None


def post_llm_call(**kwargs):
    if kwargs.get('platform') != 'hermes_app':
        return None
    turn_id, session_id = kwargs.get('turn_id'), kwargs.get('session_id')
    if not turn_id or not session_id:
        return None
    store = _store()
    thread_id = store.bind_turn(turn_id, session_id)
    _link_core_user(store,thread_id)
    if thread_id is None:
        log.error('unmapped Hermes App post_llm_call session=%s turn=%s', session_id, turn_id)
        return None
    history = kwargs.get('conversation_history') or []
    # The core's post hook carries the final turn history. The last durable user
    # anchor bounds this turn; row IDs, never text, identify its visible rows.
    users = [i for i, m in enumerate(history) if isinstance(m, dict) and m.get('role') == 'user']
    if not users:
        return _complete_compacted_tail(store, thread_id, turn_id, session_id, history)
    from .projection import visible_text
    candidates = [m for m in history[users[-1]:] if isinstance(m, dict) and
                  m.get('role') in ('user', 'assistant')]
    visible = [m for m in candidates if visible_text(m) is not None]
    if not visible or visible[0].get('role') != 'user':
        return _complete_compacted_tail(store, thread_id, turn_id, session_id, history)
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
    refs = [(rows[i][0], i, m['role']) for i, m in zip(ids, visible)]
    old = store.turn_refs(turn_id)
    if old and refs[:len(old)] != old:
        # A copied protected user/tail may survive while earlier original
        # interim rows have left the in-memory history.
        return _complete_compacted_tail(store, thread_id, turn_id, session_id, history)
    store.record_turn(thread_id, turn_id, refs)
    return None


def _complete_compacted_tail(store, thread_id, turn_id, session_id, history):
    """The final post hook can contain only a copied protected tail after compression."""
    from .projection import visible_text
    old = store.turn_refs(turn_id)
    candidates = [m for m in history if isinstance(m, dict) and m.get('role') == 'assistant'
                  and visible_text(m) is not None]
    if (not old or not candidates or candidates[-1].get('tool_calls') or
            type(candidates[-1].get('_row_id')) is not int):
        log.error('Hermes App turn %s has no original anchor or durable final', turn_id)
        return None
    final_id = candidates[-1]['_row_id']
    if final_id <= old[-1][1]:
        log.error('Hermes App turn %s final row is not after captured interim', turn_id)
        return None
    with closing(sqlite3.connect(f'file:{get_hermes_home() / "state.db"}?mode=ro', uri=True)) as db:
        row = db.execute('SELECT session_id,role,tool_calls FROM messages WHERE id=?', (final_id,)).fetchone()
    if not row or row[:2] != (session_id, 'assistant') or row[2] not in (None, '[]'):
        log.error('Hermes App turn %s final row is unavailable', turn_id)
        return None
    store.append_hook_refs(thread_id, turn_id, [(session_id, final_id, 'assistant')], complete=True)
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
