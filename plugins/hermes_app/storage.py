"""Plugin-owned metadata only. Bodies remain in Hermes SessionDB.

Pinned to Hermes 2f16a1aa5a35feec496949abdef7ad51aea0e7ef. A thread's
root session is a user-created session; compression descendants never receive
another Channel Description, including after prompt rebuild or cold restore.
"""
import secrets
import sqlite3
import base64
import json
import hashlib
from contextlib import contextmanager, closing
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
                CREATE TABLE IF NOT EXISTS ingress_links (
                    ingress_id TEXT PRIMARY KEY REFERENCES turns(turn_id),
                    turn_id TEXT NOT NULL UNIQUE REFERENCES turns(turn_id));
                CREATE TABLE IF NOT EXISTS message_refs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL REFERENCES threads(id),
                    turn_id TEXT NOT NULL REFERENCES turns(turn_id),
                    session_id TEXT NOT NULL, row_id INTEGER NOT NULL UNIQUE,
                    role TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS refs_page ON message_refs(thread_id, seq);
                CREATE TABLE IF NOT EXISTS receipts (
                    id TEXT PRIMARY KEY, client_message_id TEXT NOT NULL UNIQUE,
                    thread_id TEXT NOT NULL REFERENCES threads(id),
                    payload_hash TEXT NOT NULL, pending_text TEXT,
                    state TEXT NOT NULL, user_row_id INTEGER,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()));
                CREATE INDEX IF NOT EXISTS receipt_queue ON receipts(thread_id,state,created_at);
                CREATE TABLE IF NOT EXISTS sync_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
                    thread_id TEXT NOT NULL, ref TEXT NOT NULL, version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS read_positions (
                    thread_id TEXT PRIMARY KEY REFERENCES threads(id), ref_seq INTEGER NOT NULL);
                CREATE TRIGGER IF NOT EXISTS published_ref AFTER INSERT ON message_refs BEGIN
                    INSERT INTO sync_events(kind,thread_id,ref,version)
                    VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1);
                END;
            ''')

    @contextmanager
    def _connect(self):
        with closing(sqlite3.connect(self.path, timeout=10)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            with db:
                yield db

    def create_thread(self, project_id, title, session_id, description, *, thread_id=None):
        thread_id = thread_id or 'th_' + secrets.token_hex(12)
        with self._connect() as db:
            db.execute('INSERT INTO threads(id,project_id,title,session_id,description) VALUES (?,?,?,?,?)',
                       (thread_id, project_id, title, session_id, description or ''))
            db.execute('INSERT INTO session_links(session_id,thread_id) VALUES (?,?)', (session_id, thread_id))
            self._event(db,'thread',thread_id,thread_id)
        return thread_id

    def _event(self, db, kind, thread_id, ref, version=1):
        db.execute('INSERT INTO sync_events(kind,thread_id,ref,version) VALUES (?,?,?,?)',
                   (kind, thread_id, ref, version))

    def accept(self, thread_id, client_message_id, text):
        if not isinstance(client_message_id, str) or not 1 <= len(client_message_id) <= 128 or not all(
                c.isascii() and (c.isalnum() or c in '-_.:') for c in client_message_id):
            raise ValueError('invalid client_message_id')
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 16000:
            raise ValueError('invalid text')
        digest = hashlib.sha256(text.encode()).hexdigest()  # Integrity only; never identity.
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM receipts WHERE client_message_id=?', (client_message_id,)).fetchone()
            if row:
                if row['thread_id'] != thread_id or row['payload_hash'] != digest:
                    raise ValueError('client_message_id conflict')
                return self._receipt(row), False
            pending = db.execute("SELECT COUNT(*) FROM receipts WHERE thread_id=? AND state IN ('queued','running')",
                                 (thread_id,)).fetchone()[0]
            if pending >= 32:
                raise OverflowError('thread queue full')
            receipt_id = 'rc_' + secrets.token_hex(16)
            db.execute("INSERT INTO receipts(id,client_message_id,thread_id,payload_hash,pending_text,state) "
                       "VALUES (?,?,?,?,?,'queued')", (receipt_id,client_message_id,thread_id,digest,text))
            self._event(db, 'receipt', thread_id, receipt_id)
            row = db.execute('SELECT * FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            return self._receipt(row), True

    @staticmethod
    def _receipt(row):
        return {'id':row['id'], 'client_message_id':row['client_message_id'],
                'thread_id':row['thread_id'], 'state':row['state'], 'durable':True}

    def receipt(self, receipt_id):
        with self._connect() as db:
            row = db.execute('SELECT * FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            return self._receipt(row) if row else None

    def recover_receipts(self, source_db=None):
        if source_db and Path(source_db).exists():
            with self._connect() as db:
                running=[dict(r) for r in db.execute("SELECT id,thread_id FROM receipts WHERE state='running'")]
            for receipt in running:
                self._recover_visible_result(receipt['id'],receipt['thread_id'],source_db)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute("SELECT id,thread_id FROM receipts WHERE state='running'").fetchall():
                db.execute("UPDATE receipts SET state='unknown' WHERE id=?", (row['id'],))
                db.execute("UPDATE turns SET state='unknown' WHERE turn_id=? AND state='pending'",
                           ('ingress:'+row['id'],))
                linked=db.execute('SELECT turn_id FROM ingress_links WHERE ingress_id=?',('ingress:'+row['id'],)).fetchone()
                if linked:
                    db.execute("UPDATE turns SET state='unknown' WHERE turn_id=? AND state='pending'",(linked[0],))
                self._event(db,'receipt',row['thread_id'],row['id'],3)
            return [r[0] for r in db.execute("SELECT DISTINCT thread_id FROM receipts WHERE state='queued'")]

    def _recover_visible_result(self, receipt_id, thread_id, source_db):
        """Publish exact core rows after a crash, retaining uncertain execution state."""
        from .projection import visible_text
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
            source.row_factory=sqlite3.Row
            anchors=source.execute("SELECT * FROM messages WHERE role='user' AND platform_message_id=?",
                                   (receipt_id,)).fetchall()
            if len(anchors)!=1:
                return
            anchor=anchors[0]
            next_user=source.execute("SELECT MIN(id) FROM messages WHERE session_id=? AND role='user' "
                                     "AND platform_message_id IS NOT NULL AND id>?",
                                     (anchor['session_id'],anchor['id'])).fetchone()[0]
            final=source.execute("SELECT * FROM messages WHERE session_id=? AND role='assistant' "
                                 "AND id>? AND id<? AND (tool_calls IS NULL OR tool_calls='[]') "
                                 "ORDER BY id DESC LIMIT 1",
                                 (anchor['session_id'],anchor['id'],next_user or 9223372036854775807)).fetchone()
        if visible_text(dict(anchor)) is None:
            return
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            turn=db.execute('SELECT turn_id FROM ingress_links WHERE ingress_id=?',('ingress:'+receipt_id,)).fetchone()
            turn_id=turn[0] if turn else 'settled:'+receipt_id
            db.execute("INSERT OR IGNORE INTO turns VALUES (?,?,'pending')",(turn_id,thread_id))
            db.execute('INSERT OR IGNORE INTO message_refs(thread_id,turn_id,session_id,row_id,role) '
                       'VALUES (?,?,?,?,?)',(thread_id,turn_id,anchor['session_id'],anchor['id'],'user'))
            if final and visible_text(dict(final)) is not None:
                db.execute('INSERT OR IGNORE INTO message_refs(thread_id,turn_id,session_id,row_id,role) '
                           'VALUES (?,?,?,?,?)',(thread_id,turn_id,final['session_id'],final['id'],'assistant'))
            db.execute('UPDATE receipts SET user_row_id=?,pending_text=NULL WHERE id=?',
                       (anchor['id'],receipt_id))

    def claim_next(self, thread_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM receipts WHERE thread_id=? AND state='running'", (thread_id,)).fetchone():
                return None
            row = db.execute("SELECT id,pending_text FROM receipts WHERE thread_id=? AND state='queued' "
                             'ORDER BY created_at,rowid LIMIT 1', (thread_id,)).fetchone()
            if not row:
                return None
            db.execute("UPDATE receipts SET state='running' WHERE id=?", (row['id'],))
            db.execute("INSERT INTO turns VALUES (?,?,'pending')", ('ingress:'+row['id'],thread_id))
            self._event(db,'receipt',thread_id,row['id'],2)
            return row['id'],row['pending_text']

    def finish_receipt(self, receipt_id, state):
        if state not in ('completed','failed','interrupted','unknown'):
            raise ValueError('invalid receipt outcome')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT thread_id,state FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            if not row or row['state'] != 'running':
                return
            db.execute('UPDATE receipts SET state=? WHERE id=?', (state,receipt_id))
            self._event(db,'receipt',row['thread_id'],receipt_id,3)

    def link_user_receipt(self, receipt_id, row_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE receipts SET user_row_id=?,pending_text=NULL WHERE id=? AND user_row_id IS NULL',
                       (row_id,receipt_id))

    def link_user_from_core(self, receipt_id, source_db):
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
            rows=source.execute("SELECT id FROM messages WHERE role='user' AND platform_message_id=? LIMIT 2",
                                (receipt_id,)).fetchall()
        if len(rows)==1:
            self.link_user_receipt(receipt_id,rows[0][0])
            return True
        return False

    @staticmethod
    def _owner_key(path):
        return hashlib.sha256(str(Path(path).resolve()).encode()).hexdigest()[:16]

    def _sync_cursor(self,seq):
        return base64.urlsafe_b64encode(json.dumps([self._owner_key(self.path),seq],separators=(',',':')).encode()).decode().rstrip('=')

    def _sync_position(self, db, cursor):
        if cursor is None:
            return 0
        if not isinstance(cursor,str) or len(cursor)>256:
            raise ValueError('invalid sync cursor')
        try:
            value=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
            if not isinstance(value,list) or len(value)!=2 or value[0]!=self._owner_key(self.path) or type(value[1]) is not int or value[1]<0:
                raise ValueError
            seq=value[1]
        except (ValueError,TypeError,UnicodeDecodeError,base64.binascii.Error) as exc:
            raise ValueError('invalid sync cursor') from exc
        high=db.execute('SELECT COALESCE(MAX(seq),0) FROM sync_events').fetchone()[0]
        if seq>high or (seq and not db.execute('SELECT 1 FROM sync_events WHERE seq=?',(seq,)).fetchone()):
            raise ValueError('invalid sync cursor')
        return seq

    def sync_page(self, *, cursor=None, limit=100):
        if type(limit) is not int or not 1<=limit<=200:
            raise ValueError('limit must be 1..200')
        with self._connect() as db:
            db.execute('BEGIN')
            start=self._sync_position(db,cursor)
            high=db.execute('SELECT COALESCE(MAX(seq),0) FROM sync_events').fetchone()[0]
            rows=db.execute('SELECT * FROM sync_events WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?',
                            (start,high,limit+1)).fetchall()
            page=rows[:limit]
            events=[{'event_id':r['seq'],'kind':r['kind'],'thread_id':r['thread_id'],
                     'ref':r['ref'],'version':r['version'],'cursor':self._sync_cursor(r['seq'])} for r in page]
            last=page[-1]['seq'] if page else start
            return {'events':events,'waterline':self._sync_cursor(high),
                    'next_cursor':self._sync_cursor(last), 'has_more':len(rows)>limit}

    def snapshot(self, *, after=None, limit=50):
        if type(limit) is not int or not 1<=limit<=100:
            raise ValueError('limit must be 1..100')
        boundary=''
        if after is not None:
            if not isinstance(after,str) or len(after)>256:
                raise ValueError('invalid snapshot cursor')
            try:
                value=json.loads(base64.urlsafe_b64decode(after+'='*(-len(after)%4)))
                if (not isinstance(value,list) or len(value)!=2 or
                        value[0]!=self._owner_key(self.path) or not isinstance(value[1],str)):
                    raise ValueError
                boundary=value[1]
            except (ValueError,TypeError,UnicodeDecodeError,base64.binascii.Error) as exc:
                raise ValueError('invalid snapshot cursor') from exc
        with self._connect() as db:
            db.execute('BEGIN')
            if boundary and not db.execute('SELECT 1 FROM threads WHERE id=?',(boundary,)).fetchone():
                raise ValueError('invalid snapshot cursor')
            high=db.execute('SELECT COALESCE(MAX(seq),0) FROM sync_events').fetchone()[0]
            rows=db.execute('SELECT t.id,t.project_id,t.title,t.archived,'
                            'COALESCE((SELECT MAX(seq) FROM message_refs WHERE thread_id=t.id),0) AS last_ref,'
                            'COALESCE(r.ref_seq,0) AS read_ref '
                            'FROM threads t LEFT JOIN read_positions r ON r.thread_id=t.id '
                            'WHERE t.id>? ORDER BY t.id LIMIT ?', (boundary,limit+1)).fetchall()
            page=rows[:limit]
            threads=[]
            for row in page:
                item=dict(row)
                item['unread_count']=db.execute('SELECT COUNT(*) FROM message_refs WHERE thread_id=? AND seq>?',
                                                 (item['id'],item['read_ref'])).fetchone()[0]
                threads.append(item)
            next_after=(base64.urlsafe_b64encode(json.dumps([self._owner_key(self.path),page[-1]['id']],
                                                separators=(',',':')).encode()).decode().rstrip('=')
                        if len(rows)>limit else None)
            return {'threads':threads,'waterline':self._sync_cursor(high),'next_after':next_after}

    def read_thread(self, thread_id, ref_seq):
        if type(ref_seq) is not int or ref_seq<0:
            raise ValueError('invalid read reference')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if ref_seq and not db.execute('SELECT 1 FROM message_refs WHERE thread_id=? AND seq=?',
                                           (thread_id,ref_seq)).fetchone():
                raise ValueError('unknown visible reference')
            old=db.execute('SELECT ref_seq FROM read_positions WHERE thread_id=?',(thread_id,)).fetchone()
            position=max(ref_seq, old[0] if old else 0)
            if not old or position>old[0]:
                db.execute('INSERT INTO read_positions(thread_id,ref_seq) VALUES (?,?) '
                           'ON CONFLICT(thread_id) DO UPDATE SET ref_seq=excluded.ref_seq',(thread_id,position))
                self._event(db,'read',thread_id,str(position),position)
            unread=db.execute('SELECT COUNT(*) FROM message_refs WHERE thread_id=? AND seq>?',
                              (thread_id,position)).fetchone()[0]
            return {'ref_seq':position,'unread_count':unread}

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
            if not turn_id.startswith('ingress:'):
                ingress = db.execute(
                    "SELECT turn_id FROM turns WHERE thread_id=? AND state='pending' "
                    "AND turn_id LIKE 'ingress:%' ORDER BY rowid DESC LIMIT 1", (thread_id,)).fetchone()
                if ingress:
                    db.execute('INSERT OR IGNORE INTO ingress_links VALUES (?,?)',
                               (ingress['turn_id'], turn_id))
        return thread_id

    def reject_turn(self, turn_id):
        with self._connect() as db:
            db.execute("UPDATE turns SET state='rejected' WHERE turn_id=? AND state='pending'", (turn_id,))

    def mark_ingress_unknown(self, thread_id, ingress_id):
        """Release a settled gateway owner whose provenance could not be reconciled."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute("UPDATE turns SET state='unknown' WHERE turn_id=? AND thread_id=? "
                                 "AND state='pending'", (ingress_id, thread_id)).rowcount
            if not changed:
                return
            pending = db.execute("SELECT 1 FROM turns WHERE thread_id=? AND state='pending' "
                                 "AND turn_id NOT LIKE 'ingress:%' LIMIT 1", (thread_id,)).fetchone()
            if pending:
                db.execute("UPDATE turns SET state='unknown' WHERE thread_id=? AND state='pending' "
                           "AND turn_id NOT LIKE 'ingress:%'", (thread_id,))
            else:
                db.execute("INSERT OR IGNORE INTO turns VALUES (?,?,'unknown')",
                           ('settled:' + ingress_id.removeprefix('ingress:'), thread_id))

    def turn_state(self, turn_id):
        with self._connect() as db:
            row = db.execute('SELECT state FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
            return row['state'] if row else None

    def latest_ref_row_id(self, thread_id, session_id):
        with self._connect() as db:
            row = db.execute('SELECT MAX(row_id) AS last_id FROM message_refs WHERE thread_id=? AND session_id=?',
                             (thread_id, session_id)).fetchone()
            return row['last_id'] or 0

    def finish_turn(self, thread_id, turn_id, state):
        if state not in ('failed', 'interrupted', 'unknown'):
            raise ValueError('invalid turn outcome')
        with self._connect() as db:
            db.execute('UPDATE turns SET state=? WHERE turn_id=? AND thread_id=?', (state, turn_id, thread_id))

    def record_turn(self, thread_id, turn_id, refs):
        """Commit the durable visible rows of one turn; a user-only turn is valid."""
        if not refs or refs[0][2] != 'user' or any(r[2] not in ('user', 'assistant') for r in refs):
            raise ValueError('visible turn must start with a user row')
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
            old = [(r['session_id'], r['row_id'], r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq', (turn_id,))]
            if refs[:len(old)] != old:
                raise ValueError('turn identity changed')
            for session_id, row_id, role in refs[len(old):]:
                db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) VALUES (?,?,?,?,?)',
                           (thread_id, turn_id, session_id, row_id, role))
            db.execute("UPDATE turns SET state='complete' WHERE turn_id=?", (turn_id,))

    def append_hook_refs(self, thread_id, turn_id, refs, *, complete=False):
        """Record original rows observed by a formal hook before compaction archives them."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT thread_id,state FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
            if row is None or row['thread_id'] != thread_id or row['state'] not in ('pending','complete'):
                raise ValueError('unmapped or settled hook turn')
            old = [(r['session_id'],r['row_id'],r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq', (turn_id,))]
            if not old and (not refs or refs[0][2] != 'user'):
                raise ValueError('hook turn needs original user anchor')
            if any(ref[2] not in ('user','assistant') for ref in refs):
                raise ValueError('invalid visible row')
            if old and refs and refs[0][1] <= old[-1][1]:
                raise ValueError('hook rows out of order')
            db.executemany('INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) '
                           'VALUES (?,?,?,?,?)', [(thread_id,turn_id,*ref) for ref in refs])
            if complete:
                db.execute("UPDATE turns SET state='complete' WHERE turn_id=?", (turn_id,))

    def turn_refs(self, turn_id):
        with self._connect() as db:
            return [(r['session_id'],r['row_id'],r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq', (turn_id,))]

    def pending_ingress_id(self, thread_id):
        with self._connect() as db:
            row = db.execute("SELECT turn_id FROM turns WHERE thread_id=? AND state='pending' "
                             "AND turn_id LIKE 'ingress:%' ORDER BY rowid DESC LIMIT 1", (thread_id,)).fetchone()
            return row['turn_id'].removeprefix('ingress:') if row else None

    def settle_ingress(self, thread_id, ingress_id, platform_message_id, source_db, *, owner_finished=False):
        """Reconcile an inbound turn only after its gateway owner task has finished.

        The platform ID is core provenance for the user row. Bound all later rows
        by the next inbound user, even if compaction has made originals inactive. Never
        infer identity from content or mark an unproved execution complete.
        """
        from .projection import visible_text
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)) as source:
            source.row_factory = sqlite3.Row
            # Read only sessions already owned by this Thread, not arbitrary DB history.
            with self._connect() as db:
                sessions = [r['session_id'] for r in db.execute(
                    'SELECT session_id FROM session_links WHERE thread_id=?', (thread_id,))]
            if not sessions:
                raise ValueError('thread has no sessions')
            marks = ','.join('?' for _ in sessions)
            anchors = source.execute(
                f"SELECT id,session_id FROM messages WHERE session_id IN ({marks}) "
                "AND role='user' AND platform_message_id=? ORDER BY id",
                [*sessions, platform_message_id]).fetchall()
            if anchors:
                with self._connect() as db:
                    linked=db.execute('SELECT t.turn_id,t.state FROM ingress_links l JOIN turns t '
                                      'ON t.turn_id=l.turn_id WHERE l.ingress_id=?',(ingress_id,)).fetchone()
                    ends=db.execute('SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? '
                                    'ORDER BY seq',(linked['turn_id'],)).fetchall() if linked else []
                if (linked and linked['state']=='complete' and len(ends)>=2 and
                        ends[0]['row_id'] in {r['id'] for r in anchors} and ends[0]['role']=='user' and
                        ends[-1]['role']=='assistant'):
                    final=source.execute('SELECT * FROM messages WHERE id=?',(ends[-1]['row_id'],)).fetchone()
                    if (final and final['session_id']==ends[-1]['session_id'] and
                            dict(final).get('finish_reason')=='stop' and
                            dict(final).get('tool_calls') in (None,'[]') and
                            visible_text(dict(final)) is not None):
                        with self._connect() as db:
                            db.execute("UPDATE turns SET state='complete' WHERE turn_id=? AND thread_id=? "
                                       "AND state='pending'",(ingress_id,thread_id))
                        self.link_user_receipt(platform_message_id,ends[0]['row_id'])
                        return
            if len(anchors) != 1:
                rows = []
            else:
                anchor = anchors[0]
                next_user = source.execute(
                    "SELECT MIN(id) FROM messages WHERE session_id=? AND role='user' "
                    'AND platform_message_id IS NOT NULL AND id>?',
                    (anchor['session_id'], anchor['id'])).fetchone()[0]
                rows, last_id = [], anchor['id'] - 1
                while True:
                    batch = source.execute(
                        'SELECT * FROM messages WHERE session_id=? AND id>? AND id<? '
                        'ORDER BY id LIMIT 128',
                        (anchor['session_id'], last_id, next_user or 9223372036854775807)).fetchall()
                    if not batch:
                        break
                    rows.extend(dict(r) for r in batch)
                    if len(rows)>4096:
                        raise OverflowError('ingress reconciliation row bound exceeded')
                    last_id = batch[-1]['id']
        visible = [r for r in rows if visible_text(r) is not None]
        refs = [(r['session_id'], r['id'], r['role']) for r in visible]
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            ingress = db.execute('SELECT state FROM turns WHERE turn_id=? AND thread_id=?',
                                 (ingress_id, thread_id)).fetchone()
            if ingress is None or ingress['state'] != 'pending':
                return
            pending = db.execute(
                "SELECT turn_id,state FROM turns WHERE thread_id=? AND state='pending' "
                "AND turn_id NOT LIKE 'ingress:%' ORDER BY rowid DESC LIMIT 1",
                (thread_id,)).fetchone()
            matched = db.execute(
                'SELECT t.turn_id,t.state FROM message_refs r JOIN turns t ON t.turn_id=r.turn_id '
                'WHERE r.thread_id=? AND r.row_id=?',
                (thread_id, refs[0][1])).fetchone() if refs else None
            linked = db.execute(
                'SELECT t.turn_id,t.state FROM ingress_links l JOIN turns t ON t.turn_id=l.turn_id '
                'WHERE l.ingress_id=?', (ingress_id,)).fetchone()
            turn = dict(linked or matched or pending) if (linked or matched or pending) else None
            if turn is None:
                turn_id = 'settled:' + ingress_id.removeprefix('ingress:')
                db.execute("INSERT INTO turns VALUES (?,?,'pending')", (turn_id, thread_id))
                turn = {'turn_id': turn_id, 'state': 'pending'}
            old = [(r['session_id'], r['row_id'], r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq',
                (turn['turn_id'],))]
            compatible = bool(refs) and refs[:len(old)] == old
            # A formal successful post hook has already committed the exact
            # original refs. Compaction can copy rows into the raw range; those
            # copies are not execution evidence and cannot revoke that proof.
            proven = bool(linked and linked['state']=='complete' and old and
                          old[0][1] == (anchors[0]['id'] if len(anchors)==1 else None) and
                          old[-1][2]=='assistant')
            # The live adapter has awaited the *actual* gateway owner. A final
            # SessionDB row with a durable normal finish reason, exact inbound
            # anchor, and no tool calls is sufficient even if the formal post
            # hook could not project this interrupted predecessor's history.
            runtime_finished = bool(owner_finished and len(anchors)==1 and compatible and
                                    visible and visible[0]['id']==anchors[0]['id'] and
                                    visible[-1]['role']=='assistant' and
                                    visible[-1]['finish_reason']=='stop' and
                                    visible[-1]['tool_calls'] in (None,'[]') and
                                    turn['state'] not in ('failed','interrupted'))
            if compatible and len(refs) > len(old):
                # Published seq values are cursor identities. Append only the
                # unobserved tail; a hook may have published an interim page.
                db.executemany('INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) '
                               'VALUES (?,?,?,?,?)', [(thread_id, turn['turn_id'], *r)
                                                    for r in refs[len(old):]])
            if not compatible and not proven:
                # Keep issued cursors valid and expose the unresolved mapping.
                db.execute("UPDATE turns SET state='unknown' WHERE turn_id=?", (turn['turn_id'],))
            elif turn['state'] == 'pending':
                db.execute("UPDATE turns SET state=? WHERE turn_id=?",
                           ('complete' if runtime_finished else 'unknown',turn['turn_id']))
            db.execute("UPDATE turns SET state='unknown' WHERE thread_id=? AND state='pending' "
                       "AND turn_id NOT LIKE 'ingress:%'", (thread_id,))
            outcome = ('complete' if proven or runtime_finished or (turn['state'] == 'complete' and compatible) else
                       turn['state'] if turn['state'] in ('failed','interrupted') and compatible else 'unknown')
            db.execute("UPDATE turns SET state=? WHERE turn_id=?",(outcome,ingress_id))
        if len(anchors)==1:
            self.link_user_receipt(platform_message_id, anchors[0]['id'])

    @staticmethod
    def _cursor(thread_id, seq):
        payload = json.dumps([thread_id, seq], separators=(',', ':')).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip('=')

    @staticmethod
    def _parse_cursor(thread_id, after):
        try:
            payload = base64.urlsafe_b64decode(after + '=' * (-len(after) % 4))
            value = json.loads(payload)
            if not (isinstance(value, list) and len(value) == 2 and value[0] == thread_id
                    and type(value[1]) is int and value[1] > 0):
                raise ValueError
            return value[1]
        except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error) as exc:
            raise ValueError('invalid cursor') from exc

    def history_page(self, thread_id, source_db, *, limit=50, after=None):
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError('limit must be 1..100')
        cursor = self._parse_cursor(thread_id, after) if after is not None else 0
        with self._connect() as db:
            if after is not None and not db.execute(
                    'SELECT 1 FROM message_refs WHERE thread_id=? AND seq=?', (thread_id, cursor)).fetchone():
                raise ValueError('invalid cursor')
            pending = [r['turn_id'] for r in db.execute(
                "SELECT turn_id FROM turns WHERE thread_id=? AND state='pending' ORDER BY rowid LIMIT 20", (thread_id,))]
            outcomes = [{'turn_id': r['turn_id'], 'state': r['state']} for r in db.execute(
                "SELECT turn_id,state FROM turns WHERE thread_id=? AND state IN ('failed','interrupted','unknown') "
                "AND turn_id NOT LIKE 'ingress:%' ORDER BY rowid LIMIT 20", (thread_id,))]
            refs = db.execute('SELECT seq,session_id,row_id,role FROM message_refs '
                              'WHERE thread_id=? AND seq>? ORDER BY seq LIMIT ?',
                              (thread_id, cursor, limit+1)).fetchall()
        page, more = refs[:limit], len(refs) > limit
        if not page:
            return {'messages': [], 'next_cursor': None, 'incomplete_turns': pending, 'turn_outcomes': outcomes}
        ids = [r['row_id'] for r in page]
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)) as source:
            source.row_factory = sqlite3.Row
            rows = {r['id']: r for r in source.execute(
                f"SELECT * FROM messages WHERE id IN ({','.join('?' for _ in ids)})", ids)}
        from .projection import visible_text
        messages = []
        for ref in page:
            row = rows.get(ref['row_id'])
            if row is None or row['session_id'] != ref['session_id'] or row['role'] != ref['role']:
                raise MissingOriginal(f"original row {ref['row_id']} unavailable")
            value = dict(row)
            value['_row_id'] = row['id']
            text = visible_text(value)
            if text is None:
                raise MissingOriginal(f"original row {ref['row_id']} is not visible")
            messages.append({'id': str(row['id']), 'ref_seq':ref['seq'],
                             'role': row['role'], 'text': text})
        return {'messages': messages, 'next_cursor': self._cursor(thread_id, page[-1]['seq']) if more else None,
                'incomplete_turns': pending, 'turn_outcomes': outcomes}

    def get_thread(self, thread_id):
        with self._connect() as db:
            row = db.execute('SELECT * FROM threads WHERE id=?', (thread_id,)).fetchone()
            return dict(row) if row else None

    def has_threads(self, project_id):
        with self._connect() as db:
            return db.execute('SELECT 1 FROM threads WHERE project_id=? LIMIT 1', (project_id,)).fetchone() is not None

    def list_threads(self, project_id, *, limit=50, after=None):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('limit must be 1..100')
        boundary = None
        if after is not None:
            try:
                payload = base64.urlsafe_b64decode(after + '=' * (-len(after) % 4))
                value = json.loads(payload)
                if not (isinstance(value, list) and len(value) == 3 and value[0] == project_id
                        and type(value[1]) is int and isinstance(value[2], str)):
                    raise ValueError
                boundary = (value[1], value[2])
            except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error) as exc:
                raise ValueError('invalid cursor') from exc
        with self._connect() as db:
            if boundary and not db.execute(
                    'SELECT 1 FROM threads WHERE project_id=? AND created_at=? AND id=?',
                    (project_id, *boundary)).fetchone():
                raise ValueError('invalid cursor')
            rows = [dict(r) for r in db.execute(
                'SELECT id,project_id,title,archived,created_at FROM threads WHERE project_id=? '
                'AND (created_at,id) > (?,?) ORDER BY created_at,id LIMIT ?',
                (project_id, *(boundary or (0, '')), limit + 1))]
        page, more = rows[:limit], len(rows) > limit
        next_cursor = None
        if more:
            last = page[-1]
            raw = json.dumps([project_id, last['created_at'], last['id']], separators=(',', ':')).encode()
            next_cursor = base64.urlsafe_b64encode(raw).decode().rstrip('=')
        return {'threads': page, 'next_cursor': next_cursor}

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
            if db.total_changes:
                version=db.execute("SELECT COALESCE(MAX(version),0)+1 FROM sync_events "
                                   "WHERE kind='thread' AND ref=?",(thread_id,)).fetchone()[0]
                self._event(db,'thread',thread_id,thread_id,version)
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
