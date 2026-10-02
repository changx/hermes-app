import { DatabaseSync } from 'node:sqlite';
import type { ClientCheckpoint, Message } from '@hermes-app/client';

type CacheRow = {kind:string;key:string;threadId:string|null;rowId:string;ref:number|null;payload:string};
const kinds = ['channels','threads','receipts','interactions','attachments'] as const;

/** One owner-scoped, disposable server projection. Never stores credentials or
 * takes ownership of chat history. The encrypted outbox is intentionally separate. */
export class SQLiteProjectionCache {
  private readonly db: DatabaseSync;
  private payloads = new Map<string,string>();
  private metadataPayload: string | undefined;

  constructor(path:string, identity:string) {
    if (!/^[0-9a-f]{24}$/.test(identity)) throw new Error('Invalid cache identity');
    this.db=new DatabaseSync(path);
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checkpoint (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entities (
          kind TEXT NOT NULL, key TEXT NOT NULL, thread_id TEXT, row_id TEXT NOT NULL, ref_seq INTEGER,
          payload TEXT NOT NULL, PRIMARY KEY(kind,key), UNIQUE(kind,thread_id,row_id));
        CREATE INDEX IF NOT EXISTS message_window ON entities(kind,thread_id,ref_seq);`);
      this.db.prepare('INSERT OR IGNORE INTO owner(singleton,identity) VALUES(1,?)').run(identity);
      const owner=this.db.prepare('SELECT identity FROM owner WHERE singleton=1').get();
      if(owner?.identity!==identity)throw new Error('Foreign cache identity');
      for(const row of this.db.prepare('SELECT kind,key,payload FROM entities').all())this.payloads.set(JSON.stringify([row.kind,row.key]),String(row.payload));
      const metadata=this.db.prepare('SELECT payload FROM checkpoint WHERE singleton=1').get();
      this.metadataPayload=metadata ? String(metadata.payload) : undefined;
    } catch(error) {this.db.close();throw error}
  }

  save(value:ClientCheckpoint): {changed:number;removed:number} {
    if(value.schema!==1)throw new Error('Unsupported cache schema');
    const rows:CacheRow[]=[];
    for(const kind of kinds)for(const row of value[kind])rows.push({kind,key:row.id,threadId:'thread_id' in row?String(row.thread_id):null,rowId:row.id,ref:null,payload:JSON.stringify(row)});
    for(const [threadId,messages] of value.messages)for(const row of messages)rows.push({kind:'messages',key:JSON.stringify([threadId,row.ref_seq]),threadId,rowId:row.id,ref:row.ref_seq,payload:JSON.stringify(row)});
    const next=new Map(rows.map(row=>[JSON.stringify([row.kind,row.key]),row.payload]));
    if(next.size!==rows.length)throw new Error('Duplicate cache identity');
    const removed=[...this.payloads.keys()].filter(key=>!next.has(key));
    const changed=rows.filter(row=>this.payloads.get(JSON.stringify([row.kind,row.key]))!==row.payload);
    const metadata={schema:value.schema,cursor:value.cursor,lastEventId:value.lastEventId,versions:value.versions,fetchSequence:value.fetchSequence,entitySequence:value.entitySequence,messageSequence:value.messageSequence,knownEmptyThreads:value.knownEmptyThreads};
    const payload=JSON.stringify(metadata);
    if(!changed.length && !removed.length && payload===this.metadataPayload)return {changed:0,removed:0};
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const drop=this.db.prepare('DELETE FROM entities WHERE kind=? AND key=?');
      for(const key of removed){const [kind,id]=JSON.parse(key) as [string,string];drop.run(kind,id)}
      const put=this.db.prepare('INSERT INTO entities(kind,key,thread_id,row_id,ref_seq,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET thread_id=excluded.thread_id,row_id=excluded.row_id,ref_seq=excluded.ref_seq,payload=excluded.payload');
      for(const row of changed)put.run(row.kind,row.key,row.threadId,row.rowId,row.ref,row.payload);
      this.db.prepare('INSERT INTO checkpoint(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload').run(payload);
      this.db.exec('COMMIT');
      this.payloads=next;
      this.metadataPayload=payload;
      return {changed:changed.length,removed:removed.length};
    } catch(error) {this.db.exec('ROLLBACK');throw error}
  }

  load(): ClientCheckpoint | null {
    const metadata=this.db.prepare('SELECT payload FROM checkpoint WHERE singleton=1').get();
    if(!metadata)return null;
    const value={...JSON.parse(String(metadata.payload)),channels:[],threads:[],receipts:[],interactions:[],attachments:[],messages:[]} as ClientCheckpoint;
    const messages=new Map<string,Message[]>();
    for(const row of this.db.prepare('SELECT kind,thread_id,payload FROM entities ORDER BY ref_seq').all()) {
      const parsed=JSON.parse(String(row.payload));
      if(row.kind==='messages') {const id=String(row.thread_id);const list=messages.get(id)||[];list.push(parsed);messages.set(id,list)}
      else if(kinds.includes(row.kind as typeof kinds[number])) (value[row.kind as typeof kinds[number]] as unknown[]).push(parsed);
      else throw new Error('Invalid cache entity');
    }
    value.messages=[...messages];return value;
  }

  history(threadId:string,before?:number,limit=50): Message[] {
    if(!Number.isSafeInteger(limit)||limit<1||limit>200||before!==undefined&&(!Number.isSafeInteger(before)||before<1))throw new Error('Invalid cache window');
    const rows=before===undefined
      ?this.db.prepare("SELECT payload FROM entities WHERE kind='messages' AND thread_id=? ORDER BY ref_seq DESC LIMIT ?").all(threadId,limit)
      :this.db.prepare("SELECT payload FROM entities WHERE kind='messages' AND thread_id=? AND ref_seq<? ORDER BY ref_seq DESC LIMIT ?").all(threadId,before,limit);
    return rows.map(row=>JSON.parse(String(row.payload)) as Message).reverse();
  }

  clear():void {
    this.db.exec('BEGIN IMMEDIATE');
    try {this.db.exec('DELETE FROM entities; DELETE FROM checkpoint; COMMIT');this.payloads.clear();this.metadataPayload=undefined}
    catch(error){this.db.exec('ROLLBACK');throw error}
  }
  close():void {this.db.close()}
}
