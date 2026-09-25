"""Plugin-owned metadata only. Bodies remain in Hermes SessionDB.

Pinned to Hermes 2f16a1aa5a35feec496949abdef7ad51aea0e7ef. A thread's
root session is a user-created session; compression descendants never receive
another Channel Description, including after prompt rebuild or cold restore.
"""
import secrets
import sqlite3
from pathlib import Path


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
        return thread_id

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
