/** P1-03 owner-scoped transport. No runtime imports or platform globals. */
export type ReceiptState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export interface Receipt { id: string; client_message_id: string; thread_id: string; state: ReceiptState; durable: true }
export interface Thread { id: string; project_id: string; title: string; archived: number | boolean; [key: string]: unknown }
export interface ThreadSummary { id: string; project_id: string; title: string; archived: number | boolean; last_ref: number; read_ref: number; unread_count: number }
export interface Channel { id: string; name: string; description?: string; [key: string]: unknown }
export interface Message { id: string; ref_seq: number; role: string; text: string }
export interface Event { type?: 'event'; event_id: number; cursor: string; kind: string; thread_id: string; ref: string; version: number }
export interface HttpReply { status: number; body: unknown }
export interface HttpTransport { request(method: string, path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<HttpReply> }
export interface Socket { onMessage(handler: (data: string) => void): void; onClose(handler: () => void): void; close(): void }
export interface SocketFactory { connect(path: string, token: string, signal: AbortSignal): Promise<Socket> }
export interface Options { http: HttpTransport; socket: SocketFactory; token: () => string; onChange?: () => void; onError?: (error: Error) => void; backoffMs?: number[] }
export class ProtocolError extends Error { constructor(message: string) { super(message); this.name = 'ProtocolError' } }
export class ResyncRequired extends ProtocolError { constructor(message: string) { super(message); this.name = 'ResyncRequired' } }
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProtocolError('invalid object'); return v as Record<string, unknown> };
const str = (v: unknown): string => { if (typeof v !== 'string') throw new ProtocolError('invalid string'); return v };
const num = (v: unknown): number => { if (!Number.isSafeInteger(v) || (v as number) < 0) throw new ProtocolError('invalid integer'); return v as number };
const arr = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new ProtocolError('invalid array'); return v };
const optionalCursor = (v: unknown): string | null => v === null ? null : str(v);
const idPath = (id: string): string => encodeURIComponent(id);
const query = (items: Record<string, string | number | null | undefined>): string => {
  const values = Object.entries(items).filter(([,v]) => v !== null && v !== undefined).map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  return values.length ? '?' + values.join('&') : '';
};
const validReceipt = (v: unknown): Receipt => {
  const x = obj(v); const states = ['queued','running','completed','failed','interrupted','unknown'];
  if (!states.includes(x.state as string) || x.durable !== true) throw new ProtocolError('invalid receipt');
  return { id: str(x.id), client_message_id: str(x.client_message_id), thread_id: str(x.thread_id), state: x.state as ReceiptState, durable: true };
};
const validThread = (v: unknown): Thread => { const x = obj(v); str(x.id); str(x.project_id); str(x.title); if (typeof x.archived !== 'boolean' && x.archived !== 0 && x.archived !== 1) throw new ProtocolError('invalid thread'); return x as unknown as Thread };
const validSummary = (v: unknown): ThreadSummary => { const x = validThread(v) as unknown as ThreadSummary; num(x.last_ref); num(x.read_ref); num(x.unread_count); return x };
const validChannel = (v: unknown): Channel => { const x = obj(v); str(x.id); str(x.name); return x as unknown as Channel };
const validEvent = (v: unknown): Event => { const x = obj(v); const event_id = num(x.event_id); const kind=str(x.kind); if (!event_id || !['channel','thread','message','receipt','read'].includes(kind)) throw new ProtocolError('invalid event'); return { event_id, cursor: str(x.cursor), kind, thread_id: str(x.thread_id), ref: str(x.ref), version: num(x.version) } };
const validMessage = (v: unknown): Message => { const x = obj(v); return { id: str(x.id), ref_seq: num(x.ref_seq), role: str(x.role), text: str(x.text) } };
const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve,reject) => {
  if (signal.aborted) return reject(new Error('aborted'));
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms);
  const abort = () => { clearTimeout(timer); reject(new Error('aborted')) };
  signal.addEventListener('abort', abort, { once: true });
});

