/** P1-03 owner-scoped transport. No runtime imports or platform globals. */
export type ReceiptState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export interface Receipt { id: string; client_message_id: string; thread_id: string; state: ReceiptState; durable: true }
export interface Thread { id: string; project_id: string; title: string; archived: number | boolean; [key: string]: unknown }
export interface ThreadSummary { id: string; project_id: string; title: string; archived: number | boolean; last_ref: number; read_ref: number; unread_count: number; active_receipts?: Receipt[]; pending_interactions?: Interaction[] }
export interface Channel { id: string; name: string; description?: string; [key: string]: unknown }
export interface Attachment { id: string; thread_id: string; name?: string; mime?: string; size?: number; receipt_id?: string | null; state: 'available' | 'missing' | 'deleted' }
export interface Interaction { id: string; kind: 'approval' | 'clarify'; thread_id: string; receipt_id: string; generation: string; prompt: string; choices: string[]; state: 'pending' | 'settled' | 'expired' }
/** Display-only summaries from the authenticated server, never raw tool arguments/results. */
export interface ToolCall { id: string; name: string; label: string; detail?: string }
export interface Message { id: string; ref_seq: number; role: string; text: string; tool_calls?: ToolCall[]; attachments?: Attachment[]; receipt_id?: string; client_message_id?: string }
export interface Event { type?: 'event'; event_id: number; cursor: string; kind: string; thread_id: string; ref: string; version: number }
export interface HttpReply { status: number; body: unknown; retryAfterMs?: number }
export interface BinaryReply { status: number; body: Uint8Array }
export interface HttpTransport { request(method: string, path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<HttpReply>; upload?(path: string, token: string, name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<HttpReply>; download?(path: string, token: string, signal?: AbortSignal): Promise<BinaryReply> }
export interface Socket { onMessage(handler: (data: string) => void): void; onClose(handler: () => void): void; close(): void; send?(data: string): void }
export interface SocketFactory { connect(path: string, token: string, signal: AbortSignal): Promise<Socket> }
export type ConnectionState = 'connecting' | 'syncing' | 'online' | 'retrying' | 'suspended' | 'blocked';
export interface Options { http: HttpTransport; socket: SocketFactory; token: () => string; onChange?: () => void; onError?: (error: Error) => void; onConnectionState?: (state: ConnectionState) => void; backoffMs?: number[]; requestTimeoutMs?: number; connectTimeoutMs?: number; livenessMs?: number }
export class ProtocolError extends Error { constructor(message: string) { super(message); this.name = 'ProtocolError' } }
export class ResyncRequired extends ProtocolError { constructor(message: string) { super(message); this.name = 'ResyncRequired' } }
export class ExpiredCursor extends ResyncRequired { constructor() { super('expired sync cursor'); this.name = 'ExpiredCursor' } }
const diagnosticRoute = (path: string): string => {
  const clean=path.split('?')[0];
  if(['/v1/capabilities','/v1/snapshot','/v1/sync'].includes(clean))return clean;
  if(/^\/v1\/receipts\/[^/]+$/.test(clean))return '/v1/receipts/:id';
  if(/^\/v1\/threads\/[^/]+\/messages$/.test(clean))return '/v1/threads/:id/messages';
  if(/^\/v1\/threads\/[^/]+\/read$/.test(clean))return '/v1/threads/:id/read';
  return 'API';
};
export class HttpError extends ProtocolError {
  readonly route: string;
  constructor(readonly status: number, readonly retryAfterMs?: number, path = '') {
    super('HTTP ' + status + (path ? ' ' + path : '')); this.name = 'HttpError'; this.route=diagnosticRoute(path);
  }
}
export class TimeoutError extends Error { constructor(message: string) { super(message); this.name = 'TimeoutError' } }
/** Safe, ephemeral UI diagnostic. Never include native error text, URLs, IDs or response bodies. */
export function connectionFailure(error: unknown): string {
  if(error instanceof HttpError)return `HTTP ${error.status} · ${error.route}`;
  if(error instanceof TimeoutError) {
    if(error.message==='hello timed out')return 'WebSocket 握手超时';
    if(error.message==='WebSocket liveness timed out')return 'WebSocket 心跳超时';
    return 'HTTP 请求超时';
  }
  if(error instanceof ProtocolError)return '协议校验失败';
  if(error instanceof TypeError)return '网络传输失败';
  if(error instanceof Error && error.message==='WebSocket 连接失败')return 'WebSocket 连接失败';
  return '连接异常';
}
export const isRetryableError = (error: unknown): boolean => error instanceof HttpError ? error.status === 429 || error.status >= 500 : error instanceof TimeoutError || (!(error instanceof ProtocolError) && !(error instanceof SyntaxError) && error instanceof Error && error.message !== 'aborted');
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
const validSummary = (v: unknown): ThreadSummary => { const x = validThread(v) as unknown as ThreadSummary; num(x.last_ref); num(x.read_ref); num(x.unread_count); if(x.active_receipts!==undefined)x.active_receipts=arr(x.active_receipts).map(validReceipt);if(x.pending_interactions!==undefined)x.pending_interactions=arr(x.pending_interactions).map(validInteraction);return x };
const validChannel = (v: unknown): Channel => { const x = obj(v); str(x.id); str(x.name); return x as unknown as Channel };
const validEvent = (v: unknown): Event => { const x = obj(v); const event_id = num(x.event_id); const kind=str(x.kind); if (!event_id || !['channel','thread','message','receipt','read','interaction','attachment'].includes(kind)) throw new ProtocolError('invalid event'); return { event_id, cursor: str(x.cursor), kind, thread_id: str(x.thread_id), ref: str(x.ref), version: num(x.version) } };
const validAttachment = (v: unknown): Attachment => { const x=obj(v), state=str(x.state); if (!['available','missing','deleted'].includes(state)) throw new ProtocolError('invalid attachment'); const a:Attachment={id:str(x.id),thread_id:str(x.thread_id),state:state as Attachment['state']}; if(state!=='deleted') {a.name=str(x.name);a.mime=str(x.mime);a.size=num(x.size);a.receipt_id=x.receipt_id===null?null:str(x.receipt_id)} return a };
const validInteraction = (v: unknown): Interaction => { const x=obj(v), kind=str(x.kind), state=str(x.state); if(!['approval','clarify'].includes(kind)||!['pending','settled','expired'].includes(state)) throw new ProtocolError('invalid interaction'); return {id:str(x.id),kind:kind as Interaction['kind'],thread_id:str(x.thread_id),receipt_id:str(x.receipt_id),generation:str(x.generation),prompt:str(x.prompt),choices:arr(x.choices).map(str),state:state as Interaction['state']} };
const displayString = (value: unknown, max: number): string => { const s = str(value); if (!s || s.length > max) throw new ProtocolError('invalid tool display'); return s };
const validToolCalls = (value: unknown): ToolCall[] => {
  const calls = arr(value);
  if (calls.length > 128) throw new ProtocolError('too many tool calls');
  const ids = new Set<string>();
  return calls.map(value => {
    const x = obj(value), id = displayString(x.id, 200);
    if (ids.has(id)) throw new ProtocolError('duplicate tool call');
    ids.add(id);
    return { id, name: displayString(x.name, 200), label: displayString(x.label, 240),
      ...(x.detail === undefined ? {} : { detail: displayString(x.detail, 4000) }) };
  });
};
const validMessage = (v: unknown): Message => { const x = obj(v); return { id: str(x.id), ref_seq: num(x.ref_seq), role: str(x.role), text: str(x.text), ...(x.role === 'assistant' && x.tool_calls !== undefined ? {tool_calls:validToolCalls(x.tool_calls)} : {}), ...(x.receipt_id == null ? {} : {receipt_id:str(x.receipt_id)}), ...(x.client_message_id == null ? {} : {client_message_id:str(x.client_message_id)}), attachments:x.attachments===undefined?[]:arr(x.attachments).map(validAttachment) } };
const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve,reject) => {
  if (signal.aborted) return reject(new Error('aborted'));
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms);
  const abort = () => { clearTimeout(timer); reject(new Error('aborted')) };
  signal.addEventListener('abort', abort, { once: true });
});
const timeout = (value: number | undefined, fallback: number): number => value === undefined ? fallback : Math.max(1, value);
// Even if an adapter ignores abort, its late promise cannot mutate SDK state.
const bounded = async <T>(start: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal, late?: (value: T) => void): Promise<T> => {
  const controller = new AbortController();
  let done = false;
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, {once:true});
  if (parent?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (controller.signal.aborted) throw new Error('aborted');
    return await new Promise<T>((resolve,reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
      timer=setTimeout(() => { reject(new TimeoutError('operation timed out')); controller.abort() },ms);
      Promise.resolve().then(() => start(controller.signal)).then(value => {
        if (done || controller.signal.aborted) { late?.(value); return }
        resolve(value);
      },reject);
    });
  } finally { done=true; clearTimeout(timer); parent?.removeEventListener('abort',abort); controller.abort() }
};

