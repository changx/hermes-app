"""Plugin-owned metadata; receipt bodies are durable PLATFORM input originals.

Pinned to Hermes 2f16a1aa5a35feec496949abdef7ad51aea0e7ef. A thread's
root session is a user-created session; compression descendants never receive
another Channel Description, including after prompt rebuild or cold restore.
"""
import secrets
import sqlite3
import base64
import json
import hashlib
import math
import stat
from contextlib import contextmanager, closing, nullcontext
from pathlib import Path


class MissingOriginal(Exception):
    pass


class HistoryPending(Exception):
    pass


def _message_time(value):
    """Project only a finite, JS-representable UNIX-second source timestamp."""
    if type(value) in (int, float) and 0 <= value <= 8.64e12 and math.isfinite(value):
        return {'created_at': value}
    return {}


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
                CREATE TABLE IF NOT EXISTS continuation_anchors (
                    turn_id TEXT PRIMARY KEY REFERENCES turns(turn_id),
                    session_id TEXT NOT NULL, row_id INTEGER NOT NULL UNIQUE);
                CREATE TABLE IF NOT EXISTS ingress_links (
                    ingress_id TEXT PRIMARY KEY REFERENCES turns(turn_id),
                    turn_id TEXT NOT NULL UNIQUE REFERENCES turns(turn_id));
                CREATE TABLE IF NOT EXISTS message_refs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL REFERENCES threads(id),
                    turn_id TEXT NOT NULL REFERENCES turns(turn_id),
                    session_id TEXT NOT NULL, row_id INTEGER UNIQUE,
                    input_receipt_id TEXT UNIQUE REFERENCES receipts(id),
                    direct_message_id TEXT UNIQUE REFERENCES direct_messages(id),
                    system_notice_id TEXT UNIQUE REFERENCES system_notices(id),
                    role TEXT NOT NULL,
                    CHECK ((direct_message_id IS NULL AND system_notice_id IS NULL
                            AND (row_id IS NOT NULL OR input_receipt_id IS NOT NULL))
                           OR (direct_message_id IS NOT NULL AND system_notice_id IS NULL
                               AND row_id IS NULL AND input_receipt_id IS NULL AND role = 'assistant')
                           OR (system_notice_id IS NOT NULL AND direct_message_id IS NULL
                               AND row_id IS NULL AND input_receipt_id IS NULL AND role = 'system')));
                CREATE INDEX IF NOT EXISTS refs_page ON message_refs(thread_id, seq);
                CREATE TABLE IF NOT EXISTS receipts (
                    id TEXT PRIMARY KEY, client_message_id TEXT NOT NULL UNIQUE,
                    thread_id TEXT NOT NULL REFERENCES threads(id),
                    payload_hash TEXT NOT NULL, pending_text TEXT,
                    state TEXT NOT NULL, user_row_id INTEGER,
                    admission TEXT NOT NULL DEFAULT 'owner',
                    event_version INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()));
                CREATE INDEX IF NOT EXISTS receipt_queue ON receipts(thread_id,state,created_at);
                CREATE TABLE IF NOT EXISTS direct_messages (
                    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
                    receipt_id TEXT NOT NULL REFERENCES receipts(id), text TEXT NOT NULL,
                    attachment_id TEXT REFERENCES attachments(id),
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()));
                CREATE INDEX IF NOT EXISTS direct_messages_receipt ON direct_messages(receipt_id);
                CREATE TABLE IF NOT EXISTS system_notices (
                    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
                    kind TEXT NOT NULL CHECK (kind IN ('review','compression')),
                    state TEXT NOT NULL CHECK (state IN ('pending','active','complete')),
                    text TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
                CREATE INDEX IF NOT EXISTS system_notices_active
                    ON system_notices(thread_id,kind,state,created_at);
                CREATE TABLE IF NOT EXISTS core_ref_snapshots (
                    row_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sync_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
                    thread_id TEXT NOT NULL, ref TEXT NOT NULL, version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS read_positions (
                    thread_id TEXT PRIMARY KEY REFERENCES threads(id), ref_seq INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS channel_versions (
                    id TEXT PRIMARY KEY, digest TEXT NOT NULL, version INTEGER NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS interactions (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, thread_id TEXT NOT NULL,
                    receipt_id TEXT NOT NULL, generation TEXT NOT NULL,
                    prompt TEXT NOT NULL, choices TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending');
                CREATE INDEX IF NOT EXISTS interactions_thread ON interactions(thread_id,state);
                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
                    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
                    receipt_id TEXT REFERENCES receipts(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()));
                CREATE INDEX IF NOT EXISTS attachments_receipt ON attachments(receipt_id);
                CREATE TABLE IF NOT EXISTS deliveries (
                    execution_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
                    row_id INTEGER NOT NULL UNIQUE, ref_seq INTEGER NOT NULL);
                CREATE TRIGGER IF NOT EXISTS published_ref AFTER INSERT ON message_refs BEGIN
                    INSERT INTO sync_events(kind,thread_id,ref,version)
                    VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1);
                END;
            ''')
            if not any(r['name'] == 'admission' for r in db.execute('PRAGMA table_info(receipts)')):
                db.execute("ALTER TABLE receipts ADD COLUMN admission TEXT NOT NULL DEFAULT 'owner'")
            if not any(r['name'] == 'handed_off' for r in db.execute('PRAGMA table_info(receipts)')):
                db.execute('ALTER TABLE receipts ADD COLUMN handed_off INTEGER NOT NULL DEFAULT 0')
            if not any(r['name'] == 'processing' for r in db.execute('PRAGMA table_info(receipts)')):
                db.execute('ALTER TABLE receipts ADD COLUMN processing TEXT')
            if not any(r['name'] == 'feedback' for r in db.execute('PRAGMA table_info(receipts)')):
                db.execute('ALTER TABLE receipts ADD COLUMN feedback TEXT')
            if not any(r['name'] == 'event_version' for r in db.execute('PRAGMA table_info(receipts)')):
                # Older releases reused receipt version 3 for processing completion
                # and settlement. Seed from the log, then republish current state so
                # already-connected clients can converge after upgrading.
                db.execute('ALTER TABLE receipts ADD COLUMN event_version INTEGER NOT NULL DEFAULT 0')
                db.execute("UPDATE receipts SET event_version=COALESCE((SELECT MAX(version) "
                           "FROM sync_events WHERE kind='receipt' AND thread_id=receipts.thread_id "
                           "AND ref=receipts.id),0)")
                for receipt in db.execute('SELECT id,thread_id FROM receipts').fetchall():
                    self._receipt_event(db, receipt['thread_id'], receipt['id'])
            if not any(r['name'] == 'attachment_id' for r in db.execute('PRAGMA table_info(direct_messages)')):
                db.execute('ALTER TABLE direct_messages ADD COLUMN attachment_id TEXT REFERENCES attachments(id)')
            ref_sql=db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='message_refs'").fetchone()[0]
            if ('system_notice_id' not in ref_sql or 'direct_message_id' not in ref_sql or
                    'CHECK ((row_id IS NULL) != (input_receipt_id IS NULL))' in ref_sql):
                # Rebuild only the ref table. Keep issued seq identities, event log,
                # read positions, and the original insert trigger semantics intact.
                db.execute('BEGIN IMMEDIATE')
                db.execute('DROP TRIGGER published_ref')
                db.execute('CREATE TABLE message_refs_new (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                           'thread_id TEXT NOT NULL REFERENCES threads(id), '
                           'turn_id TEXT NOT NULL REFERENCES turns(turn_id), '
                           'session_id TEXT NOT NULL, row_id INTEGER UNIQUE, '
                           'input_receipt_id TEXT UNIQUE REFERENCES receipts(id), '
                           'direct_message_id TEXT UNIQUE REFERENCES direct_messages(id), '
                           'system_notice_id TEXT UNIQUE REFERENCES system_notices(id), role TEXT NOT NULL, '
                           'CHECK ((direct_message_id IS NULL AND system_notice_id IS NULL '
                           'AND (row_id IS NOT NULL OR input_receipt_id IS NOT NULL)) '
                           "OR (direct_message_id IS NOT NULL AND system_notice_id IS NULL "
                           "AND row_id IS NULL AND input_receipt_id IS NULL AND role = 'assistant') "
                           "OR (system_notice_id IS NOT NULL AND direct_message_id IS NULL "
                           "AND row_id IS NULL AND input_receipt_id IS NULL AND role = 'system')))" )
                receipt_expr = 'input_receipt_id' if 'input_receipt_id' in ref_sql else 'NULL'
                direct_expr = 'direct_message_id' if 'direct_message_id' in ref_sql else 'NULL'
                notice_expr = 'system_notice_id' if 'system_notice_id' in ref_sql else 'NULL'
                db.execute('INSERT INTO message_refs_new(seq,thread_id,turn_id,session_id,row_id,'
                           'input_receipt_id,direct_message_id,system_notice_id,role) '
                           f'SELECT seq,thread_id,turn_id,session_id,row_id,{receipt_expr},'
                           f'{direct_expr},{notice_expr},role FROM message_refs')
                db.execute('DROP TABLE message_refs')
                db.execute('ALTER TABLE message_refs_new RENAME TO message_refs')
                db.execute('CREATE INDEX refs_page ON message_refs(thread_id,seq)')
                db.execute("CREATE TRIGGER published_ref AFTER INSERT ON message_refs BEGIN "
                           "INSERT INTO sync_events(kind,thread_id,ref,version) "
                           "VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1); END")

    def create_direct_message(self, thread_id, receipt_id, text, *, message_id=None) -> str:
        """Publish a native direct reply without writing to the model transcript."""
        if not isinstance(text, str):
            raise ValueError('invalid direct message text')
        if message_id is not None and (not isinstance(message_id, str) or
                not message_id.startswith('dm_') or len(message_id) > 128 or
                not all(c.isascii() and (c.isalnum() or c in '-_') for c in message_id)):
            raise ValueError('invalid direct message id')
        message_id = message_id or 'dm_' + secrets.token_hex(16)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT thread_id,receipt_id,text FROM direct_messages WHERE id=?',
                               (message_id,)).fetchone()
            if prior:
                if (prior['thread_id'],prior['receipt_id'],prior['text']) != (thread_id,receipt_id,text):
                    raise ValueError('direct message id conflict')
                return message_id
            owner = db.execute('SELECT r.thread_id,t.session_id FROM receipts r '
                               'JOIN threads t ON t.id=r.thread_id WHERE r.id=?', (receipt_id,)).fetchone()
            if not owner or owner['thread_id'] != thread_id or not db.execute(
                    'SELECT 1 FROM message_refs WHERE thread_id=? AND input_receipt_id=?',
                    (thread_id,receipt_id)).fetchone():
                raise ValueError('direct message requires an accepted input in this thread')
            db.execute('INSERT INTO direct_messages(id,thread_id,receipt_id,text) VALUES (?,?,?,?)',
                       (message_id,thread_id,receipt_id,text))
            db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,direct_message_id,role) '
                       "VALUES (?,?,?,?,'assistant')",
                       (thread_id,'input:'+receipt_id,owner['session_id'],message_id))
        return message_id

    @staticmethod
    def _validate_notice_text(text):
        if not isinstance(text, str) or not text.strip() or len(text) > 12000:
            raise ValueError('invalid system notice text')

    @staticmethod
    def _insert_system_notice(db, thread_id, kind, state, text):
        owner = db.execute('SELECT session_id FROM threads WHERE id=?', (thread_id,)).fetchone()
        if not owner or not owner['session_id']:
            raise ValueError('system notice requires an initialized thread')
        notice_id = 'notice_' + secrets.token_hex(16)
        turn_id = 'notice:' + notice_id
        db.execute("INSERT INTO turns(turn_id,thread_id,state) VALUES (?,?,'complete')",
                   (turn_id,thread_id))
        db.execute('INSERT INTO system_notices(id,thread_id,kind,state,text) VALUES (?,?,?,?,?)',
                   (notice_id,thread_id,kind,state,text))
        db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,system_notice_id,role) '
                   "VALUES (?,?,?,?,'system')",
                   (thread_id,turn_id,owner['session_id'],notice_id))
        return notice_id

    def create_system_notice(self, thread_id, kind, text) -> str:
        """Publish one completed plugin-owned notice in the visible Thread history."""
        self._validate_notice_text(text)
        if kind not in ('review','compression'):
            raise ValueError('invalid system notice kind')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            return self._insert_system_notice(db,thread_id,kind,'complete',text)

    def upsert_compression_notice(self, thread_id, text, *, phase='pending'):
        """Create one compression attempt row or update its stable visible identity."""
        self._validate_notice_text(text)
        if phase not in ('pending','active','complete'):
            raise ValueError('invalid compression notice state')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            active = db.execute(
                "SELECT n.id,n.state,n.text,r.seq FROM system_notices n "
                "JOIN message_refs r ON r.system_notice_id=n.id AND r.thread_id=n.thread_id "
                "WHERE n.thread_id=? AND n.kind='compression' AND n.state IN ('pending','active') "
                'ORDER BY r.seq DESC LIMIT 1', (thread_id,)).fetchone()
            # The exact core start edge defines a new attempt. A preceding
            # preflight line is part of that attempt; an already-started row is
            # an orphan from a failed attempt and must never absorb the retry.
            if phase == 'active' and active and active['state'] == 'active':
                db.execute("UPDATE system_notices SET state='complete',updated_at=unixepoch() WHERE id=?",
                           (active['id'],))
                active = None
            if active:
                state = phase if phase != 'pending' else active['state']
                if active['text'] == text and state == active['state']:
                    return active['id'], False
                db.execute('UPDATE system_notices SET text=?,state=?,updated_at=unixepoch() WHERE id=?',
                           (text,state,active['id']))
                version = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM sync_events "
                                     "WHERE kind='message' AND thread_id=? AND ref=?",
                                     (thread_id,str(active['seq']))).fetchone()[0]
                self._event(db,'message',thread_id,str(active['seq']),version)
                return active['id'], True
            notice_id = self._insert_system_notice(
                db,thread_id,'compression',phase,text)
            return notice_id, True

    def create_direct_document(self, thread_id, receipt_id, attachment_id, name, mime, size, caption):
        """Atomically publish an outbound document and its display-only reference."""
        message_id = 'dm_' + secrets.token_hex(16)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            owner = db.execute('SELECT r.thread_id,t.session_id FROM receipts r '
                               'JOIN threads t ON t.id=r.thread_id WHERE r.id=?', (receipt_id,)).fetchone()
            if not owner or owner['thread_id'] != thread_id or not db.execute(
                    'SELECT 1 FROM message_refs WHERE thread_id=? AND input_receipt_id=?',
                    (thread_id, receipt_id)).fetchone():
                raise ValueError('document requires an accepted input in this thread')
            db.execute('INSERT INTO attachments(id,thread_id,name,mime,size,receipt_id) '
                       'VALUES (?,?,?,?,?,?)', (attachment_id,thread_id,name,mime,size,receipt_id))
            db.execute('INSERT INTO direct_messages(id,thread_id,receipt_id,text,attachment_id) '
                       'VALUES (?,?,?,?,?)', (message_id,thread_id,receipt_id,caption,attachment_id))
            db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,direct_message_id,role) '
                       "VALUES (?,?,?,?,'assistant')",
                       (thread_id,'input:'+receipt_id,owner['session_id'],message_id))
            self._event(db,'attachment',thread_id,attachment_id)
        return message_id

    def snapshot_rewound_refs(self, thread_id, session_id, source_db):
        """Keep published display rows before native /retry rewrites its session."""
        from .projection import visible_text
        from .tool_timeline import public_tool_calls
        with self._connect() as db:
            refs = db.execute('SELECT row_id,session_id,role FROM message_refs WHERE thread_id=? '
                              'AND session_id=? AND row_id IS NOT NULL ORDER BY seq',
                              (thread_id,session_id)).fetchall()
            if not refs:
                return
            with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)) as source:
                source.row_factory = sqlite3.Row
                db.execute('BEGIN IMMEDIATE')
                for ref in refs:
                    if db.execute('SELECT 1 FROM core_ref_snapshots WHERE row_id=?',
                                  (ref['row_id'],)).fetchone():
                        continue
                    row = source.execute('SELECT * FROM messages WHERE id=? AND session_id=? AND role=?',
                                         (ref['row_id'],ref['session_id'],ref['role'])).fetchone()
                    if row is None or visible_text(dict(row)) is None:
                        raise MissingOriginal('cannot preserve rewound original')
                    payload = {'id':row['id'], 'session_id':row['session_id'],
                        'role':row['role'], 'display_kind':row['display_kind'],
                        'platform_message_id':row['platform_message_id'],
                        'timestamp':row['timestamp'],
                        'snapshot_text':visible_text(dict(row)),
                        'snapshot_tool_calls':public_tool_calls(dict(row)) if row['role']=='assistant' else [],
                        # Origin envelopes are needed only for exact generated
                        # follow-up suppression, not for model replay.
                        'content':row['content'] if row['role']=='user' else None}
                    db.execute('INSERT INTO core_ref_snapshots(row_id,payload) VALUES (?,?)',
                               (ref['row_id'],json.dumps(payload,ensure_ascii=False)))

    def update_direct_message(self, thread_id, message_id, text) -> bool:
        if not isinstance(text, str):
            raise ValueError('invalid direct message text')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT m.text,r.seq FROM direct_messages m '
                             'JOIN message_refs r ON r.direct_message_id=m.id AND r.thread_id=m.thread_id '
                             'WHERE m.id=? AND m.thread_id=?', (message_id,thread_id)).fetchone()
            if not row:
                return False
            if row['text'] == text:
                return True
            db.execute('UPDATE direct_messages SET text=? WHERE id=?',(text,message_id))
            version = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM sync_events "
                                 "WHERE kind='message' AND thread_id=? AND ref=?",
                                 (thread_id,str(row['seq']))).fetchone()[0]
            self._event(db,'message',thread_id,str(row['seq']),version)
            return True

    def direct_message_thread(self, message_id):
        with self._connect() as db:
            row=db.execute('SELECT m.thread_id,t.project_id FROM direct_messages m '
                           'JOIN threads t ON t.id=m.thread_id WHERE m.id=?', (message_id,)).fetchone()
            return dict(row) if row else None

    def direct_receipt_has_output(self, receipt_id) -> bool:
        with self._connect() as db:
            return db.execute('SELECT 1 FROM direct_messages WHERE receipt_id=? LIMIT 1',
                              (receipt_id,)).fetchone() is not None

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

    def _receipt_event(self, db, thread_id, receipt_id):
        """Publish a strictly newer version for every receipt representation change."""
        changed = db.execute('UPDATE receipts SET event_version=event_version+1 '
                             'WHERE id=? AND thread_id=?', (receipt_id, thread_id)).rowcount
        if changed != 1:
            raise ValueError('unknown receipt event owner')
        version = db.execute('SELECT event_version FROM receipts WHERE id=?',
                             (receipt_id,)).fetchone()['event_version']
        self._event(db, 'receipt', thread_id, receipt_id, version)

    def accept(self, thread_id, client_message_id, text, attachment_ids=()):
        if not isinstance(client_message_id, str) or not 1 <= len(client_message_id) <= 128 or not all(
                c.isascii() and (c.isalnum() or c in '-_.:') for c in client_message_id):
            raise ValueError('invalid client_message_id')
        if not isinstance(text, str) or (not text.strip() and not attachment_ids) or len(text.encode()) > 16000:
            raise ValueError('invalid text')
        if not isinstance(attachment_ids, (list, tuple)) or len(attachment_ids) > 8 or any(
                not isinstance(item, str) or not item.startswith('att_') for item in attachment_ids):
            raise ValueError('invalid attachments')
        if len(set(attachment_ids)) != len(attachment_ids):
            raise ValueError('duplicate attachment')
        digest = hashlib.sha256(text.encode() if not attachment_ids else
            json.dumps([text,list(attachment_ids)],ensure_ascii=False).encode()).hexdigest()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM receipts WHERE client_message_id=?', (client_message_id,)).fetchone()
            if row:
                if row['thread_id'] != thread_id or row['payload_hash'] != digest:
                    raise ValueError('client_message_id conflict')
                return self._receipt(db,row), False
            thread = db.execute('SELECT archived,session_id FROM threads WHERE id=?', (thread_id,)).fetchone()
            if thread is None:
                raise ValueError('unknown thread')
            if thread['archived']:
                raise ValueError('thread archived')
            pending = db.execute("SELECT COUNT(*) FROM receipts WHERE thread_id=? AND state IN ('queued','running')",
                                 (thread_id,)).fetchone()[0]
            if pending >= 32:
                raise OverflowError('thread queue full')
            for attachment_id in attachment_ids:
                attachment = db.execute('SELECT thread_id,receipt_id FROM attachments WHERE id=?',
                                        (attachment_id,)).fetchone()
                if not attachment or attachment['thread_id'] != thread_id or attachment['receipt_id']:
                    raise ValueError('attachment unavailable')
            receipt_id = 'rc_' + secrets.token_hex(16)
            db.execute("INSERT INTO receipts(id,client_message_id,thread_id,payload_hash,pending_text,state) "
                       "VALUES (?,?,?,?,?,'queued')", (receipt_id,client_message_id,thread_id,digest,text))
            for attachment_id in attachment_ids:
                db.execute('UPDATE attachments SET receipt_id=? WHERE id=?', (receipt_id,attachment_id))
            # Display order is fixed at acceptance, independent of core context.
            turn_id='input:'+receipt_id
            db.execute("INSERT INTO turns VALUES (?,?,'input')",(turn_id,thread_id))
            db.execute("INSERT INTO message_refs(thread_id,turn_id,session_id,input_receipt_id,role) "
                       "VALUES (?,?,?,?,'user')",(thread_id,turn_id,thread['session_id'],receipt_id))
            self._receipt_event(db, thread_id, receipt_id)
            row = db.execute('SELECT * FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            return self._receipt(db,row), True

    @staticmethod
    def _receipt(db, row):
        # Read an already published USER position; never allocate a ref or
        # borrow the position of an assistant reply / another receipt.
        ref=db.execute("SELECT seq FROM message_refs WHERE thread_id=? AND role='user' "
                       'AND input_receipt_id=?', (row['thread_id'],row['id'])).fetchone()
        if (ref is None and 'user_row_id' in row.keys() and row['user_row_id'] is not None
                and not db.execute('SELECT 1 FROM receipts WHERE id!=? AND user_row_id=? LIMIT 1',
                                   (row['id'],row['user_row_id'])).fetchone()):
            ref=db.execute("SELECT seq FROM message_refs WHERE thread_id=? AND role='user' "
                           'AND row_id=? AND (input_receipt_id IS NULL OR input_receipt_id=?)',
                           (row['thread_id'],row['user_row_id'],row['id'])).fetchone()
        return {'id':row['id'], 'client_message_id':row['client_message_id'],
                'thread_id':row['thread_id'], 'state':row['state'], 'durable':True,
                'processing':row['processing'],
                **({'ref_seq':ref['seq']} if ref else {}),
                **({'feedback':row['feedback']} if row['feedback'] else {}),
                **({'admission':'followup'} if row['admission']=='followup' else {}),
                **({'handed_off':True} if row['handed_off'] else {})}

    def receipt(self, receipt_id):
        with self._connect() as db:
            row = db.execute('SELECT * FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            return self._receipt(db,row) if row else None

    def record_processing(self, receipt_id, thread_id, state):
        """Persist actual platform lifecycle callbacks, not history inference."""
        if state not in ('running','completed','failed','interrupted'):
            raise ValueError('invalid processing outcome')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT processing FROM receipts WHERE id=? AND thread_id=?',
                             (receipt_id,thread_id)).fetchone()
            if not row or row['processing'] == state or row['processing'] in ('completed','failed','interrupted'):
                return
            db.execute('UPDATE receipts SET processing=? WHERE id=?',(state,receipt_id))
            self._receipt_event(db, thread_id, receipt_id)

    def record_feedback(self, receipt_id, thread_id, text):
        """The native busy ACK is admission feedback, never completion evidence."""
        if not isinstance(text, str) or not 1 <= len(text) <= 2000:
            raise ValueError('invalid feedback')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute("UPDATE receipts SET feedback=? WHERE id=? AND thread_id=? "
                                 "AND admission='followup' AND feedback IS NULL",
                                 (text,receipt_id,thread_id)).rowcount
            if changed:
                self._receipt_event(db, thread_id, receipt_id)
            return bool(changed)

    def reconcile_channels(self, channels):
        """Durable ProjectDB invalidations; no channel body is duplicated here."""
        digests = {channel['id']: hashlib.sha256(json.dumps(
            channel, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
                   for channel in channels}
        changed = False
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = {row['id']: row for row in db.execute('SELECT * FROM channel_versions')}
            for channel_id, digest in digests.items():
                old = previous.get(channel_id)
                if old is not None and old['digest'] == digest and not old['deleted']:
                    continue
                version = old['version'] + 1 if old else 1
                db.execute('INSERT INTO channel_versions(id,digest,version,deleted) VALUES (?,?,?,0) '
                           'ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,version=excluded.version,deleted=0',
                           (channel_id, digest, version))
                self._event(db, 'channel', '', channel_id, version)
                changed = True
            for channel_id, old in previous.items():
                if channel_id not in digests and not old['deleted']:
                    version = old['version'] + 1
                    db.execute('UPDATE channel_versions SET deleted=1,version=? WHERE id=?',
                               (version, channel_id))
                    self._event(db, 'channel', '', channel_id, version)
                    changed = True
        return changed

    def recover_receipts(self, source_db=None):
        if source_db and Path(source_db).exists():
            with self._connect() as db:
                running=[dict(r) for r in db.execute("SELECT id,thread_id FROM receipts WHERE state='running' AND admission='owner'")]
            for receipt in running:
                self._recover_visible_result(receipt['id'],receipt['thread_id'],source_db)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute("SELECT id,thread_id FROM receipts WHERE processing='running'").fetchall():
                db.execute("UPDATE receipts SET processing='unknown' WHERE id=?", (row['id'],))
                self._receipt_event(db, row['thread_id'], row['id'])
            for row in db.execute("SELECT id,thread_id FROM receipts WHERE state='running'").fetchall():
                db.execute("UPDATE receipts SET state='unknown' WHERE id=?", (row['id'],))
                db.execute("UPDATE turns SET state='unknown' WHERE turn_id=? AND state='pending'",
                           ('ingress:'+row['id'],))
                linked=db.execute('SELECT turn_id FROM ingress_links WHERE ingress_id=?',('ingress:'+row['id'],)).fetchone()
                if linked:
                    db.execute("UPDATE turns SET state='unknown' WHERE turn_id=? AND state='pending'",(linked[0],))
                self._receipt_event(db, row['thread_id'], row['id'])
            return [r[0] for r in db.execute("SELECT DISTINCT thread_id FROM receipts WHERE state='queued'")]

    def _recover_visible_result(self, receipt_id, thread_id, source_db):
        """Publish exact core rows after a crash, retaining uncertain execution state."""
        from .projection import visible_text
        self.link_user_from_core(receipt_id,source_db)
        with self._connect() as db:
            sessions = [r['session_id'] for r in db.execute(
                'SELECT session_id FROM session_links WHERE thread_id=?', (thread_id,))]
            linked = db.execute('SELECT turn_id FROM ingress_links WHERE ingress_id=?',
                                ('ingress:' + receipt_id,)).fetchone()
            turn_id = linked['turn_id'] if linked else 'settled:' + receipt_id
            old = [(r['session_id'], r['row_id'], r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq',
                (turn_id,))]
            receipt = db.execute('SELECT user_row_id FROM receipts WHERE id=? AND thread_id=?',
                                 (receipt_id, thread_id)).fetchone()
        if not sessions or receipt is None:
            return
        marks = ','.join('?' for _ in sessions)
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
            source.row_factory=sqlite3.Row
            anchors=source.execute(
                f"SELECT * FROM messages WHERE session_id IN ({marks}) AND role='user' "
                'AND platform_message_id=? ORDER BY id', [*sessions, receipt_id]).fetchall()
            if not anchors:
                return
            anchor = next((r for r in anchors if old and r['id'] == old[0][1] and
                           r['session_id'] == old[0][0]), None)
            if anchor is None and receipt['user_row_id'] is not None:
                anchor = next((r for r in anchors if r['id'] == receipt['user_row_id']), None)
            anchor = anchor or anchors[0]
            if old and old[0] != (anchor['session_id'], anchor['id'], 'user'):
                return
            next_user=source.execute(
                f"SELECT MIN(id) FROM messages WHERE session_id IN ({marks}) AND role='user' "
                'AND platform_message_id IS NOT NULL AND platform_message_id!=? AND id>?',
                [*sessions, receipt_id, anchor['id']]).fetchone()[0] or 9223372036854775807
            last = old[-1][1] if old else anchor['id']
            final=source.execute(
                f"SELECT * FROM messages WHERE session_id IN ({marks}) AND role='assistant' "
                "AND id>? AND id<? AND finish_reason='stop' "
                "AND (tool_calls IS NULL OR tool_calls='[]') ORDER BY id DESC LIMIT 1",
                [*sessions, last, next_user]).fetchone()
            initial=[]
            if not old:
                first_copy = next((r['id'] for r in anchors if r['id'] > anchor['id']), next_user)
                initial = source.execute(
                    f"SELECT * FROM messages WHERE session_id IN ({marks}) AND id>? AND id<? "
                    "AND role='assistant' ORDER BY id LIMIT 4097",
                    [*sessions, anchor['id'], min(first_copy, next_user)]).fetchall()
                if len(initial)>4096:
                    raise OverflowError('recovery row bound exceeded')
        if visible_text(dict(anchor)) is None:
            return
        refs = ([] if old else [(anchor['session_id'], anchor['id'], 'user')])
        refs.extend((r['session_id'], r['id'], 'assistant') for r in initial
                    if visible_text(dict(r)) is not None)
        if final and visible_text(dict(final)) is not None and final['id'] > (refs[-1][1] if refs else last):
            refs.append((final['session_id'], final['id'], 'assistant'))
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("INSERT OR IGNORE INTO turns VALUES (?,?,'pending')",(turn_id,thread_id))
            for session_id, row_id, role in refs:
                self._insert_core_ref(db,thread_id,turn_id,session_id,row_id,role)
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
            self._receipt_event(db, thread_id, row['id'])
            return row['id'],row['pending_text']

    def claim_busy_text(self, thread_id):
        """Claim the FIFO head before Gateway admission, without stealing the owner."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            owner=db.execute("SELECT 1 FROM receipts WHERE thread_id=? AND state='running' "
                             "AND admission='owner'",(thread_id,)).fetchone()
            if not owner:
                return None
            row=db.execute("SELECT id,pending_text FROM receipts WHERE thread_id=? AND state='queued' "
                           "ORDER BY created_at,rowid LIMIT 1",(thread_id,)).fetchone()
            if not row or db.execute('SELECT 1 FROM attachments WHERE receipt_id=? LIMIT 1',
                                     (row['id'],)).fetchone():
                return None  # Do not bypass an older attachment or steer media.
            db.execute("UPDATE receipts SET state='running',admission='followup' WHERE id=?",(row['id'],))
            session=db.execute('SELECT session_id FROM threads WHERE id=?',(thread_id,)).fetchone()['session_id']
            turn_id='input:'+row['id']
            db.execute("INSERT OR IGNORE INTO turns VALUES (?,?,'input')",(turn_id,thread_id))
            db.execute("INSERT OR IGNORE INTO message_refs(thread_id,turn_id,session_id,input_receipt_id,role) "
                       "VALUES (?,?,?,?,'user')",(thread_id,turn_id,session,row['id']))
            self._receipt_event(db, thread_id, row['id'])
            return row['id'],row['pending_text']

    def followup_core_outcome(self, receipt_id, source_db):
        """Only an exact native user anchor and a completed formal turn prove a normal fallback."""
        if not self.link_user_from_core(receipt_id,source_db):
            return None
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            receipt=db.execute('SELECT thread_id,admission FROM receipts WHERE id=?',(receipt_id,)).fetchone()
            if receipt and receipt['admission']=='followup':
                # Exact platform_message_id means Gateway made a normal user
                # turn (native FIFO/idle race), not a consumed steer.
                db.execute("UPDATE receipts SET admission='owner' WHERE id=?",(receipt_id,))
                self._receipt_event(db, receipt['thread_id'], receipt_id)
            row=db.execute('SELECT t.state,t.turn_id FROM receipts c JOIN message_refs r ON r.row_id=c.user_row_id '
                           'JOIN turns t ON t.turn_id=r.turn_id WHERE c.id=? AND r.role=\'user\'',
                           (receipt_id,)).fetchone()
            final=db.execute("SELECT row_id,session_id FROM message_refs WHERE turn_id=? AND role='assistant' "
                             'ORDER BY seq DESC LIMIT 1',(row['turn_id'],)).fetchone() if row else None
        if row and row['state'] in ('failed','interrupted','unknown'):
            return row['state']
        if row and row['state']=='complete' and final:
            with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as core:
                result=core.execute("SELECT 1 FROM messages WHERE id=? AND session_id=? AND role='assistant' "
                                    "AND finish_reason='stop' AND (tool_calls IS NULL OR tool_calls='[]')",
                                    (final['row_id'],final['session_id'])).fetchone()
            if result:
                return 'completed'
        # The exact normal user row exists, but a matching final is not proven.
        # Do not turn its failed/interrupted/incomplete owner into a received steer.
        return 'anchored'

    def mark_handed_off(self, receipt_id):
        """Record successful Gateway handoff without changing execution state."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT thread_id FROM receipts WHERE id=? AND admission='followup' "
                             'AND handed_off=0', (receipt_id,)).fetchone()
            if row:
                db.execute('UPDATE receipts SET handed_off=1 WHERE id=?', (receipt_id,))
                self._receipt_event(db, row['thread_id'], receipt_id)

    def finish_receipt(self, receipt_id, state):
        if state not in ('received','completed','failed','interrupted','unknown'):
            raise ValueError('invalid receipt outcome')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT thread_id,state FROM receipts WHERE id=?', (receipt_id,)).fetchone()
            if not row or row['state'] != 'running':
                return
            # The accepted input is already visible even without a core row.
            db.execute('UPDATE receipts SET state=? WHERE id=?', (state,receipt_id))
            self._receipt_event(db, row['thread_id'], receipt_id)

    def finish_direct_receipt(self, receipt_id, state) -> bool:
        """Settle only a direct-only ingress, never an ACK for model work."""
        if state not in ('completed','failed','interrupted'):
            raise ValueError('invalid direct receipt outcome')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            receipt=db.execute('SELECT thread_id,state,user_row_id FROM receipts WHERE id=?',
                               (receipt_id,)).fetchone()
            if not receipt or receipt['state']!='running' or receipt['user_row_id'] is not None:
                return False
            ingress='ingress:'+receipt_id
            turn=db.execute('SELECT state FROM turns WHERE turn_id=? AND thread_id=?',
                            (ingress,receipt['thread_id'])).fetchone()
            if (turn and turn['state']!='pending') or db.execute(
                    'SELECT 1 FROM ingress_links WHERE ingress_id=?', (ingress,)).fetchone() or db.execute(
                    'SELECT 1 FROM message_refs WHERE input_receipt_id=? AND row_id IS NOT NULL',
                    (receipt_id,)).fetchone() or not db.execute(
                    'SELECT 1 FROM direct_messages WHERE receipt_id=? AND thread_id=? LIMIT 1',
                    (receipt_id,receipt['thread_id'])).fetchone():
                return False
            db.execute('UPDATE receipts SET state=? WHERE id=?',(state,receipt_id))
            if turn:
                db.execute('UPDATE turns SET state=? WHERE turn_id=? AND thread_id=?',
                           ('complete' if state=='completed' else state,ingress,receipt['thread_id']))
            self._receipt_event(db, receipt['thread_id'], receipt_id)
            return True

    def finish_unanchored_model_receipt(self, receipt_id, turn_id, state) -> bool:
        """Settle a native command whose inner model event has no platform ID."""
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT r.thread_id,r.state,r.user_row_id,t.state AS turn_state '
                           'FROM receipts r JOIN ingress_links l ON l.ingress_id=? '
                           'JOIN turns t ON t.turn_id=l.turn_id AND t.thread_id=r.thread_id '
                           'WHERE r.id=? AND l.turn_id=?', ('ingress:'+receipt_id,receipt_id,turn_id)).fetchone()
            if not row or row['state']!='running' or row['user_row_id'] is not None:
                return False
            if state=='completed' and row['turn_state']!='complete':
                return False
            if state!='completed' and row['turn_state'] not in ('failed','interrupted'):
                return False
            db.execute('UPDATE receipts SET state=? WHERE id=?',(state,receipt_id))
            db.execute('UPDATE turns SET state=? WHERE turn_id=? AND thread_id=? AND state=\'pending\'',
                       ('complete' if state=='completed' else state,'ingress:'+receipt_id,row['thread_id']))
            self._receipt_event(db, row['thread_id'], receipt_id)
            return True

    def cancel_queued(self, thread_id, receipt_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed=db.execute("UPDATE receipts SET state='interrupted' "
                               "WHERE id=? AND thread_id=? AND state='queued'",(receipt_id,thread_id)).rowcount
            if changed:
                self._receipt_event(db, thread_id, receipt_id)
            return bool(changed)

    def attachment_add(self, thread_id, attachment_id, name, mime, size):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            thread=db.execute('SELECT archived FROM threads WHERE id=?',(thread_id,)).fetchone()
            if not thread:
                raise ValueError('unknown thread')
            if thread['archived']:
                raise ValueError('thread archived')
            count,total=db.execute('SELECT COUNT(*),COALESCE(SUM(size),0) FROM attachments '
                                   'WHERE thread_id=? AND receipt_id IS NULL',(thread_id,)).fetchone()
            if count>=64 or total+size>64*1024*1024:
                raise OverflowError('unattached upload quota reached; delete unused attachments')
            db.execute('INSERT INTO attachments(id,thread_id,name,mime,size) VALUES (?,?,?,?,?)',
                       (attachment_id,thread_id,name,mime,size))
            self._event(db,'attachment',thread_id,attachment_id)

    def attachment(self, thread_id, attachment_id):
        with self._connect() as db:
            row=db.execute('SELECT * FROM attachments WHERE thread_id=? AND id=?',
                           (thread_id,attachment_id)).fetchone()
            return dict(row) if row else None

    def attachment_view(self, row):
        path=self.path.parent/'attachments'/row['id']
        try:
            info=path.lstat()
            available=stat.S_ISREG(info.st_mode) and info.st_size==row['size']
        except OSError:
            available=False
        return {key:row[key] for key in ('id','thread_id','name','mime','size','receipt_id')} | {
            'state':'available' if available else 'missing'}

    def receipt_attachments(self, receipt_id):
        with self._connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM attachments WHERE receipt_id=? ORDER BY rowid',
                                                (receipt_id,))]

    def attachment_delete_unattached(self, thread_id, attachment_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed=db.execute('DELETE FROM attachments WHERE thread_id=? AND id=? AND receipt_id IS NULL',
                               (thread_id,attachment_id)).rowcount
            if changed:
                self._event(db,'attachment',thread_id,attachment_id,2)
            return bool(changed)

    def expire_interactions(self, generation):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows=db.execute("SELECT id,thread_id FROM interactions WHERE state='pending' AND generation!=?",
                            (generation,)).fetchall()
            for row in rows:
                db.execute("UPDATE interactions SET state='expired' WHERE id=?",(row['id'],))
                self._event(db,'interaction',row['thread_id'],row['id'],2)
            return len(rows)

    def interaction_add(self, kind, request_id, thread_id, receipt_id, generation, prompt, choices):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO interactions VALUES (?,?,?,?,?,?,?,?)',
                       (request_id,kind,thread_id,receipt_id,generation,prompt,
                        json.dumps(choices,ensure_ascii=False),'pending'))
            if db.execute('SELECT changes()').fetchone()[0]:
                self._event(db,'interaction',thread_id,request_id)

    def interaction(self, thread_id, request_id):
        with self._connect() as db:
            row=db.execute('SELECT * FROM interactions WHERE thread_id=? AND id=?',
                           (thread_id,request_id)).fetchone()
            if not row:
                return None
            value=dict(row)
            value['choices']=json.loads(value['choices'])
            return value

    def pending_interactions(self, thread_id, generation):
        with self._connect() as db:
            return [dict(r) for r in db.execute(
                "SELECT id,kind,receipt_id FROM interactions WHERE thread_id=? AND generation=? AND state='pending'",
                (thread_id,generation))]

    def interaction_settle(self, thread_id, request_id, generation, state):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed=db.execute("UPDATE interactions SET state=? WHERE thread_id=? AND id=? "
                               "AND generation=? AND state='pending'",(state,thread_id,request_id,generation)).rowcount
            if changed:
                self._event(db,'interaction',thread_id,request_id,2)
            return bool(changed)

    def expire_receipt_interactions(self, receipt_id, generation):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows=db.execute("SELECT id,thread_id FROM interactions WHERE receipt_id=? AND generation=? "
                            "AND state='pending'",(receipt_id,generation)).fetchall()
            for row in rows:
                db.execute("UPDATE interactions SET state='expired' WHERE id=?",(row['id'],))
                self._event(db,'interaction',row['thread_id'],row['id'],2)
            return len(rows)

    def delivery_ref(self, execution_id):
        with self._connect() as db:
            row=db.execute('SELECT thread_id,row_id,ref_seq FROM deliveries WHERE execution_id=?',
                           (execution_id,)).fetchone()
            return dict(row) if row else None

    def publish_delivery(self, execution_id, thread_id, session_id, row_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT thread_id,ref_seq FROM deliveries WHERE execution_id=?',
                           (execution_id,)).fetchone()
            if old:
                if old['thread_id']!=thread_id:
                    raise ValueError('delivery belongs to another thread')
                return old['ref_seq']
            if not db.execute('SELECT 1 FROM session_links WHERE thread_id=? AND session_id=?',
                              (thread_id,session_id)).fetchone():
                raise ValueError('delivery session belongs to another thread')
            turn_id='cron:'+execution_id
            db.execute("INSERT INTO turns VALUES (?,?,'complete')",(turn_id,thread_id))
            db.execute("INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) "
                       "VALUES (?,?,?,?,'assistant')",(thread_id,turn_id,session_id,row_id))
            seq=db.execute('SELECT last_insert_rowid()').fetchone()[0]
            db.execute('INSERT INTO deliveries VALUES (?,?,?,?)',(execution_id,thread_id,row_id,seq))
            return seq

    def recover_deliveries(self, source_db):
        """Repair the core-row / plugin-ref crash window without replaying cron."""
        if not Path(source_db).exists():
            return 0
        with self._connect() as db:
            links={r['session_id']:r['thread_id'] for r in db.execute('SELECT * FROM session_links')}
        if not links:
            return 0
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
            source.row_factory=sqlite3.Row
            rows=source.execute("SELECT id,session_id,platform_message_id FROM messages "
                "WHERE display_kind='cron_delivery' AND platform_message_id LIKE 'cron:%' "
                'ORDER BY id LIMIT 10001').fetchall()
        if len(rows)>10000:
            raise OverflowError('cron delivery recovery bound exceeded')
        repaired=0
        for row in rows:
            thread_id=links.get(row['session_id'])
            execution_id=row['platform_message_id'].removeprefix('cron:')
            if thread_id and execution_id and not self.delivery_ref(execution_id):
                self.publish_delivery(execution_id,thread_id,row['session_id'],row['id'])
                repaired+=1
        return repaired

    def link_user_receipt(self, receipt_id, row_id):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE receipts SET user_row_id=? WHERE id=? AND user_row_id IS NULL',
                       (row_id,receipt_id))

    @staticmethod
    def _insert_core_ref(db, thread_id, turn_id, session_id, row_id, role):
        # Exact platform-message provenance may have a prior receipt-backed
        # display ref. Promote it in place: cursors/read markers never move.
        if role == 'user':
            existing=db.execute('SELECT seq,turn_id FROM message_refs WHERE row_id=? AND thread_id=?',
                                (row_id,thread_id)).fetchone()
            if existing:
                if existing['turn_id'].startswith('input:'):
                    db.execute('UPDATE message_refs SET turn_id=? WHERE seq=?',(turn_id,existing['seq']))
                # A continuation may reference this user again, but must not
                # take its established owner away from the completed turn.
                return
            linked=db.execute('SELECT r.seq FROM receipts c JOIN message_refs r '
                              'ON r.input_receipt_id=c.id WHERE c.thread_id=? AND c.user_row_id=?',
                              (thread_id,row_id)).fetchone()
            if linked:
                db.execute('UPDATE message_refs SET turn_id=?,session_id=?,row_id=? '
                           'WHERE seq=?',(turn_id,session_id,row_id,linked['seq']))
                return
        db.execute('INSERT INTO message_refs(thread_id,turn_id,session_id,row_id,role) '
                   'VALUES (?,?,?,?,?)',(thread_id,turn_id,session_id,row_id,role))

    def link_user_from_core(self, receipt_id, source_db):
        with self._connect() as db:
            receipt=db.execute('SELECT thread_id,user_row_id FROM receipts WHERE id=?',
                               (receipt_id,)).fetchone()
            if receipt is None:
                return False
            sessions=[r['session_id'] for r in db.execute(
                'SELECT session_id FROM session_links WHERE thread_id=?',(receipt['thread_id'],))]
        if not sessions:
            return False
        marks=','.join('?' for _ in sessions)
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
            source.row_factory=sqlite3.Row
            rows=source.execute(
                f"SELECT * FROM messages WHERE session_id IN ({marks}) AND role='user' "
                'AND platform_message_id=? ORDER BY id LIMIT 2', [*sessions,receipt_id]).fetchall()
        if rows:
            original=next((r for r in rows if r['id']==receipt['user_row_id']),rows[0])
            session=original['session_id']
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                input_ref=db.execute('SELECT seq FROM message_refs WHERE input_receipt_id=?',
                                     (receipt_id,)).fetchone()
                if input_ref:
                    from .projection import visible_text
                    if visible_text(dict(original)) is None:
                        return False  # Never discard the only readable original.
                core_ref=db.execute('SELECT seq FROM message_refs WHERE row_id=?',(original['id'],)).fetchone()
                if input_ref and not core_ref:
                    # Promotion and clearing the body are one transaction. A
                    # reader can always resolve either the body or exact row.
                    db.execute('UPDATE message_refs SET row_id=?,session_id=? WHERE seq=?',
                               (original['id'],session,input_ref['seq']))
                elif input_ref and core_ref and core_ref['seq']!=input_ref['seq']:
                    # Never erase an issued cursor to hide a provenance race.
                    raise HistoryPending('core input already published separately')
                db.execute('UPDATE receipts SET user_row_id=?,pending_text=NULL WHERE id=?',
                           (original['id'],receipt_id))
            return True
        return False

    def link_followup_core_users(self, thread_id, source_db):
        """Promote exact normal-fallback anchors before formal hooks publish them."""
        if not thread_id:
            return
        with self._connect() as db:
            ids=[r['id'] for r in db.execute(
                "SELECT id FROM receipts WHERE thread_id=? AND admission='followup' "
                "AND state='running' AND user_row_id IS NULL ORDER BY rowid LIMIT 33",(thread_id,))]
        if len(ids)>32:
            raise OverflowError('followup reconciliation bound exceeded')
        for receipt_id in ids:
            self.link_user_from_core(receipt_id,source_db)

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

    @staticmethod
    def _last_message_at(db, source, thread_id):
        """Display time of the newest published message; thread creation if none."""
        ref=db.execute('SELECT seq,row_id,input_receipt_id,direct_message_id,system_notice_id FROM message_refs '
                       'WHERE thread_id=? ORDER BY seq DESC LIMIT 1',(thread_id,)).fetchone()
        value=None
        if ref is not None and ref['input_receipt_id'] is not None:
            value=db.execute('SELECT created_at FROM receipts WHERE id=?',(ref['input_receipt_id'],)).fetchone()
            value=value[0] if value else None
        elif ref is not None and ref['direct_message_id'] is not None:
            value=db.execute('SELECT created_at FROM direct_messages WHERE id=?',(ref['direct_message_id'],)).fetchone()
            value=value[0] if value else None
        elif ref is not None and ref['system_notice_id'] is not None:
            value=db.execute('SELECT created_at FROM system_notices WHERE id=?',(ref['system_notice_id'],)).fetchone()
            value=value[0] if value else None
        elif ref is not None:
            linked=db.execute('SELECT created_at FROM receipts WHERE thread_id=? AND user_row_id=?',
                              (thread_id,ref['row_id'])).fetchall()
            if len(linked)==1:
                value=linked[0][0]
            elif source is not None:
                row=source.execute('SELECT timestamp FROM messages WHERE id=?',(ref['row_id'],)).fetchone()
                value=row[0] if row else None
            if value is None:
                snap=db.execute('SELECT payload FROM core_ref_snapshots WHERE row_id=?',(ref['row_id'],)).fetchone()
                value=json.loads(snap[0]).get('timestamp') if snap else None
        if not _message_time(value):
            value=db.execute('SELECT created_at FROM threads WHERE id=?',(thread_id,)).fetchone()[0]
        return _message_time(value).get('created_at')

    def snapshot(self, *, after=None, limit=50, source_db=None):
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
        source=None
        if source_db is not None and Path(source_db).exists():
            source=sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)
        with closing(source) if source is not None else nullcontext(), self._connect() as db:
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
                last_at=self._last_message_at(db,source,item['id'])
                if last_at is not None:
                    item['last_message_at']=last_at
                active=db.execute("SELECT id,client_message_id,thread_id,state,admission,handed_off,processing,feedback,user_row_id FROM receipts "
                                  "WHERE thread_id=? AND state IN ('queued','running') "
                                  "ORDER BY created_at,id LIMIT 33",(item['id'],)).fetchall()
                # Admission permits 32 queued/running receipts in total.
                if len(active)>32:
                    raise OverflowError('active receipt snapshot bound exceeded')
                item['active_receipts']=[self._receipt(db,r) for r in active]
                interactions=db.execute("SELECT * FROM interactions WHERE thread_id=? AND state='pending' "
                                        "ORDER BY rowid LIMIT 21",(item['id'],)).fetchall()
                if len(interactions)>20:
                    raise OverflowError('pending interaction snapshot bound exceeded')
                item['pending_interactions']=[dict(r)|{'choices':json.loads(r['choices'])} for r in interactions]
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

    def bind_direct_session(self, thread_id, session_id) -> bool:
        """Keep native session switches mapped to the same App thread."""
        if not isinstance(session_id,str) or not session_id:
            raise ValueError('invalid session id')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM threads WHERE id=?', (thread_id,)).fetchone():
                raise ValueError('unknown thread')
            old=db.execute('SELECT thread_id FROM session_links WHERE session_id=?',
                           (session_id,)).fetchone()
            if old:
                if old['thread_id']!=thread_id:
                    raise ValueError('session belongs to another thread')
                return False
            db.execute('INSERT INTO session_links(session_id,thread_id) VALUES (?,?)',
                       (session_id,thread_id))
            return True

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
        if not refs or any(r[2] not in ('user', 'assistant') for r in refs):
            raise ValueError('visible turn must start with a user row')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT thread_id,state FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
            if existing and existing['thread_id'] != thread_id:
                raise ValueError('turn belongs to another thread')
            if refs[0][2] != 'user' and not self._has_continuation(db, turn_id, refs[0][0], refs[0][1]):
                raise ValueError('assistant-only turn needs a continuation anchor')
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
                self._insert_core_ref(db,thread_id,turn_id,session_id,row_id,role)
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
                if not refs or refs[0][2] != 'assistant' or not self._has_continuation(
                        db, turn_id, refs[0][0], refs[0][1]):
                    raise ValueError('hook turn needs original user or continuation anchor')
            if any(ref[2] not in ('user','assistant') for ref in refs):
                raise ValueError('invalid visible row')
            if old and refs and refs[0][1] <= old[-1][1]:
                raise ValueError('hook rows out of order')
            for session_id,row_id,role in refs:
                self._insert_core_ref(db,thread_id,turn_id,session_id,row_id,role)
            if complete:
                db.execute("UPDATE turns SET state='complete' WHERE turn_id=?", (turn_id,))

    def turn_refs(self, turn_id):
        with self._connect() as db:
            return [(r['session_id'],r['row_id'],r['role']) for r in db.execute(
                'SELECT session_id,row_id,role FROM message_refs WHERE turn_id=? ORDER BY seq', (turn_id,))]

    @staticmethod
    def _has_continuation(db, turn_id, session_id, first_id):
        row = db.execute('SELECT row_id FROM continuation_anchors WHERE turn_id=? AND session_id=?',
                         (turn_id, session_id)).fetchone()
        return bool(row and row['row_id'] < first_id)

    def continuation_anchor(self, thread_id, turn_id, session_id, row_id, source_db):
        """Track a core-generated user turn for bookkeeping, never for display."""
        with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)) as source:
            row = source.execute('SELECT role,session_id,platform_message_id FROM messages WHERE id=?',
                                 (row_id,)).fetchone()
        if not row or row != ('user', session_id, None):
            return False
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            turn = db.execute('SELECT thread_id FROM turns WHERE turn_id=?', (turn_id,)).fetchone()
            linked = db.execute('SELECT thread_id FROM session_links WHERE session_id=?',
                                (session_id,)).fetchone()
            prior = db.execute("SELECT 1 FROM message_refs WHERE thread_id=? "
                               "AND role='user' AND row_id<? LIMIT 1",
                               (thread_id, row_id)).fetchone()
            if not turn or turn['thread_id'] != thread_id or not linked or linked['thread_id'] != thread_id or not prior:
                return False
            old = db.execute('SELECT row_id FROM continuation_anchors WHERE turn_id=?', (turn_id,)).fetchone()
            if old and old['row_id'] != row_id:
                raise ValueError('continuation anchor changed')
            db.execute('INSERT OR IGNORE INTO continuation_anchors VALUES (?,?,?)',
                       (turn_id, session_id, row_id))
            return True

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
        visible = [r for r in rows if r.get('display_kind') != 'steer' and visible_text(r) is not None]
        refs = [(r['session_id'], r['id'], r['role']) for r in visible]
        if refs and refs[0][2]=='user':
            self.link_user_from_core(platform_message_id,source_db)
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
                for session_id,row_id,role in refs[len(old):]:
                    self._insert_core_ref(db,thread_id,turn['turn_id'],session_id,row_id,role)
            if not compatible and not proven:
                # Keep issued cursors valid and expose the unresolved mapping.
                db.execute("UPDATE turns SET state='unknown' WHERE turn_id=?", (turn['turn_id'],))
            elif turn['state'] in ('pending','input'):
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

    @staticmethod
    def _older_cursor(thread_id, seq):
        payload = json.dumps(['older', thread_id, seq], separators=(',', ':')).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip('=')

    @staticmethod
    def _parse_older_cursor(thread_id, before):
        if not isinstance(before, str) or not 1 <= len(before) <= 256:
            raise ValueError('invalid older cursor')
        try:
            value = json.loads(base64.urlsafe_b64decode(before + '=' * (-len(before) % 4)))
            if (not isinstance(value, list) or len(value) != 3 or value[:2] != ['older', thread_id]
                    or type(value[2]) is not int or value[2] <= 0):
                raise ValueError
            return value[2]
        except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error) as exc:
            raise ValueError('invalid older cursor') from exc

    def _input_message(self, db, ref):
        """One durable input identity; only an exact core anchor can replace its text."""
        receipt=db.execute('SELECT id,client_message_id,thread_id,pending_text,created_at FROM receipts WHERE id=?',
                           (ref['input_receipt_id'],)).fetchone()
        if not receipt or receipt['thread_id'] != ref['thread_id']:
            raise MissingOriginal('input receipt unavailable')
        return {'id':'receipt:'+receipt['id'], 'ref_seq':ref['seq'], 'role':'user',
                'text':receipt['pending_text'], 'receipt_id':receipt['id'],
                'client_message_id':receipt['client_message_id'], **_message_time(receipt['created_at']),
                'attachments':[self.attachment_view(dict(a)) for a in db.execute(
                    'SELECT * FROM attachments WHERE receipt_id=? ORDER BY rowid',(receipt['id'],))]}

    @staticmethod
    def _input_display(message, ref, rows):
        from .projection import visible_text
        if ref['row_id'] is not None:
            row=rows.get(ref['row_id'])
            if not row or row['session_id']!=ref['session_id'] or row['role']!='user' or row['platform_message_id']!=ref['input_receipt_id']:
                raise MissingOriginal('exact input anchor unavailable')
            text=row['snapshot_text'] if 'snapshot_text' in row.keys() else visible_text(dict(row))
            if text is None:
                raise MissingOriginal('input anchor not visible')
            message['text']=text
        if message['text'] is None:
            raise MissingOriginal('input text unavailable without replacement')
        return message

    @staticmethod
    def _direct_messages(db, page):
        ids=[r['direct_message_id'] for r in page if r['direct_message_id'] is not None]
        if not ids:
            return {}
        return {r['id']:r for r in db.execute(
            'SELECT id,thread_id,text,attachment_id,created_at FROM direct_messages WHERE id IN '
            f'({",".join("?" for _ in ids)})',ids)}

    def _direct_display(self, ref, direct):
        row=direct.get(ref['direct_message_id'])
        if row is None or row['thread_id']!=ref['thread_id'] or ref['role']!='assistant':
            raise MissingOriginal('direct message unavailable')
        attached=[]
        if row['attachment_id']:
            item=self.attachment(ref['thread_id'],row['attachment_id'])
            if not item:
                raise MissingOriginal('direct document unavailable')
            attached=[self.attachment_view(item)]
        return {'id':row['id'],'ref_seq':ref['seq'],'role':'assistant','text':row['text'],
                'display_kind':'direct',**_message_time(row['created_at']),'attachments':attached}

    @staticmethod
    def _system_notices(db, page):
        ids=[r['system_notice_id'] for r in page if r['system_notice_id'] is not None]
        if not ids:
            return {}
        return {r['id']:r for r in db.execute(
            'SELECT id,thread_id,kind,state,text,created_at FROM system_notices WHERE id IN '
            f'({",".join("?" for _ in ids)})',ids)}

    @staticmethod
    def _system_display(ref, notices):
        row=notices.get(ref['system_notice_id'])
        if row is None or row['thread_id']!=ref['thread_id'] or ref['role']!='system':
            raise MissingOriginal('system notice unavailable')
        return {'id':row['id'],'ref_seq':ref['seq'],'role':'system','text':row['text'],
                'display_kind':'system_notice',**_message_time(row['created_at']),'attachments':[]}

    def _is_followup_copy(self, ref, row):
        """Hide only a generated continuation whose original inputs are published."""
        from .projection import _ORIGIN_NOTE
        if (row['role'] != 'user' or 'platform_message_id' not in row.keys() or
                row['platform_message_id'] or row['display_kind']):
            return False
        text = row['content']
        if not isinstance(text, str):
            return False
        notes = list(_ORIGIN_NOTE.finditer(text))
        if not notes or notes[0].start() != 0:
            return False
        with self._connect() as db:
            for i, note in enumerate(notes):
                try:
                    origin = json.loads(note['origin'])
                except ValueError:
                    return False
                if (origin.get('platform') != 'hermes_app' or
                        origin.get('thread_id') != ref['thread_id'] or
                        not isinstance(origin.get('message_id'), str)):
                    return False
                original = db.execute(
                    'SELECT r.pending_text,t.project_id FROM receipts r JOIN threads t ON t.id=r.thread_id '
                    'JOIN message_refs m ON m.input_receipt_id=r.id AND m.thread_id=r.thread_id '
                    "WHERE r.id=? AND r.thread_id=? AND r.admission='followup' AND r.handed_off=1 "
                    'AND m.seq<?', (origin['message_id'],ref['thread_id'],ref['seq'])).fetchone()
                end = notes[i+1].start() if i+1 < len(notes) else len(text)
                if (not original or origin.get('chat_id') != original['project_id'] or
                        original['pending_text'] is None or
                        text[note.end():end].strip() != original['pending_text'].strip()):
                    return False
        return True

    def history_page(self, thread_id, source_db, *, limit=50, after=None, after_ref_seq=None,
                     latest=False, before=None, ref_seq=None):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('limit must be 1..100')
        if type(latest) is not bool or (int(after is not None) + int(after_ref_seq is not None)
                                        + int(bool(latest)) + int(before is not None)
                                        + int(ref_seq is not None)) > 1:
            raise ValueError('history directions are exclusive')
        if after_ref_seq is not None and (type(after_ref_seq) is not int or after_ref_seq <= 0):
            raise ValueError('invalid ref seq')
        if ref_seq is not None and (type(ref_seq) is not int or ref_seq <= 0):
            raise ValueError('invalid ref seq')
        backward = latest or before is not None
        cursor = (self._parse_older_cursor(thread_id, before) if before is not None else
                  self._parse_cursor(thread_id, after) if after is not None else (after_ref_seq or 0))
        with self._connect() as db:
            db.execute('BEGIN')  # Keep cursor validation, page and identity on one ref snapshot.
            if cursor and not db.execute(
                    'SELECT 1 FROM message_refs WHERE thread_id=? AND seq=?', (thread_id, cursor)).fetchone():
                raise ValueError('invalid cursor')
            pending = [r['turn_id'] for r in db.execute(
                "SELECT turn_id FROM turns WHERE thread_id=? AND state='pending' ORDER BY rowid LIMIT 20", (thread_id,))]
            outcomes = [{'turn_id': r['turn_id'], 'state': r['state']} for r in db.execute(
                "SELECT turn_id,state FROM turns WHERE thread_id=? AND state IN ('failed','interrupted','unknown') "
                "AND turn_id NOT LIKE 'ingress:%' ORDER BY rowid LIMIT 20", (thread_id,))]
            if ref_seq is not None:
                refs = db.execute('SELECT seq,thread_id,session_id,row_id,input_receipt_id,direct_message_id,system_notice_id,role FROM message_refs '
                                  'WHERE thread_id=? AND seq=?', (thread_id,ref_seq)).fetchall()
                if not refs:
                    raise ValueError('unknown ref seq for thread')
                page, older_cursor, next_cursor = refs, None, None
            elif backward:
                if before is None:
                    refs = db.execute('SELECT seq,thread_id,session_id,row_id,input_receipt_id,direct_message_id,system_notice_id,role FROM message_refs '
                                      'WHERE thread_id=? ORDER BY seq DESC LIMIT ?',
                                      (thread_id, limit + 1)).fetchall()
                else:
                    refs = db.execute('SELECT seq,thread_id,session_id,row_id,input_receipt_id,direct_message_id,system_notice_id,role FROM message_refs '
                                      'WHERE thread_id=? AND seq<? ORDER BY seq DESC LIMIT ?',
                                      (thread_id, cursor, limit + 1)).fetchall()
                page = list(reversed(refs[:limit]))
                older_cursor = self._older_cursor(thread_id, page[0]['seq']) if len(refs) > limit else None
                # next_cursor always means forward continuation after the last returned ref.
                newer = bool(page and db.execute('SELECT 1 FROM message_refs WHERE thread_id=? AND seq>? LIMIT 1',
                                                 (thread_id, page[-1]['seq'])).fetchone())
                next_cursor = self._cursor(thread_id, page[-1]['seq']) if newer else None
            else:
                refs = db.execute('SELECT seq,thread_id,session_id,row_id,input_receipt_id,direct_message_id,system_notice_id,role FROM message_refs '
                                  'WHERE thread_id=? AND seq>? ORDER BY seq LIMIT ?',
                                  (thread_id, cursor, limit + 1)).fetchall()
                page = refs[:limit]
                older_cursor = None
                next_cursor = self._cursor(thread_id, page[-1]['seq']) if len(refs) > limit else None
            ids = [r['row_id'] for r in page if r['row_id'] is not None]
            inputs = {r['seq']:self._input_message(db,r) for r in page
                      if r['input_receipt_id'] is not None}
            direct = self._direct_messages(db,page)
            notices = self._system_notices(db,page)
            snapshots = {r['row_id']:json.loads(r['payload']) for r in db.execute(
                'SELECT row_id,payload FROM core_ref_snapshots WHERE row_id IN ('+
                ','.join('?' for _ in ids)+')',ids)} if ids else {}
            linked = {}
            if ids:
                for receipt in db.execute(
                        'SELECT id,client_message_id,user_row_id,created_at FROM receipts WHERE thread_id=? AND '
                        f'user_row_id IN ({",".join("?" for _ in ids)})', (thread_id, *ids)):
                    row_id = receipt['user_row_id']
                    # A legacy/corrupt duplicate link proves no unique send identity.
                    linked[row_id] = None if row_id in linked else dict(receipt)
            attached = {row_id: [self.attachment_view(dict(a)) for a in db.execute(
                'SELECT * FROM attachments WHERE receipt_id=? ORDER BY rowid', (receipt['id'],))]
                for row_id, receipt in linked.items() if receipt is not None}
        if not page:
            return {'messages': [], 'next_cursor': None, 'older_cursor': None,
                    'incomplete_turns': pending, 'turn_outcomes': outcomes}
        rows = {}
        if ids:
            with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro', uri=True)) as source:
                source.row_factory = sqlite3.Row
                rows = {r['id']: r for r in source.execute(
                    f"SELECT * FROM messages WHERE id IN ({','.join('?' for _ in ids)})", ids)}
        rows = {**snapshots, **rows}  # Live core rows always win.
        from .projection import visible_text
        from .tool_timeline import public_tool_calls
        messages = []
        for ref in page:
            if ref['seq'] in inputs:
                messages.append(self._input_display(inputs[ref['seq']],ref,rows))
                continue
            if ref['direct_message_id'] is not None:
                messages.append(self._direct_display(ref,direct))
                continue
            if ref['system_notice_id'] is not None:
                messages.append(self._system_display(ref,notices))
                continue
            row = rows.get(ref['row_id'])
            if row is None or row['session_id'] != ref['session_id'] or row['role'] != ref['role']:
                raise MissingOriginal(f"original row {ref['row_id']} unavailable")
            if self._is_followup_copy(ref, row):
                continue
            value = dict(row)
            value['_row_id'] = row['id']
            text = value['snapshot_text'] if 'snapshot_text' in value else visible_text(value)
            if text is None:
                raise MissingOriginal(f"original row {ref['row_id']} is not visible")
            message = {'id': str(row['id']), 'ref_seq': ref['seq'],
                       'role': row['role'], 'text': text,
                       **_message_time(linked[row['id']]['created_at'] if row['role']=='user' and
                                       linked.get(row['id']) is not None else value.get('timestamp')),
                       'attachments': attached.get(row['id'], []) if row['role'] == 'user' else []}
            if row['role']=='user' and row['display_kind']=='steer':
                message['display_kind']='steer'  # Only the actual core typed row.
            if row['role'] == 'assistant':
                calls = value['snapshot_tool_calls'] if 'snapshot_tool_calls' in value else public_tool_calls(value)
                if calls:
                    message['tool_calls'] = calls
            if row['role'] == 'user' and linked.get(row['id']) is not None:
                receipt = linked[row['id']]
                message['receipt_id'] = receipt['id']
                message['client_message_id'] = receipt['client_message_id']
            messages.append(message)
        return {'messages': messages, 'next_cursor': next_cursor, 'older_cursor': older_cursor,
                'incomplete_turns': pending, 'turn_outcomes': outcomes}

    def search_page(self, thread_id, source_db, query, *, limit=20, after=None):
        if not isinstance(query,str) or not 1 <= len(query.strip()) <= 200:
            raise ValueError('query required (1..200 characters)')
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('limit must be 1..100')
        cursor=self._parse_cursor(thread_id,after) if after is not None else 0
        with self._connect() as db:
            if after is not None and not db.execute(
                    'SELECT 1 FROM message_refs WHERE thread_id=? AND seq=?',(thread_id,cursor)).fetchone():
                raise ValueError('invalid cursor')
            refs=db.execute('SELECT seq,thread_id,session_id,row_id,input_receipt_id,direct_message_id,system_notice_id,role FROM message_refs '
                            'WHERE thread_id=? AND seq>? ORDER BY seq LIMIT 501',
                            (thread_id,cursor)).fetchall()
        page=refs[:500]
        if not page:
            return {'messages':[],'next_cursor':None}
        from .projection import visible_text
        from .tool_timeline import public_tool_calls
        ids=[r['row_id'] for r in page if r['row_id'] is not None]
        with self._connect() as db:
            inputs={r['seq']:self._input_message(db,r) for r in page
                    if r['input_receipt_id'] is not None}
            direct=self._direct_messages(db,page)
            notices=self._system_notices(db,page)
            snapshots={r['row_id']:json.loads(r['payload']) for r in db.execute(
                'SELECT row_id,payload FROM core_ref_snapshots WHERE row_id IN ('+
                ','.join('?' for _ in ids)+')',ids)} if ids else {}
            linked = {}
            if ids:
                for receipt in db.execute(
                        'SELECT user_row_id,created_at FROM receipts WHERE thread_id=? AND '
                        f'user_row_id IN ({",".join("?" for _ in ids)})', (thread_id, *ids)):
                    row_id = receipt['user_row_id']
                    linked[row_id] = None if row_id in linked else dict(receipt)
        rows={}
        if ids:
            with closing(sqlite3.connect(f'file:{Path(source_db)}?mode=ro',uri=True)) as source:
                source.row_factory=sqlite3.Row
                rows={r['id']:r for r in source.execute(
                    f"SELECT * FROM messages WHERE id IN ({','.join('?' for _ in ids)})",ids)}
        rows={**snapshots,**rows}
        matches=[]
        scanned=cursor
        needle=query.casefold()
        for ref in page:
            scanned=ref['seq']
            if ref['seq'] in inputs:
                message=self._input_display(inputs[ref['seq']],ref,rows)
                content=message['text']
                calls=[]
            elif ref['direct_message_id'] is not None:
                message=self._direct_display(ref,direct)
                content=message['text']
                calls=[]
            elif ref['system_notice_id'] is not None:
                message=self._system_display(ref,notices)
                content=message['text']
                calls=[]
            else:
                row=rows.get(ref['row_id'])
                if row is None or row['session_id']!=ref['session_id'] or row['role']!=ref['role']:
                    raise MissingOriginal(f"original row {ref['row_id']} unavailable")
                if self._is_followup_copy(ref, row):
                    continue
                content=row['snapshot_text'] if 'snapshot_text' in row.keys() else visible_text(dict(row))
                if content is None:
                    raise MissingOriginal(f"original row {ref['row_id']} is not visible")
                calls = (row['snapshot_tool_calls'] if 'snapshot_tool_calls' in row.keys()
                         else public_tool_calls(dict(row))) if ref['role'] == 'assistant' else []
            scanned=ref['seq']
            if needle in content.casefold() or any(needle in c['label'].casefold() or
                                                    needle in c['name'].casefold() for c in calls):
                if (ref['seq'] not in inputs and ref['direct_message_id'] is None
                        and ref['system_notice_id'] is None):
                    message = {'id':str(row['id']),'ref_seq':scanned,'role':ref['role'],'text':content,
                               **_message_time(linked[row['id']]['created_at'] if ref['role']=='user' and
                                               linked.get(row['id']) is not None else
                                               row['timestamp'] if 'timestamp' in row.keys() else None)}
                    if row['role']=='user' and row['display_kind']=='steer':
                        message['display_kind']='steer'
                    if calls:
                        message['tool_calls'] = calls
                matches.append(message)
            if len(matches)>=limit:
                break
        more=len(refs)>len(page) or scanned != page[-1]['seq']
        return {'messages':matches,'next_cursor':self._cursor(thread_id,scanned) if more else None}

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

    def replace_thread_title(self, thread_id, expected, title):
        """CAS used by delayed auto-title work so a manual rename always wins."""
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
            return False
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute('UPDATE threads SET title=? WHERE id=? AND title=?',
                                 (title.strip(), thread_id, expected)).rowcount
            if changed:
                version=db.execute("SELECT COALESCE(MAX(version),0)+1 FROM sync_events "
                                   "WHERE kind='thread' AND ref=?",(thread_id,)).fetchone()[0]
                self._event(db,'thread',thread_id,thread_id,version)
            return bool(changed)

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