export class HermesClient {
  readonly channels = new Map<string, Channel>();
  readonly threads = new Map<string, ThreadSummary>();
  readonly receipts = new Map<string, Receipt>();
  readonly messages = new Map<string, Message[]>();
  readonly drafts = new Map<string, string>(); // ephemeral stream text; never merged into durable history
  cursor: string | null = null;
  lastEventId = 0;
  private socket: Socket | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private replay: Promise<void> | null = null;
  private versions = new Map<string, number>();
  private fetchSequence = 0;
  private entitySequence = new Map<string, number>();
  constructor(private readonly options: Options) {}
  private changed() { this.options.onChange?.() }
  private storeReceipt(receipt: Receipt) {
    const previous=this.receipts.get(receipt.id);
    const stage=(state: ReceiptState) => state==='queued'?0:state==='running'?1:2;
    if (!previous || stage(receipt.state)>stage(previous.state) || previous.state===receipt.state) {
      this.receipts.set(receipt.id,receipt); this.changed();
    }
  }
  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const token = this.options.token();
    if (!token) throw new ProtocolError('missing token');
    const response = await this.options.http.request(method, path, token, body, signal);
    if (response.status === 400 && (path.startsWith('/v1/sync') || path.startsWith('/v1/snapshot'))) throw new ResyncRequired('invalid sync or snapshot cursor');
    if (response.status < 200 || response.status >= 300) throw new ProtocolError('HTTP ' + response.status + ' ' + path.split('?')[0]);
    return obj(response.body);
  }
  async capabilities() { const x = await this.call('GET','/v1/capabilities'); if (x.protocol !== 1 || x.durable_sync !== true) throw new ProtocolError('unsupported protocol'); return x }
  async listChannels(signal?: AbortSignal): Promise<Channel[]> {
    const seq = ++this.fetchSequence; const x = await this.call('GET','/v1/channels',undefined,signal);
    const channels = arr(x.channels).map(validChannel);
    if (seq >= (this.entitySequence.get('channels') || 0)) { this.channels.clear(); channels.forEach(c => this.channels.set(c.id,c)); this.entitySequence.set('channels',seq); this.changed() }
    return channels;
  }
  async createChannel(name: string, description = ''): Promise<Channel> { const x = await this.call('POST','/v1/channels',{name,description}); const c = validChannel(x.channel); this.channels.set(c.id,c); this.changed(); return c }
  async updateChannel(id: string, patch: {name?: string; description?: string}): Promise<Channel> { const x = await this.call('PATCH','/v1/channels/'+idPath(id),patch); const c = validChannel(x.channel); this.channels.set(id,c); this.changed(); return c }
  async deleteChannel(id: string): Promise<void> { const x = await this.call('DELETE','/v1/channels/'+idPath(id)); if (x.deleted !== true) throw new ProtocolError('delete not confirmed'); this.channels.delete(id); this.changed() }
  async listThreads(channelId: string, after?: string, limit = 50) { const x = await this.call('GET','/v1/channels/'+idPath(channelId)+'/threads'+query({after,limit})); return {threads: arr(x.threads).map(validThread),next_cursor:optionalCursor(x.next_cursor)} }
  async createThread(channelId: string, title: string): Promise<Thread> { const x = await this.call('POST','/v1/channels/'+idPath(channelId)+'/threads',{title}); return validThread(x.thread) }
  async getThread(id: string, rank = this.lastEventId, signal?: AbortSignal): Promise<Thread> {
    const seq = ++this.fetchSequence; const x = await this.call('GET','/v1/threads/'+idPath(id),undefined,signal); const thread = validThread(x.thread);
    const key = 'thread:'+id;
    if (rank >= (this.versions.get(key) || 0) && seq >= (this.entitySequence.get(key) || 0)) {
      const old = this.threads.get(id); this.threads.set(id,{...old,...thread,last_ref:old?.last_ref || 0,read_ref:old?.read_ref || 0,unread_count:old?.unread_count || 0});
      this.versions.set(key,rank); this.entitySequence.set(key,seq); this.changed();
    }
    return thread;
  }
  async updateThread(id: string, patch: {title?: string; archived?: boolean}): Promise<Thread> { const x = await this.call('PATCH','/v1/threads/'+idPath(id),patch); const t = validThread(x.thread); await this.getThread(id); return t }
  async archiveThread(id: string): Promise<Thread> { const x = await this.call('DELETE','/v1/threads/'+idPath(id)); const t=validThread(x.thread); await this.getThread(id); return t }
  async send(threadId: string, clientMessageId: string, text: string): Promise<Receipt> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(clientMessageId) || !text.trim()) throw new ProtocolError('invalid send');
    const x = await this.call('POST','/v1/threads/'+idPath(threadId)+'/messages',{client_message_id:clientMessageId,text});
    const r = validReceipt(x.receipt);
    if (r.thread_id !== threadId || r.client_message_id !== clientMessageId) throw new ProtocolError('receipt identity mismatch');
    this.storeReceipt(r); return this.receipts.get(r.id)!;
  }
  async getReceipt(id: string, signal?: AbortSignal): Promise<Receipt> { const x=await this.call('GET','/v1/receipts/'+idPath(id),undefined,signal); const r=validReceipt(x.receipt); if (r.id!==id) throw new ProtocolError('receipt identity mismatch'); this.storeReceipt(r); return this.receipts.get(id)! }
  async history(threadId: string, after?: string, limit = 50, signal?: AbortSignal) {
    const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query({after,limit}),undefined,signal);
    const page=arr(x.messages).map(validMessage); const existing=this.messages.get(threadId)||[];
    const byRef=new Map(existing.map(m=>[m.ref_seq,m])); page.forEach(m=>byRef.set(m.ref_seq,m));
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq)); this.changed();
    return {messages:page,next_cursor:optionalCursor(x.next_cursor),incomplete_turns:arr(x.incomplete_turns),turn_outcomes:arr(x.turn_outcomes)};
  }
  async historyAll(threadId: string, signal?: AbortSignal) {
    let after: string | null = null;
    do { const page=await this.history(threadId,after || undefined,100,signal); after=page.next_cursor } while(after);
    return this.messages.get(threadId) || [];
  }
  private async refreshSummaries(rank: number, signal?: AbortSignal) {
    let after: string | null = null;
    do {
      const x=await this.call('GET','/v1/snapshot'+query({after,limit:100}),undefined,signal);
      for (const summary of arr(x.threads).map(validSummary)) {
        const key='summary:'+summary.id;
        if (rank >= (this.versions.get(key)||0)) {
          const old=this.threads.get(summary.id);
          if (old && summary.read_ref<old.read_ref) { summary.read_ref=old.read_ref; summary.unread_count=old.unread_count }
          this.threads.set(summary.id,summary); this.versions.set(key,rank); this.changed()
        }
      }
      after=optionalCursor(x.next_after);
    } while(after);
  }
  async markRead(threadId: string, visibleRef: number) { num(visibleRef); const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/read',{ref_seq:visibleRef}); const ref=num(x.ref_seq); const old=this.threads.get(threadId); if (old && ref>=old.read_ref) { old.read_ref=ref; old.unread_count=num(x.unread_count); this.changed() } return ref }
  async snapshot(signal?: AbortSignal): Promise<void> {
    let after: string|null=null; let earliest: string|null=null; const pages: ThreadSummary[]=[];
    do { const x=await this.call('GET','/v1/snapshot'+query({after,limit:100}),undefined,signal); if (earliest===null) earliest=str(x.waterline); pages.push(...arr(x.threads).map(validSummary)); after=optionalCursor(x.next_after) } while(after);
    for (const t of pages) { const key='thread:'+t.id; if ((this.versions.get(key)||0)===0) this.threads.set(t.id,t) }
    this.cursor=earliest; this.lastEventId=0; this.changed();
    await this.listChannels(signal);
  }
  private async applyEvent(event: Event, signal?: AbortSignal) {
    if (event.event_id<=this.lastEventId) return;
    if (this.lastEventId && event.event_id!==this.lastEventId+1) throw new ResyncRequired('event gap');
    const key=event.kind+':'+event.thread_id+':'+event.ref;
    if (event.version>(this.versions.get(key)||0)) {
      if (event.kind==='channel') await this.listChannels(signal);
      else if (event.kind==='thread') await this.getThread(event.thread_id,event.event_id,signal);
      else if (event.kind==='message') { await this.historyAll(event.thread_id,signal); await this.refreshSummaries(event.event_id,signal) }
      else if (event.kind==='receipt') await this.getReceipt(event.ref,signal);
      else if (event.kind==='read') await this.refreshSummaries(event.event_id,signal);
      this.versions.set(key,event.version);
    }
    this.lastEventId=event.event_id; this.cursor=event.cursor;
  }
  async catchUp(signal?: AbortSignal): Promise<void> {
    if (this.replay) { await this.replay; return this.catchUp(signal) }
    const job=(async()=>{ if (this.cursor===null) await this.snapshot(signal); let more=true; while(more) {
      const x=await this.call('GET','/v1/sync'+query({cursor:this.cursor,limit:200}),undefined,signal);
      const events=arr(x.events).map(validEvent); str(x.waterline); const next=str(x.next_cursor); more=x.has_more===true;
      for (const event of events) await this.applyEvent(event,signal);
      if (!events.length && next!==this.cursor) throw new ResyncRequired('empty page advanced cursor');
      if (events.length && next!==this.cursor) throw new ResyncRequired('page cursor mismatch');
      if (more && !events.length) throw new ResyncRequired('empty continuation page');
    } })(); this.replay=job; try { await job } finally { this.replay=null }
  }
  /** Explicit resync after ResyncRequired; never silently rewinds a foreign/future cursor. */
  async resync(signal?: AbortSignal) { this.cursor=null; this.lastEventId=0; this.versions.clear(); this.threads.clear(); this.messages.clear(); await this.snapshot(signal); await this.catchUp(signal) }
  async connect(): Promise<void> { if (this.controller) return; const controller=new AbortController(); this.controller=controller; const gen=++this.generation; void this.run(gen,controller.signal) }
  private async run(gen: number, signal: AbortSignal) { let attempt=0; const delays=this.options.backoffMs||[200,500,1000,2000,5000];
    while(!signal.aborted && gen===this.generation) { try {
      await this.catchUp(signal); const cursor=this.cursor; if (!cursor) throw new ProtocolError('missing cursor');
      const socket=await this.options.socket.connect('/v1/events'+query({cursor}),this.options.token(),signal); this.socket=socket; attempt=0;
      await new Promise<void>((resolve,reject)=>{ socket.onMessage(data=>{ try { const x=obj(JSON.parse(data)); if (x.type==='hello') { if (x.protocol!==1 || x.durable_sync!==true) throw new ProtocolError('invalid hello'); return } if (x.type!=='event') throw new ProtocolError('invalid socket frame'); validEvent(x); void this.catchUp(signal).catch(reject) } catch(e) { reject(e) } }); socket.onClose(resolve); if (signal.aborted) resolve() });
    } catch(e) { if (!signal.aborted) this.options.onError?.(e instanceof Error?e:new Error(String(e))); if (e instanceof ResyncRequired) break }
      finally { this.socket?.close(); this.socket=null }
      if (!signal.aborted) { try { await wait(delays[Math.min(attempt++,delays.length-1)],signal) } catch { break } }
    }
  }
  close() { ++this.generation; this.controller?.abort(); this.controller=null; this.socket?.close(); this.socket=null; this.drafts.clear() }
}