export class HermesClient {
  readonly channels = new Map<string, Channel>();
  readonly threads = new Map<string, ThreadSummary>();
  readonly receipts = new Map<string, Receipt>();
  private receiptIdentity = new Map<string, string>();
  readonly interactions = new Map<string, Interaction>();
  readonly attachments = new Map<string, Attachment>();
  readonly messages = new Map<string, Message[]>();
  readonly drafts = new Map<string, string>(); // ephemeral stream text; never merged into durable history
  cursor: string | null = null;
  lastEventId = 0;
  private socket: Socket | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private replay: { job: Promise<void>; signal?: AbortSignal } | null = null;
  private versions = new Map<string, number>();
  private fetchSequence = 0;
  private entitySequence = new Map<string, number>();
  private projectionEpoch = 0;
  private _connectionState: ConnectionState = 'suspended';
  get connectionState(): ConnectionState { return this._connectionState }
  private capabilitiesReady = false;
  private boundToken: string | null = null;
  supportsLatest = false;
  supportsSendIdentity = false;
  readonly tailIncomplete = new Set<string>();
  private knownEmptyThreads = new Set<string>();
  constructor(private readonly options: Options) {}
  private changed() { this.options.onChange?.() }
  private state(next: ConnectionState) { if(this._connectionState!==next) { this._connectionState=next; this.options.onConnectionState?.(next) } }
  private token(): string {
    const token=this.options.token();
    if(!token)throw new ProtocolError('missing token');
    // A new credential may mean a different owner. Never reuse old projections.
    if(this.boundToken!==null && token!==this.boundToken)throw new ProtocolError('credential changed; create a new client');
    this.boundToken=token;return token;
  }
  private storeReceipt(receipt: Receipt) {
    const previous=this.receipts.get(receipt.id);
    const identity=JSON.stringify([receipt.thread_id,receipt.client_message_id]);
    if (this.receiptIdentity.has(receipt.id) && this.receiptIdentity.get(receipt.id)!==identity) throw new ProtocolError('receipt identity mismatch');
    this.receiptIdentity.set(receipt.id,identity);
    const stage=(state: ReceiptState) => state==='queued'?0:state==='running'?1:2;
    if (!previous || stage(receipt.state)>stage(previous.state) || previous.state===receipt.state) {
      this.receipts.set(receipt.id,receipt); this.changed();
    }
  }
  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new Error('aborted');
    const token = this.token();
    const response = await bounded(s => this.options.http.request(method, path, token, body, s),timeout(this.options.requestTimeoutMs,15000),signal);
    if (signal?.aborted) throw new Error('aborted');
    if (response.status === 400 && (path.startsWith('/v1/sync') || path.startsWith('/v1/snapshot'))) throw new ResyncRequired('invalid sync or snapshot cursor');
    // The plugin returns the same 400 for malformed, foreign and future cursors.
    // Only an explicit expiry code can authorize an automatic projection reset.
    if (response.status === 410 && path.startsWith('/v1/sync') && response.body && typeof response.body === 'object' && (response.body as Record<string,unknown>).code === 'cursor_expired') throw new ExpiredCursor();
    if (response.status < 200 || response.status >= 300) throw new HttpError(response.status,response.retryAfterMs,path.split('?')[0]);
    return obj(response.body);
  }
  async capabilities(signal?: AbortSignal) { const x = await this.call('GET','/v1/capabilities',undefined,signal); if (x.protocol !== 1 || x.durable_sync !== true) throw new ProtocolError('unsupported protocol'); this.supportsLatest=x.history_latest===true; this.supportsSendIdentity=x.message_send_identity===true; this.capabilitiesReady=true; return x }
  async listChannels(signal?: AbortSignal): Promise<Channel[]> {
    const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('GET','/v1/channels',undefined,signal);
    const channels = arr(x.channels).map(validChannel);
    if (epoch===this.projectionEpoch && seq >= (this.entitySequence.get('channels') || 0)) { this.channels.clear(); channels.forEach(c => this.channels.set(c.id,c)); this.entitySequence.set('channels',seq); this.changed() }
    return channels;
  }
  async createChannel(name: string, description = ''): Promise<Channel> { const x = await this.call('POST','/v1/channels',{name,description}); const c = validChannel(x.channel); this.channels.set(c.id,c); this.changed(); return c }
  async updateChannel(id: string, patch: {name?: string; description?: string}): Promise<Channel> { const x = await this.call('PATCH','/v1/channels/'+idPath(id),patch); const c = validChannel(x.channel); this.channels.set(id,c); this.changed(); return c }
  async deleteChannel(id: string): Promise<void> { const x = await this.call('DELETE','/v1/channels/'+idPath(id)); if (x.deleted !== true) throw new ProtocolError('delete not confirmed'); this.channels.delete(id); this.changed() }
  async listThreads(channelId: string, after?: string, limit = 50) { const x = await this.call('GET','/v1/channels/'+idPath(channelId)+'/threads'+query({after,limit})); return {threads: arr(x.threads).map(validThread),next_cursor:optionalCursor(x.next_cursor)} }
  async createThread(channelId: string, title: string): Promise<Thread> { const x = await this.call('POST','/v1/channels/'+idPath(channelId)+'/threads',{title}); return validThread(x.thread) }
  async getThread(id: string, rank = this.lastEventId, signal?: AbortSignal): Promise<Thread> {
    const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('GET','/v1/threads/'+idPath(id),undefined,signal); const thread = validThread(x.thread);
    const key = 'thread:'+id;
    if (epoch===this.projectionEpoch && rank >= (this.versions.get(key) || 0) && seq >= (this.entitySequence.get(key) || 0)) {
      const old = this.threads.get(id); this.threads.set(id,{...old,...thread,last_ref:old?.last_ref || 0,read_ref:old?.read_ref || 0,unread_count:old?.unread_count || 0});
      this.versions.set(key,rank); this.entitySequence.set(key,seq); this.changed();
    }
    return thread;
  }
  async updateThread(id: string, patch: {title?: string; archived?: boolean}): Promise<Thread> { const x = await this.call('PATCH','/v1/threads/'+idPath(id),patch); const t = validThread(x.thread); await this.getThread(id); return t }
  async archiveThread(id: string): Promise<Thread> { const x = await this.call('DELETE','/v1/threads/'+idPath(id)); const t=validThread(x.thread); await this.getThread(id); return t }
  async send(threadId: string, clientMessageId: string, text: string, attachments: string[] = [], signal?: AbortSignal): Promise<Receipt> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(clientMessageId) || (!text.trim() && !attachments.length)) throw new ProtocolError('invalid send');
    if(attachments.length>8 || new Set(attachments).size!==attachments.length || attachments.some(a=>!a.startsWith('att_'))) throw new ProtocolError('invalid attachments');
    const epoch=this.projectionEpoch;
    const x = await this.call('POST','/v1/threads/'+idPath(threadId)+'/messages',{client_message_id:clientMessageId,text,...(attachments.length?{attachments:[...attachments]}:{})},signal);
    const r = validReceipt(x.receipt);
    if (r.thread_id !== threadId || r.client_message_id !== clientMessageId) throw new ProtocolError('receipt identity mismatch');
    if(epoch!==this.projectionEpoch)return r;
    this.storeReceipt(r); return this.receipts.get(r.id)!;
  }
  async getReceipt(id: string, signal?: AbortSignal): Promise<Receipt> { const epoch=this.projectionEpoch; const x=await this.call('GET','/v1/receipts/'+idPath(id),undefined,signal); const r=validReceipt(x.receipt); if (r.id!==id) throw new ProtocolError('receipt identity mismatch'); if(epoch!==this.projectionEpoch)return r; this.storeReceipt(r); return this.receipts.get(id)! }
  async getInteraction(threadId:string,id:string,signal?:AbortSignal):Promise<Interaction> {const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/interactions/'+idPath(id),undefined,signal);const item=validInteraction(x.interaction);if(item.id!==id||item.thread_id!==threadId)throw new ProtocolError('interaction identity mismatch');if(item.state==='pending')this.interactions.set(id,item);else this.interactions.delete(id);this.changed();return item}
  async answerInteraction(item:Interaction,choice:string):Promise<void> {const x=await this.call('POST','/v1/threads/'+idPath(item.thread_id)+'/interactions/'+idPath(item.id)+'/answer',{choice,receipt_id:item.receipt_id,generation:item.generation});if(x.state!=='settled'||x.request_id!==item.id)throw new ProtocolError('answer not settled');this.interactions.delete(item.id);this.changed()}
  async stop(threadId:string):Promise<boolean> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/stop',{});return x.stopped===true}
  async cancelQueued(threadId:string,receiptId:string):Promise<Receipt> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/receipts/'+idPath(receiptId)+'/cancel',{});const r=validReceipt(x.receipt);this.storeReceipt(r);return r}
  async upload(threadId:string,name:string,bytes:Uint8Array,signal?:AbortSignal):Promise<Attachment> {if(!this.options.http.upload)throw new ProtocolError('binary upload unavailable');const reply=await bounded(s=>this.options.http.upload!('/v1/threads/'+idPath(threadId)+'/attachments',this.token(),name,bytes,s),timeout(this.options.requestTimeoutMs,15000),signal);if(reply.status!==201)throw new HttpError(reply.status,reply.retryAfterMs,'upload');const x=obj(reply.body),raw=obj(x.attachment);const a=validAttachment({...raw,state:'available',receipt_id:null});if(a.thread_id!==threadId)throw new ProtocolError('attachment thread mismatch');this.attachments.set(a.id,a);this.changed();return a}
  async getAttachment(threadId:string,id:string,signal?:AbortSignal):Promise<Attachment> {const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id)+'/metadata',undefined,signal);const a=validAttachment(x.attachment);if(a.id!==id||a.thread_id!==threadId)throw new ProtocolError('attachment identity mismatch');this.attachments.set(id,a);this.changed();return a}
  async download(threadId:string,id:string,signal?:AbortSignal):Promise<Uint8Array> {if(!this.options.http.download)throw new ProtocolError('binary download unavailable');const reply=await bounded(s=>this.options.http.download!('/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id),this.token(),s),timeout(this.options.requestTimeoutMs,15000),signal);if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,undefined,'download');return reply.body}
  async deleteUnattached(threadId:string,id:string):Promise<void> {const x=await this.call('DELETE','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id));if(x.deleted!==true)throw new ProtocolError('delete not confirmed');this.attachments.set(id,{id,thread_id:threadId,state:'deleted'});this.changed()}
  async search(threadId:string,text:string,after?:string,limit=20,signal?:AbortSignal) {const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/search'+query({q:text,after,limit}),undefined,signal);return {messages:arr(x.messages).map(validMessage),next_cursor:optionalCursor(x.next_cursor)}}
  async history(threadId: string, after?: string, limit = 50, signal?: AbortSignal, afterRefSeq?:number) {
    const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query({after,after_ref_seq:afterRefSeq,limit}),undefined,signal);
    const page=arr(x.messages).map(validMessage); const existing=this.messages.get(threadId)||[];
    if(!page.length && !existing.length && after===undefined && afterRefSeq===undefined && x.next_cursor===null) this.knownEmptyThreads.add(threadId);
    if(page.length) this.knownEmptyThreads.delete(threadId);
    const byRef=new Map(existing.map(m=>[m.ref_seq,m])); page.forEach(m=>byRef.set(m.ref_seq,m));
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq)); this.changed();
    for(const m of page)for(const a of m.attachments||[])this.attachments.set(a.id,a);
    return {messages:page,next_cursor:optionalCursor(x.next_cursor),incomplete_turns:arr(x.incomplete_turns),turn_outcomes:arr(x.turn_outcomes)};
  }
  async historyWindow(threadId: string, before?: string, limit = 30, signal?: AbortSignal) {
    if (!this.supportsLatest) throw new ProtocolError('latest history unavailable');
    const x = await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query({latest:before?undefined:'true',before,limit}),undefined,signal);
    const page = arr(x.messages).map(validMessage);
    const byRef = new Map((this.messages.get(threadId)||[]).map(m=>[m.ref_seq,m]));
    page.forEach(m=>byRef.set(m.ref_seq,m));
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq));
    if(!before && !page.length) this.knownEmptyThreads.add(threadId);
    if(page.length) this.knownEmptyThreads.delete(threadId);
    for(const m of page)for(const a of m.attachments||[])this.attachments.set(a.id,a);
    this.changed();
    return {messages:page,older_cursor:optionalCursor(x.older_cursor)};
  }
  async historyAll(threadId: string, signal?: AbortSignal) {
    let after: string | null = null;
    do { const page=await this.history(threadId,after || undefined,100,signal); after=page.next_cursor } while(after);
    return this.messages.get(threadId) || [];
  }
  async historyTail(threadId:string,signal?:AbortSignal) {
    if(this.tailIncomplete.has(threadId)) throw new ProtocolError('message catch-up paused; locate latest in thread');
    const last=this.messages.get(threadId)?.at(-1)?.ref_seq;
    // No known anchor: forward-only history starts at the OLDEST row. Do not
    // silently download an unbounded transcript for a background event.
    if (!last) {
      if(this.supportsLatest) { await this.historyWindow(threadId,undefined,30,signal); return this.messages.get(threadId)||[]; }
      if(!this.knownEmptyThreads.has(threadId)) return this.messages.get(threadId)||[];
      const page=await this.history(threadId,undefined,100,signal);
      if(page.next_cursor) {
        this.tailIncomplete.add(threadId); this.changed();
        throw new ProtocolError('message catch-up exceeds empty-thread page; locate latest in thread');
      }
      return this.messages.get(threadId)||[];
    }
    let cursor: string | null=null;
    for(let i=0;i<3;i++) {
      const page=await this.history(threadId,cursor??undefined,100,signal,cursor?undefined:last);
      cursor=page.next_cursor;
      if(!cursor) return this.messages.get(threadId)||[];
    }
    // Keep the event unacknowledged so reconnect can retry after explicit
    // user-driven history location; never silently claim a complete tail.
    this.tailIncomplete.add(threadId); this.changed();
    throw new ProtocolError('message catch-up exceeds 300 refs; locate latest in thread');
  }
  /** Only after an explicit complete forward history traversal by the caller. */
  resumeTail(threadId:string) { if(this.tailIncomplete.delete(threadId)) this.changed() }
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
    const epoch=this.projectionEpoch;
    let after: string|null=null; let earliest: string|null=null; const pages: ThreadSummary[]=[];
    do { const x=await this.call('GET','/v1/snapshot'+query({after,limit:100}),undefined,signal); if (earliest===null) earliest=str(x.waterline); pages.push(...arr(x.threads).map(validSummary)); after=optionalCursor(x.next_after) } while(after);
    if (signal?.aborted || epoch!==this.projectionEpoch) throw new Error('aborted');
    await this.listChannels(signal);
    if (signal?.aborted || epoch!==this.projectionEpoch) throw new Error('aborted');
    for (const t of pages) { const key='thread:'+t.id; if ((this.versions.get(key)||0)===0) this.threads.set(t.id,t); for(const r of t.active_receipts||[])this.storeReceipt(r);for(const item of t.pending_interactions||[])this.interactions.set(item.id,item) }
    this.cursor=earliest; this.lastEventId=0; this.changed();
  }
  private async applyEvent(event: Event, signal?: AbortSignal) {
    if (event.event_id<=this.lastEventId) return;
    if (this.lastEventId && event.event_id!==this.lastEventId+1) throw new ResyncRequired('event gap');
    const key=event.kind+':'+event.thread_id+':'+event.ref;
    if (event.version>(this.versions.get(key)||0)) {
      if (event.kind==='channel') await this.listChannels(signal);
      else if (event.kind==='thread') await this.getThread(event.thread_id,event.event_id,signal);
      else if (event.kind==='message') { await this.historyTail(event.thread_id,signal); await this.refreshSummaries(event.event_id,signal) }
      else if (event.kind==='receipt') await this.getReceipt(event.ref,signal);
      else if (event.kind==='interaction') await this.getInteraction(event.thread_id,event.ref,signal);
      else if (event.kind==='attachment') await this.getAttachment(event.thread_id,event.ref,signal);
      else if (event.kind==='read') await this.refreshSummaries(event.event_id,signal);
      if (signal?.aborted) throw new Error('aborted');
      this.versions.set(key,event.version);
    }
    if (signal?.aborted) throw new Error('aborted');
    this.lastEventId=event.event_id; this.cursor=event.cursor;
  }
  async catchUp(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('aborted');
    if (this.replay?.signal?.aborted) this.replay=null;
    if (this.replay) { await this.replay.job; return this.catchUp(signal) }
    const job=(async()=>{ if (this.cursor===null) await this.snapshot(signal); let more=true; while(more) {
      const x=await this.call('GET','/v1/sync'+query({cursor:this.cursor,limit:200}),undefined,signal);
      const events=arr(x.events).map(validEvent); str(x.waterline); const next=str(x.next_cursor); more=x.has_more===true;
      for (const event of events) await this.applyEvent(event,signal);
      if (!events.length && next!==this.cursor) throw new ResyncRequired('empty page advanced cursor');
      if (events.length && next!==this.cursor) throw new ResyncRequired('page cursor mismatch');
      if (more && !events.length) throw new ResyncRequired('empty continuation page');
    } })(); const replay={job,signal}; this.replay=replay; try { await job } finally { if (this.replay===replay) this.replay=null }
  }
  /** Explicit resync after ResyncRequired; never silently rewinds a foreign/future cursor. */
  async resync(signal?: AbortSignal) { ++this.projectionEpoch; this.cursor=null; this.lastEventId=0; this.versions.clear(); this.entitySequence.clear(); this.channels.clear(); this.threads.clear(); this.receipts.clear(); this.messages.clear(); this.interactions.clear(); this.attachments.clear(); this.tailIncomplete.clear(); this.knownEmptyThreads.clear(); await this.snapshot(signal); await this.catchUp(signal) }
  /** Starts one recovery loop; resolves immediately, not as a readiness signal. */
  async connect(): Promise<void> {
    if (this.controller) return;
    const controller=new AbortController(); this.controller=controller;
    const gen=++this.generation; this.state('connecting'); void this.run(gen,controller);
  }
  /** Optional fast path after foreground/network changes; ordinary recovery needs no click. */
  async retryNow(): Promise<void> { this.close(); await this.connect() }
  private async live(socket: Socket, gen: number, attempt: AbortController, stable: () => void): Promise<void> {
    const signal=attempt.signal;
    await new Promise<void>((resolve,reject) => {
      let done=false, hello=false, onlineReady=false, awaitingPong=false, dirty=false, replayJob: Promise<void> | null=null;
      let helloTimer: ReturnType<typeof setTimeout> | undefined;
      const active=()=>!done && !signal.aborted && gen===this.generation;
      const finish=(error?: unknown) => {
        if(done)return; done=true; clearTimeout(helloTimer); signal.removeEventListener('abort',abort); attempt.abort();
        if(error)reject(error);else resolve();
      };
      const abort=()=>finish();
      const replayNow=(): Promise<void> => {
        if(!active())return Promise.resolve();
        dirty=true;
        // Initial hello/catch-up gates online. Once established, a healthy
        // socket stays usable while durable events/read receipts replay.
        if(!onlineReady)this.state('syncing');
        if(!replayJob) replayJob=Promise.resolve().then(async()=>{
          try {
            // Frames and periodic checks share one replay owner. A burst only
            // requests one extra pass, rather than queuing a pass per frame.
            while(dirty && active()) {dirty=false;await this.catchUp(signal)}
            if(active()) {onlineReady=true;this.state('online')}
          } catch(e) {finish(e)}
          finally {replayJob=null}
        });
        return replayJob;
      };
      signal.addEventListener('abort',abort,{once:true});
      helloTimer=setTimeout(()=>finish(new TimeoutError('hello timed out')),timeout(this.options.connectTimeoutMs,10000));
      socket.onClose(()=>finish());
      socket.onMessage(data => {
        if(!active())return;
        try {
          if(data==='pong') { if(!hello)throw new ProtocolError('pong before hello'); if(awaitingPong)stable(); awaitingPong=false; return }
          const x=obj(JSON.parse(data));
          if(x.type==='hello') {
            if(hello || x.protocol!==1 || x.durable_sync!==true)throw new ProtocolError('invalid hello');
            hello=true; clearTimeout(helloTimer);
            // Close the HTTP->WS handoff gap before advertising online.
            replayNow();
            return;
          }
          if(!hello || x.type!=='event')throw new ProtocolError('invalid socket frame');
          validEvent(x);
          replayNow();
        } catch(e) {finish(e)}
      });
      if(signal.aborted)finish();
      void (async()=>{
        const interval=timeout(this.options.livenessMs,30000);
        while(active()) {
          try { await wait(interval,signal) } catch { break }
          if(!active())break;
          if(!hello)continue;
          if(socket.send && awaitingPong) {finish(new TimeoutError('WebSocket liveness timed out'));break}
          try {
            // Durable replay repairs missed frames even if the TCP socket is half-open.
            await replayNow();
            if(!active())break;
            if(socket.send) {awaitingPong=true;socket.send('ping')}
            else { // Adapters without ping support rotate the socket periodically.
              stable();finish();break;
            }
          } catch(e) {finish(e);break}
        }
      })();
    });
  }
  private async run(gen: number, controller: AbortController) {
    const signal=controller.signal; let attempt=0, expiryResets=0, resetPending=false;
    const delays=this.options.backoffMs?.length ? this.options.backoffMs : [200,500,1000,2000,5000];
    try { while(!signal.aborted && gen===this.generation) {
      let socket: Socket | null=null, failure: unknown=null;
      const owner=new AbortController();
      const abort=()=>owner.abort();signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)owner.abort();
      const attemptSignal=owner.signal;
      try {
        this.state(attempt ? 'retrying' : 'connecting');
        if(!this.capabilitiesReady)await this.capabilities(attemptSignal);
        this.state('syncing');
        if(resetPending) {resetPending=false;await this.resync(attemptSignal)}
        else await this.catchUp(attemptSignal);
        if(attemptSignal.aborted || gen!==this.generation)break;
        const cursor=this.cursor; if(!cursor)throw new ProtocolError('missing cursor');
        const opened=await bounded(s=>this.options.socket.connect('/v1/events'+query({cursor}),this.token(),s),timeout(this.options.connectTimeoutMs,10000),attemptSignal,s=>s.close());
        if(attemptSignal.aborted || gen!==this.generation) {opened.close();break}
        socket=opened; this.socket=socket;
        await this.live(socket,gen,owner,()=>{attempt=0;expiryResets=0});
      } catch(e) {failure=e}
      finally {owner.abort();signal.removeEventListener('abort',abort);socket?.close();if(this.socket===socket)this.socket=null}
      if(signal.aborted || gen!==this.generation)break;
      if(failure instanceof ExpiredCursor && expiryResets<2) {
        // A 410 is authoritative, but a broken server must not reset forever.
        // Successful liveness clears the budget for future genuine expiries.
        expiryResets++;resetPending=true;continue;
      }
      if(failure) {
        const error=failure instanceof Error ? failure : new Error(String(failure));
        this.options.onError?.(error);
        if(!isRetryableError(error)) {this.state(error instanceof HttpError && (error.status===401||error.status===403) || error instanceof ProtocolError && (error.message==='missing token'||error.message.startsWith('credential changed')) ? 'blocked':'suspended');break}
      }
      this.state('retrying');
      const base=delays[Math.min(attempt++,delays.length-1)];
      const jitter=Math.max(0,Math.floor(base*(.75+Math.random()*.5)));
      const retryAfter=failure instanceof HttpError && failure.status===429 ? failure.retryAfterMs || 0 : 0;
      try {await wait(Math.max(jitter,retryAfter),signal)}catch {break}
    } } finally {if(this.controller===controller)this.controller=null}
  }
  close() {++this.generation;this.controller?.abort();this.controller=null;this.socket?.close();this.socket=null;this.drafts.clear();this.state('suspended') }
}
