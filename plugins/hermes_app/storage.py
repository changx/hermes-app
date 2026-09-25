"""Plugin-owned metadata only. Bodies remain in Hermes SessionDB.

Pinned to Hermes 2f16a1aa5a35feec496949abdef7ad51aea0e7ef. A thread's
root session is a user-created session; compression descendants never receive
another Channel Description, including after prompt rebuild or cold restore.
"""
import secrets
import sqlite3
from pathlib import Path


class MissingOriginal(Exception):
    pass


class HistoryPending(Exception):
    pass


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS threads (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                    session_id TEXT UNIQUE, description TEXT NOT NULL,
                    initialized INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS threads_project ON threads(project_id, created_at);
                CREATE TABLE IF NOT EXISTS session_links (
                    session_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id));
                CREATE TABLE IF NOT EXISTS turns (
                    turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
                    state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS message_refs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL REFERENCES threads(id),
                    turn_id TEXT NOT NULL REFERENCES turns(turn_id),
                    session_id TEXT NOT NULL, row_id INTEGER NOT NULL UNIQUE,
                    role TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS refs_page ON message_refs(thread_id, seq);
            ''')

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def create_thread(self, project_id, title, session_id, description, *, thread_id=None):
        thread_id = thread_id or 'th_' + secrets.token_hex(12)
        with self._connect() as db:
            db.execute('INSERT INTO threads(id,project_id,title,session_id,description) VALUES (?,?,?,?,?)',
                       (thread_id, project_id, title, session_id, description or ''))
            db.execute('INSERT INTO session_links(session_id,thread_id) VALUES (?,?)', (session_id, thread_id))
        return thread_id

    def thread_for_session(self, session_id, parent_session_id=''):
        with self._connect() as db:
            row = db.execute('SELECT thread_id FROM session_links WHERE session_id=?', (session_id,)).fetchone()
            if row:
                return row['thread_id']
            if not parent_session_id:
                return None
            parent = db.execute('SELECT thread_id FROM session_links WHERE session_id=?',
                                (parent_session_id,)).fetchone()
            if parent:
                db.execute('INSERT OR IGNORE INTO session_links VALUES (?,?)', (session_id, parent['thread_id']))
                return parent['thread_id']
            return None

    def begin_turn(self, thread_id, turn_id):
        """A busy Thread has no queue in P1-02; reject concurrent ingress."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM turns WHERE thread_id=? AND state='pending'", (thread_id,)).fetchone():
                raise HistoryPending('thread is busy')
            db.execute("INSERT INTO turns VALUES (?,?,'pending')", (turn_id, thread_id))

    def bind_turn(self, turn_id, session_id, parent_session_id=''):
        with self._connect() as db:
            existing = db.execute('SELECT thread_id FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
        thread_id = existing['thread_id'] if existing else self.thread_for_session(session_id, parent_session_id)
        if thread_id is None:
            return None
        with self._connect() as db:
            db.execute('INSERT OR IGNORE INTO session_links(session_id,thread_id) VALUES (?,?)',
                       (session_id, thread_id))
            owner = db.execute('SELECT thread_id FROM session_links WHERE session_id=?', (session_id,)).fetchone()
            if owner['thread_id'] != thread_id:
                raise ValueError('session belongs to another thread')
            db.execute("INSERT OR IGNORE INTO turns VALUES (?,?,'pending')", (turn_id, thread_id))
        return thread_id

    def reject_turn(self, turn_id):
        with self._connect() as db:
            db.execute("UPDATE turns SET state='rejected' WHERE turn_id=? AND state='pending'", (turn_id,))

    def record_turn(self, thread_id, turn_id, refs):
        """Commit an ordered pair of core row IDs once; replay is idempotent."""
        if len(refs) != 2 or [r[2] for r in refs] != ['user', 'assistant']:
            raise ValueError('complete visible user/assistant pair required')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT thread_id,state FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
            if existing and existing['thread_id'] != thread_id:
                raise ValueError('turn belongs to another thread')
            if existing and existing['state'] == 'complete':
                old = [(r['session_id'], r['row_id'], r['role']) for r in db.execute(
                    'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq', (turn_id,))]
                if old != refs:
                    raise ValueError('turn identity changed')
                return
            if not existing:
                db.execute("INSERT INTO turns VALUES (?,?,'pending')", (turn_id, thread_id))
            for session_id, row_id, role in refs:
                db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) VALUES (?,?,?,?,?)',
                           (thread_id, turn_id, session_id, row_id, role))
            db.execute("UPDATE turns SET state='complete' WHERE turn_id=?", (turn_id,))
            db.execute("UPDATE turns SET state='complete' WHERE thread_id=? AND turn_id LIKE 'ingress:%' AND state='pending'",
                       (thread_id,))

    def history_page(self, thread_id, source_db, *, limit=50, after=None):
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError('limit must be 1..100')
        if after is not None and (not str(after).isdigit() or int(after) < 0):
            raise ValueError('invalid cursor')
        cursor = int(after or 0)
        with self._connect() as db:
            if db.execute("SELECT 1 FROM turns WHERE thread_id=? AND state='pending'", (thread_id,)).fetchone():
                raise HistoryPending('history references pending')
            refs = db.execute('SELECT seq,session_id,row_id,role FROM message_refs '
                              'WHERE thread_id=? AND seq>? ORDER BY seq LIMIT ?',
                              (thread_id, cursor, limit+1)).fetchall()
        page, more = refs[:limit], len(refs) > limit
        if not page:
            return {'messages': [], 'next_cursor': None}
        ids = [r['row_id'] for r in page]
        with sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True) as source:
            source.row_factory = sqlite3.Row
            rows = {r['id']: r for r in source.execute(
                f"SELECT id,session_id,role,content,display_kind FROM messages WHERE id IN ({','.join('?' for _ in ids)})", ids)}
        messages = []
        for ref in page:
            row = rows.get(ref['row_id'])
            if row is None or row['session_id'] != ref['session_id'] or row['role'] != ref['role']:
                raise MissingOriginal(f"original row {ref['row_id']} unavailable")
            if row['display_kind'] == 'hidden' or not isinstance(row['content'], str):
                raise MissingOriginal(f"original row {ref['row_id']} is not a visible text row")
            messages.append({'id': str(row['id']), 'role': row['role'], 'text': row['content']})
        return {'messages': messages, 'next_cursor': str(page[-1]['seq']) if more else None}

    def get_thread(self, thread_id):
        with self._connect() as db:
            row = db.execute('SELECT * FROM threads WHERE id=?', (thread_id,)).fetchone()
            return dict(row) if row else None

    def list_threads(self, project_id):
        with self._connect() as db:
            return [dict(r) for r in db.execute(
                'SELECT id,project_id,title,archived,created_at FROM threads WHERE project_id=? ORDER BY created_at,id',
                (project_id,))]

    def update_thread(self, thread_id, title=None, archived=None):
        if title is None and archived is None:
            return self.get_thread(thread_id)
        fields, values = [], []
        if title is not None:
            if not isinstance(title, str) or not title.strip():
                raise ValueError('title required')
            fields.append('title=?'); values.append(title.strip())
        if archived is not None:
            fields.append('archived=?'); values.append(int(bool(archived)))
        with self._connect() as db:
            db.execute(f"UPDATE threads SET {','.join(fields)} WHERE id=?", [*values, thread_id])
        return self.get_thread(thread_id)

    def take_initial_description(self, session_id):
        """Atomic one-time *user session* initialization; never match a child ID."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT description FROM threads WHERE session_id=? AND initialized=0',
                             (session_id,)).fetchone()
            if row is None:
                return ''
            db.execute('UPDATE threads SET initialized=1 WHERE session_id=?', (session_id,))
            return row['description']

    def close(self):
        pass  # Connections are scoped per operation.
