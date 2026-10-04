/** P1-03 owner-scoped transport. No runtime imports or platform globals. */
import { createWorkspaceApi, type ConditionalHeaders, type WorkspaceApi } from './workspace';
export { utf8Size, workspacePath } from './workspace';
export type { ConditionalHeaders, WorkspaceApi, WorkspaceState, WorkspaceEntry, WorkspacePage, AgentsDocument, ChannelAttachmentPage } from './workspace';
export type ReceiptState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' | 'received';
export type ReceiptProcessing = 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' | null;
export interface Receipt { id: string; client_message_id: string; thread_id: string; state: ReceiptState; durable: true; version?: number; ref_seq?: number; admission?: 'followup'; handed_off?: true; processing?: ReceiptProcessing; feedback?: string }
export interface Thread { id: string; project_id: string; title: string; archived: number | boolean; markers?: string[]; markers_updated_at?: number; [key: string]: unknown }
export interface ThreadSummary { id: string; project_id: string; title: string; archived: number | boolean; markers?: string[]; markers_updated_at?: number; last_ref: number; read_ref: number; unread_count: number; running?: boolean; completed_unread?: boolean; result_version?: number; result_ref?: number; last_message_at?: number; active_receipts?: Receipt[]; pending_interactions?: Interaction[] }
export interface Channel { id: string; name: string; description?: string; [key: string]: unknown }
export interface AgentModelSettings { scope: 'connected-default'; provider: string; model: string; providers: {id: string; name: string; models: string[]}[] }
export interface ModelSelectionConfirmation { confirmation_required: true; warning: string; provider: string; model: string }
export interface Attachment { id: string; thread_id: string; name?: string; mime?: string; size?: number; receipt_id?: string | null; public_url?: string; state: 'available' | 'missing' | 'deleted' }
export interface Interaction { id: string; kind: 'approval' | 'clarify'; thread_id: string; receipt_id: string; generation: string; prompt: string; choices: string[]; state: 'pending' | 'settled' | 'expired' }
/** Display-only summaries from the authenticated server, never raw tool arguments/results. */
export interface ToolCall { id: string; name: string; label: string; detail?: string; caption?: string; icon?: string }
export interface Message { id: string; ref_seq: number; role: string; text: string; created_at?: number; display_kind?: 'direct' | 'final' | 'system_notice'; tool_calls?: ToolCall[]; attachments?: Attachment[]; receipt_id?: string; client_message_id?: string }
export interface Event { type?: 'event'; event_id: number; cursor: string; kind: string; thread_id: string; ref: string; version: number }
export interface HttpReply { status: number; body: unknown; retryAfterMs?: number }
export interface BinaryReply { status: number; body: Uint8Array }
export interface HttpTransport { request(method: string, path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<HttpReply>; conditionalRequest?(method: string, path: string, token: string, headers: ConditionalHeaders, body?: unknown, signal?: AbortSignal): Promise<HttpReply>; upload?(path: string, token: string, name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<HttpReply>; download?(path: string, token: string, signal?: AbortSignal): Promise<BinaryReply> }
export interface Socket { onMessage(handler: (data: string) => void): void; onClose(handler: () => void): void; close(): void; send?(data: string): void }
export interface SocketFactory { connect(path: string, token: string, signal: AbortSignal): Promise<Socket> }
export type ConnectionState = 'connecting' | 'syncing' | 'online' | 'retrying' | 'suspended' | 'blocked';
export interface ClientCheckpoint {
  schema: 1;
  cursor: string | null;
  lastEventId: number;
  channels: Channel[];
  threads: ThreadSummary[];
  receipts: Receipt[];
  interactions: Interaction[];
  attachments: Attachment[];
  messages: Array<[string, Message[]]>;
  versions: Array<[string, number]>;
  fetchSequence: number;
  entitySequence: Array<[string, number]>;
  messageSequence: Array<[string, number]>;
  knownEmptyThreads: string[];
}
export interface Options { http: HttpTransport; socket: SocketFactory; token: () => string; onChange?: () => void; onCheckpoint?: (checkpoint: ClientCheckpoint) => Promise<void>; onResync?: () => void; onError?: (error: Error) => void; onConnectionState?: (state: ConnectionState) => void; onRetryScheduled?: (retryAt: number | null) => void; backoffMs?: number[]; requestTimeoutMs?: number; connectTimeoutMs?: number; livenessMs?: number }
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
    if(error.message==='hello timed out')return 'WebSocket handshake timed out';
    if(error.message==='WebSocket liveness timed out')return 'WebSocket liveness timed out';
    return 'HTTP request timed out';
  }
  if(error instanceof ProtocolError)return 'Protocol validation failed';
  if(error instanceof TypeError)return 'Network transport failed';
  if(error instanceof Error && error.message==='WebSocket connection failed')return 'WebSocket connection failed';
  return 'Connection error';
}
export const isRetryableError = (error: unknown): boolean => error instanceof HttpError ? error.status === 429 || error.status >= 500 : error instanceof TimeoutError || (!(error instanceof ProtocolError) && !(error instanceof SyntaxError) && error instanceof Error && error.message !== 'aborted');
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProtocolError('invalid object'); return v as Record<string, unknown> };
const str = (v: unknown): string => { if (typeof v !== 'string') throw new ProtocolError('invalid string'); return v };
const num = (v: unknown): number => { if (!Number.isSafeInteger(v) || (v as number) < 0) throw new ProtocolError('invalid integer'); return v as number };
// Display-only UNIX seconds; absent on legacy servers. Never use it for message order.
const timestamp = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 8.64e12) throw new ProtocolError('invalid message timestamp'); return v };
const arr = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new ProtocolError('invalid array'); return v };
const optionalCursor = (v: unknown): string | null => v === null ? null : str(v);
const idPath = (id: string): string => encodeURIComponent(id);
const query = (items: Record<string, string | number | null | undefined>): string => {
  const values = Object.entries(items).filter(([,v]) => v !== null && v !== undefined).map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  return values.length ? '?' + values.join('&') : '';
};
const validReceipt = (v: unknown): Receipt => {
  const x = obj(v); const states = ['queued','running','completed','failed','interrupted','unknown','received'];
  if (!states.includes(x.state as string) || x.durable !== true || (x.admission !== undefined && x.admission !== 'followup')) throw new ProtocolError('invalid receipt');
  if (x.handed_off !== undefined && x.handed_off !== true) throw new ProtocolError('invalid receipt');
  if (x.version !== undefined) num(x.version);
  if (x.ref_seq !== undefined && (!Number.isSafeInteger(x.ref_seq) || (x.ref_seq as number) <= 0)) throw new ProtocolError('invalid receipt reference');
  if (x.processing !== undefined && x.processing !== null && !['running','completed','failed','interrupted','unknown'].includes(x.processing as string)) throw new ProtocolError('invalid receipt');
  if (x.feedback !== undefined && (typeof x.feedback !== 'string' || !x.feedback.length || x.feedback.length > 2000)) throw new ProtocolError('invalid receipt');
  return { id: str(x.id), client_message_id: str(x.client_message_id), thread_id: str(x.thread_id), state: x.state as ReceiptState, durable: true, ...(x.version !== undefined ? { version: x.version as number } : {}), ...(x.ref_seq !== undefined ? { ref_seq: x.ref_seq as number } : {}), ...(x.admission === 'followup' ? { admission: 'followup' as const } : {}), ...(x.handed_off === true ? { handed_off: true as const } : {}), ...(x.processing !== undefined ? { processing: x.processing as ReceiptProcessing } : {}), ...(x.feedback !== undefined ? { feedback: x.feedback as string } : {}) };
};
const validThread = (v: unknown): Thread => { const x = obj(v); str(x.id); str(x.project_id); str(x.title); if (typeof x.archived !== 'boolean' && x.archived !== 0 && x.archived !== 1) throw new ProtocolError('invalid thread'); return x as unknown as Thread };
const validSummary = (v: unknown): ThreadSummary => { const x = validThread(v) as unknown as ThreadSummary; num(x.last_ref); num(x.read_ref); num(x.unread_count); if(x.last_message_at!==undefined){try{x.last_message_at=timestamp(x.last_message_at)}catch{delete x.last_message_at}} if(x.active_receipts!==undefined)x.active_receipts=arr(x.active_receipts).map(validReceipt);if(x.pending_interactions!==undefined)x.pending_interactions=arr(x.pending_interactions).map(validInteraction);return x };
const validChannel = (v: unknown): Channel => { const x = obj(v); str(x.id); str(x.name); return x as unknown as Channel };
const validEvent = (v: unknown): Event => { const x = obj(v); const event_id = num(x.event_id); const kind=str(x.kind); if (!event_id || !['channel','thread','message','receipt','read','interaction','attachment'].includes(kind)) throw new ProtocolError('invalid event'); return { event_id, cursor: str(x.cursor), kind, thread_id: str(x.thread_id), ref: str(x.ref), version: num(x.version) } };
const validAttachment = (v: unknown): Attachment => { const x=obj(v), state=str(x.state); if (!['available','missing','deleted'].includes(state)) throw new ProtocolError('invalid attachment'); const a:Attachment={id:str(x.id),thread_id:str(x.thread_id),state:state as Attachment['state']}; if(state!=='deleted') {a.name=str(x.name);a.mime=str(x.mime);a.size=num(x.size);a.receipt_id=x.receipt_id===null?null:str(x.receipt_id)} if(typeof x.public_url==='string') {try {const u=new URL(x.public_url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith('/media/'+a.id+'/'))a.public_url=u.href;}catch{/* Optional links never invalidate durable attachment metadata. */}} return a };
const validInteraction = (v: unknown): Interaction => { const x=obj(v), kind=str(x.kind), state=str(x.state); if(!['approval','clarify'].includes(kind)||!['pending','settled','expired'].includes(state)) throw new ProtocolError('invalid interaction'); return {id:str(x.id),kind:kind as Interaction['kind'],thread_id:str(x.thread_id),receipt_id:str(x.receipt_id),generation:str(x.generation),prompt:str(x.prompt),choices:arr(x.choices).map(str),state:state as Interaction['state']} };
const displayString = (value: unknown, max: number): string => { const s = str(value); if (!s || s.length > max) throw new ProtocolError('invalid tool display'); return s };
const displayLine = (value: unknown, max: number): string => { const s = displayString(value, max); if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(s)) throw new ProtocolError('invalid tool display line'); return s };
const validModelSettings = (x: Record<string, unknown>): AgentModelSettings => {
  if (x.scope !== 'connected-default') throw new ProtocolError('invalid model settings scope');
  const rows = arr(x.providers), ids = new Set<string>();
  if (rows.length > 1000) throw new ProtocolError('too many providers');
  const providers = rows.map(value => {
    const row = obj(value), id = displayString(row.id, 256), models = arr(row.models);
    if (ids.has(id) || models.length > 50000) throw new ProtocolError('invalid provider inventory');
    ids.add(id);
    return {id, name: displayString(row.name, 256), models: models.map(value => displayString(value, 256))};
  });
  return {scope:'connected-default', provider:str(x.provider), model:str(x.model), providers};
};
const validToolCalls = (value: unknown): ToolCall[] => {
  const calls = arr(value);
  if (calls.length > 128) throw new ProtocolError('too many tool calls');
  const ids = new Set<string>();
  return calls.map(value => {
    const x = obj(value), id = displayString(x.id, 200);
    if (ids.has(id)) throw new ProtocolError('duplicate tool call');
    ids.add(id);
    return { id, name: displayString(x.name, 200), label: displayString(x.label, 240),
      ...(x.caption === undefined ? {} : { caption: displayLine(x.caption, 240) }),
      ...(x.icon === undefined ? {} : { icon: displayLine(x.icon, 16) }),
      ...(x.detail === undefined ? {} : { detail: displayString(x.detail, 4000) }) };
  });
};
const validMessage = (v: unknown): Message => {
  const x = obj(v), role = str(x.role);
  if (role === 'system' && x.display_kind !== 'system_notice') throw new ProtocolError('invalid system notice');
  if (x.display_kind === 'system_notice' && role !== 'system') throw new ProtocolError('invalid system notice');
  if (x.display_kind === 'final' && (role !== 'assistant' || typeof x.text !== 'string' || !x.text.trim() ||
    x.tool_calls !== undefined && (!Array.isArray(x.tool_calls) || x.tool_calls.length > 0))) throw new ProtocolError('invalid final reply');
  return { id: str(x.id), ref_seq: num(x.ref_seq), role, text: str(x.text),
    ...(role === 'assistant' && (x.display_kind === 'direct' || x.display_kind === 'final') ? {display_kind: x.display_kind} : {}),
    ...(role === 'system' ? {display_kind: 'system_notice' as const} : {}),
    ...(x.created_at === undefined ? {} : {created_at:timestamp(x.created_at)}),
    ...(role === 'assistant' && x.tool_calls !== undefined ? {tool_calls:validToolCalls(x.tool_calls)} : {}),
    ...(x.receipt_id == null ? {} : {receipt_id:str(x.receipt_id)}),
    ...(x.client_message_id == null ? {} : {client_message_id:str(x.client_message_id)}),
    attachments:x.attachments===undefined?[]:arr(x.attachments).map(validAttachment) };
};
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
  readonly channels: Map<string, Channel>;
  readonly threads: Map<string, ThreadSummary>;
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
  private messageSequence = new Map<string, number>();
  private projectionEpoch = 0;
  private _connectionState: ConnectionState = 'suspended';
  get connectionState(): ConnectionState { return this._connectionState }
  private capabilitiesReady = false;
  get hasCapabilities(): boolean { return this.capabilitiesReady }
  private boundToken: string | null = null;
  supportsLatest = false;
  supportsSendIdentity = false;
  supportsChannelWorkspace = false;
  supportsAttachmentOrigin = false;
  supportsSessionLabels = false;
  readonly workspace: WorkspaceApi;
  readonly tailIncomplete = new Set<string>();
  private tailContinuations = new Map<string, { cursor: string }>();
  private tailRecoveryJobs = new Map<string, { promise: Promise<Message[]>; signal?: AbortSignal }>();
  private knownEmptyThreads = new Set<string>();
  constructor(private readonly options: Options, directory?: Pick<HermesClient, 'channels' | 'threads'>) {
    this.channels = directory?.channels ?? new Map();
    this.threads = directory?.threads ?? new Map();
    this.workspace = createWorkspaceApi((method,path,body,signal,headers) => this.call(method,path,body,signal,headers),
      (path,signal) => this.downloadPath(path,signal), message => new ProtocolError(message));
  }

  checkpoint(): ClientCheckpoint {
    return {
      schema:1,cursor:this.cursor,lastEventId:this.lastEventId,
      channels:[...this.channels.values()],threads:[...this.threads.values()],receipts:[...this.receipts.values()],
      interactions:[...this.interactions.values()],attachments:[...this.attachments.values()],messages:[...this.messages],
      versions:[...this.versions],fetchSequence:this.fetchSequence,entitySequence:[...this.entitySequence],messageSequence:[...this.messageSequence],
      knownEmptyThreads:[...this.knownEmptyThreads],
    };
  }

  /** Restore only into a fresh, owner-scoped client, before any requests. */
  restoreCheckpoint(value: unknown): void {
    if (this.controller || this.cursor !== null || this.fetchSequence !== 0) throw new ProtocolError('client already initialized');
    const x=obj(value);
    if (x.schema !== 1) throw new ProtocolError('unsupported cache schema');
    const cursor=x.cursor===null?null:str(x.cursor),lastEventId=num(x.lastEventId),fetchSequence=num(x.fetchSequence);
    if (cursor===null && lastEventId) throw new ProtocolError('invalid cache checkpoint');
    const unique = <T extends {id:string}>(values: unknown, validate:(value:unknown)=>T): T[] => {
      const rows=arr(values).map(validate);
      if (new Set(rows.map(row=>row.id)).size!==rows.length) throw new ProtocolError('duplicate cache identity');
      return rows;
    };
    const channels=unique(x.channels,validChannel),threads=unique(x.threads,validSummary),receipts=unique(x.receipts,validReceipt);
    const interactions=unique(x.interactions,validInteraction),attachments=unique(x.attachments,validAttachment);
    const messages=arr(x.messages).map(value=>{
      const pair=arr(value); if(pair.length!==2)throw new ProtocolError('invalid cache messages');
      const id=str(pair[0]),rows=unique(pair[1],validMessage);
      if (new Set(rows.map(row=>row.ref_seq)).size!==rows.length) throw new ProtocolError('duplicate cache reference');
      return [id,rows.sort((a,b)=>a.ref_seq-b.ref_seq)] as [string,Message[]];
    });
    if (new Set(messages.map(([id])=>id)).size!==messages.length) throw new ProtocolError('duplicate cache thread');
    const ranks=(value:unknown): Array<[string,number]> => {
      const pairs=arr(value).map(value=>{const pair=arr(value);if(pair.length!==2)throw new ProtocolError('invalid cache rank');return [str(pair[0]),num(pair[1])] as [string,number]});
      if(new Set(pairs.map(([key])=>key)).size!==pairs.length)throw new ProtocolError('duplicate cache rank');
      return pairs;
    };
    const versions=ranks(x.versions),entitySequence=ranks(x.entitySequence),messageSequence=ranks(x.messageSequence);
    if([...entitySequence,...messageSequence].some(([,rank])=>rank>fetchSequence))throw new ProtocolError('invalid cache sequence');
    const knownEmptyThreads=arr(x.knownEmptyThreads).map(str);
    // Validate everything before mutating any live projection.
    this.batchChanges(()=>{
      for(const row of channels)this.channels.set(row.id,row);
      for(const row of threads)this.threads.set(row.id,row);
      for(const row of receipts)this.storeReceipt(row,false);
      for(const row of interactions)if(row.state==='pending')this.interactions.set(row.id,row);
      for(const row of attachments)this.attachments.set(row.id,row);
      for(const [id,rows] of messages)this.messages.set(id,rows);
      this.versions=new Map(versions);this.entitySequence=new Map(entitySequence);this.messageSequence=new Map(messageSequence);
      this.fetchSequence=fetchSequence;this.knownEmptyThreads=new Set(knownEmptyThreads);
      this.cursor=cursor;this.lastEventId=lastEventId;this.changed();
    });
  }

  private notificationDepth = 0;
  private notificationPending = false;
  protected changed() {
    if (this.notificationDepth) { this.notificationPending = true; return }
    this.options.onChange?.();
  }
  // Only batch synchronous projection commits, never hold UI notifications
  // across an HTTP await: one slow session must not hide another's updates.
  protected batchChanges(commit: () => void) {
    this.notificationDepth++;
    try { commit() }
    finally {
      if (--this.notificationDepth === 0 && this.notificationPending) {
        this.notificationPending = false;
        this.options.onChange?.();
      }
    }
  }
  protected state(next: ConnectionState) { if(this._connectionState!==next) { this._connectionState=next; this.options.onConnectionState?.(next) } }
  protected token(): string {
    const token=this.options.token();
    if(!token)throw new ProtocolError('missing token');
    // A new credential may mean a different owner. Never reuse old projections.
    if(this.boundToken!==null && token!==this.boundToken)throw new ProtocolError('credential changed; create a new client');
    this.boundToken=token;return token;
  }
  protected storeReceipt(receipt: Receipt, notify = true) {
    const previous=this.receipts.get(receipt.id);
    const identity=JSON.stringify([receipt.thread_id,receipt.client_message_id]);
    if (this.receiptIdentity.has(receipt.id) && this.receiptIdentity.get(receipt.id)!==identity) throw new ProtocolError('receipt identity mismatch');
    this.receiptIdentity.set(receipt.id,identity);
    if (previous?.ref_seq !== undefined && receipt.ref_seq !== undefined && previous.ref_seq !== receipt.ref_seq) throw new ProtocolError('receipt reference mismatch');
    // All new-server receipt representations carry the durable event version.
    // A delayed history/ACK cannot undo a newer callback, feedback or state.
    if (previous?.version !== undefined && (receipt.version === undefined || receipt.version < previous.version)) return;
    if (previous?.ref_seq !== undefined && receipt.ref_seq === undefined) receipt = { ...receipt, ref_seq: previous.ref_seq };
    const positionAdded = previous && previous.ref_seq === undefined && receipt.ref_seq !== undefined;
    if (positionAdded) previous.ref_seq = receipt.ref_seq;
    const stage=(state: ReceiptState) => state==='queued'?0:state==='running'?1:2;
    if (!previous || stage(receipt.state)>stage(previous.state) || previous.state===receipt.state || previous.state==='unknown' && ['completed','failed','interrupted','received'].includes(receipt.state)) {
      // An older server/late ACK may omit processing; omission is not a callback.
      const keepCallback = previous && (receipt.processing === undefined ||
        ['completed', 'failed', 'interrupted'].includes(previous.processing ?? ''));
      const next = keepCallback
        ? { ...receipt, processing: previous.processing } : receipt;
      if (previous?.feedback && receipt.feedback === undefined) next.feedback = previous.feedback;
      this.receipts.set(receipt.id,next); if (notify) this.changed();
    } else if (previous && receipt.processing !== undefined && receipt.processing !== previous.processing &&
               !['completed', 'failed', 'interrupted'].includes(previous.processing ?? '')) {
      // Terminal lifecycle bookkeeping can lag an actual callback; keep the
      // lifecycle fence but apply the independent callback evidence.
      this.receipts.set(receipt.id, { ...previous, ...(receipt.version !== undefined ? {version:receipt.version} : {}), processing: receipt.processing, ...(receipt.feedback !== undefined ? { feedback: receipt.feedback } : {}) }); if (notify) this.changed();
    } else if (previous && receipt.feedback !== undefined && receipt.feedback !== previous.feedback) {
      this.receipts.set(receipt.id, { ...previous, ...(receipt.version !== undefined ? {version:receipt.version} : {}), feedback: receipt.feedback }); if (notify) this.changed();
    } else {
      if (previous && receipt.version !== undefined) previous.version = receipt.version;
      if (positionAdded && notify) this.changed();
    }
  }
  private historyReceipts(page: readonly Message[], threadId: string, value: unknown): Receipt[] {
    if (value === undefined) return []; // Legacy server: bounded hydration remains.
    const receipts = arr(value).map(validReceipt), seen = new Set<string>();
    if (receipts.length > page.length) throw new ProtocolError('too many history receipts');
    for (const r of receipts) {
      const matches = page.filter(m => m.role === 'user' && m.receipt_id === r.id);
      const message = matches[0];
      if (matches.length !== 1 || r.thread_id !== threadId || r.id !== message.receipt_id ||
          r.client_message_id !== message.client_message_id || r.ref_seq !== message.ref_seq ||
          r.version === undefined || seen.has(r.id)) throw new ProtocolError('history receipt identity mismatch');
      const identity = this.receiptIdentity.get(r.id), previous = this.receipts.get(r.id);
      if (identity !== undefined && identity !== JSON.stringify([r.thread_id,r.client_message_id])) throw new ProtocolError('receipt identity mismatch');
      if (previous?.ref_seq !== undefined && previous.ref_seq !== r.ref_seq) throw new ProtocolError('receipt reference mismatch');
      seen.add(r.id);
    }
    return receipts;
  }
  private reconcileActiveReceipts(summary: ThreadSummary) {
    if (summary.active_receipts === undefined) return;
    const active = new Set<string>();
    for (const receipt of summary.active_receipts) {
      if (receipt.thread_id !== summary.id) throw new ProtocolError('receipt thread mismatch');
      active.add(receipt.id); this.storeReceipt(receipt);
    }
    let changed = false;
    for (const [id, receipt] of this.receipts) {
      if (receipt.thread_id === summary.id && ['queued','running'].includes(receipt.state) && !active.has(id)) {
        this.receipts.delete(id); changed = true;
      }
    }
    if (changed) this.changed();
  }
  protected async call(method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: ConditionalHeaders): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new Error('aborted');
    const token = this.token();
    if (headers && !this.options.http.conditionalRequest) throw new ProtocolError('Conditional writes unavailable');
    const response = await bounded(s => headers ? this.options.http.conditionalRequest!(method,path,token,headers,body,s)
      : this.options.http.request(method, path, token, body, s),timeout(this.options.requestTimeoutMs,15000),signal);
    if (signal?.aborted) throw new Error('aborted');
    if (response.status === 400 && (path.startsWith('/v1/sync') || path.startsWith('/v1/snapshot'))) throw new ResyncRequired('invalid sync or snapshot cursor');
    // The plugin returns the same 400 for malformed, foreign and future cursors.
    // Only an explicit expiry code can authorize an automatic projection reset.
    if (response.status === 410 && path.startsWith('/v1/sync') && response.body && typeof response.body === 'object' && (response.body as Record<string,unknown>).code === 'cursor_expired') throw new ExpiredCursor();
    if (response.status < 200 || response.status >= 300) throw new HttpError(response.status,response.retryAfterMs,path.split('?')[0]);
    return obj(response.body);
  }
  async capabilities(signal?: AbortSignal) { const x = await this.call('GET','/v1/capabilities',undefined,signal); if (x.protocol !== 1 || x.durable_sync !== true) throw new ProtocolError('unsupported protocol'); this.supportsLatest=x.history_latest===true; this.supportsSendIdentity=x.message_send_identity===true; this.supportsChannelWorkspace=x.channel_workspace===true&&x.channel_files===true&&x.channel_agents===true&&Boolean(this.options.http.conditionalRequest); this.supportsSessionLabels=x.session_labels===true; this.supportsAttachmentOrigin=x.attachment_origin===true&&x.history_around===true&&x.history_latest===true; this.capabilitiesReady=true; return x }
  protected adoptCapabilities(owner: HermesClient): void {
    this.capabilitiesReady = owner.capabilitiesReady;
    this.supportsLatest = owner.supportsLatest;
    this.supportsSendIdentity = owner.supportsSendIdentity;
    this.supportsChannelWorkspace = owner.supportsChannelWorkspace;
    this.supportsAttachmentOrigin = owner.supportsAttachmentOrigin;
    this.supportsSessionLabels = owner.supportsSessionLabels;
  }
  private async downloadPath(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    if(!this.options.http.download)throw new ProtocolError('Binary download unavailable');
    const reply=await bounded(s=>this.options.http.download!(path,this.token(),s),timeout(this.options.requestTimeoutMs,15000),signal);
    if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,undefined,'download');
    return reply.body;
  }
  async getModelSettings(signal?: AbortSignal): Promise<AgentModelSettings> {
    return validModelSettings(await this.call('GET', '/v1/agent/model/options', undefined, signal));
  }
  async setModelSettings(provider: string, model: string, signal?: AbortSignal, confirmSelection = false): Promise<AgentModelSettings | ModelSelectionConfirmation> {
    const x = await this.call('PUT', '/v1/agent/model', {scope:'connected-default', provider, model, confirm_selection:confirmSelection}, signal);
    if (x.confirmation_required === true) {
      if (x.provider !== provider || x.model !== model) throw new ProtocolError('model confirmation identity mismatch');
      return {confirmation_required:true, warning:displayString(x.warning, 12000), provider, model};
    }
    if (x.effective !== 'next-turn') throw new ProtocolError('model settings not confirmed');
    return validModelSettings(x);
  }
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
  async createThread(channelId: string, title: string, clientThreadId?: string): Promise<Thread> { const x = await this.call('POST','/v1/channels/'+idPath(channelId)+'/threads',{title,...(clientThreadId?{client_thread_id:clientThreadId}:{})}); return validThread(x.thread) }
  async getThread(id: string, rank = this.lastEventId, signal?: AbortSignal): Promise<Thread> {
    const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('GET','/v1/threads/'+idPath(id),undefined,signal); const thread = validThread(x.thread);
    const key = 'thread:'+id;
    if (epoch===this.projectionEpoch && rank >= (this.versions.get(key) || 0) && seq >= (this.entitySequence.get(key) || 0)) {
      const old = this.threads.get(id); this.threads.set(id,{...old,...thread,last_ref:old?.last_ref || 0,read_ref:old?.read_ref || 0,unread_count:old?.unread_count || 0,...(old?.last_message_at!==undefined?{last_message_at:old.last_message_at}:{})});
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
    this.storeReceipt(r); return this.receipts.get(r.id) ?? r;
  }
  async getReceipt(id: string, signal?: AbortSignal): Promise<Receipt> { const epoch=this.projectionEpoch; const x=await this.call('GET','/v1/receipts/'+idPath(id),undefined,signal); const r=validReceipt(x.receipt); if (r.id!==id) throw new ProtocolError('receipt identity mismatch'); if(epoch!==this.projectionEpoch)return r; this.storeReceipt(r); return this.receipts.get(id) ?? r }
  async getInteraction(threadId:string,id:string,signal?:AbortSignal):Promise<Interaction> {const epoch=this.projectionEpoch;const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/interactions/'+idPath(id),undefined,signal);const item=validInteraction(x.interaction);if(item.id!==id||item.thread_id!==threadId)throw new ProtocolError('interaction identity mismatch');if(epoch!==this.projectionEpoch)return item;if(item.state==='pending')this.interactions.set(id,item);else this.interactions.delete(id);this.changed();return item}
  async answerInteraction(item:Interaction,choice:string):Promise<void> {const x=await this.call('POST','/v1/threads/'+idPath(item.thread_id)+'/interactions/'+idPath(item.id)+'/answer',{choice,receipt_id:item.receipt_id,generation:item.generation});if(x.state!=='settled'||x.request_id!==item.id)throw new ProtocolError('answer not settled');this.interactions.delete(item.id);this.changed()}
  async stop(threadId:string):Promise<boolean> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/stop',{});return x.stopped===true}
  async cancelQueued(threadId:string,receiptId:string):Promise<Receipt> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/receipts/'+idPath(receiptId)+'/cancel',{});const r=validReceipt(x.receipt);this.storeReceipt(r);return r}
  async upload(threadId:string,name:string,bytes:Uint8Array,signal?:AbortSignal):Promise<Attachment> {if(!this.options.http.upload)throw new ProtocolError('binary upload unavailable');const reply=await bounded(s=>this.options.http.upload!('/v1/threads/'+idPath(threadId)+'/attachments',this.token(),name,bytes,s),timeout(this.options.requestTimeoutMs,15000),signal);if(reply.status!==201)throw new HttpError(reply.status,reply.retryAfterMs,'upload');const x=obj(reply.body),raw=obj(x.attachment);const a=validAttachment({...raw,state:'available',receipt_id:null});if(a.thread_id!==threadId)throw new ProtocolError('attachment thread mismatch');this.attachments.set(a.id,a);this.changed();return a}
  async getAttachment(threadId:string,id:string,signal?:AbortSignal):Promise<Attachment> {const epoch=this.projectionEpoch;const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id)+'/metadata',undefined,signal);const a=validAttachment(x.attachment);if(a.id!==id||a.thread_id!==threadId)throw new ProtocolError('attachment identity mismatch');if(epoch!==this.projectionEpoch)return a;this.attachments.set(id,a);this.changed();return a}
  async download(threadId:string,id:string,signal?:AbortSignal):Promise<Uint8Array> {if(!this.options.http.download)throw new ProtocolError('binary download unavailable');const reply=await bounded(s=>this.options.http.download!('/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id),this.token(),s),timeout(this.options.requestTimeoutMs,15000),signal);if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,undefined,'download');return reply.body}
  async deleteUnattached(threadId:string,id:string):Promise<void> {const x=await this.call('DELETE','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id));if(x.deleted!==true)throw new ProtocolError('delete not confirmed');this.attachments.set(id,{id,thread_id:threadId,state:'deleted'});this.changed()}
  async search(threadId:string,text:string,after?:string,limit=20,signal?:AbortSignal) {const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/search'+query({q:text,after,limit}),undefined,signal);return {messages:arr(x.messages).map(validMessage),next_cursor:optionalCursor(x.next_cursor)}}
  async history(threadId: string, after?: string, limit = 50, signal?: AbortSignal, afterRefSeq?:number, refSeq?:number, throughRefSeq?:number) {
    const seq=++this.fetchSequence, epoch=this.projectionEpoch;
    const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query({after,after_ref_seq:afterRefSeq,ref_seq:refSeq,through_ref_seq:throughRefSeq,limit}),undefined,signal);
    const page=arr(x.messages).map(validMessage); const existing=this.messages.get(threadId)||[];
    if (throughRefSeq !== undefined && (page.length > limit || page.some((m,i)=>m.ref_seq>throughRefSeq||afterRefSeq!==undefined&&m.ref_seq<=afterRefSeq||i>0&&m.ref_seq<=page[i-1].ref_seq))) throw new ProtocolError('History window boundary mismatch');
    const receipts=this.historyReceipts(page,threadId,x.receipts);
    if (refSeq!==undefined && (page.length!==1 || page[0].ref_seq!==refSeq)) throw new ProtocolError('message reference mismatch');
    if(epoch!==this.projectionEpoch)return {messages:page,next_cursor:optionalCursor(x.next_cursor),incomplete_turns:arr(x.incomplete_turns),turn_outcomes:arr(x.turn_outcomes)};
    // Publish the page only after its matching states are available to UI.
    for(const r of receipts)this.storeReceipt(r,false);
    if(!page.length && !existing.length && after===undefined && afterRefSeq===undefined && x.next_cursor===null) this.knownEmptyThreads.add(threadId);
    if(page.length) this.knownEmptyThreads.delete(threadId);
    const byRef=new Map(existing.map(m=>[m.ref_seq,m]));
    if(epoch===this.projectionEpoch) page.forEach(m=>{ const key=threadId+':'+m.ref_seq; if(seq >= (this.messageSequence.get(key)||0)) { byRef.set(m.ref_seq,m); this.messageSequence.set(key,seq) } });
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq)); this.changed();
    for(const m of page)for(const a of m.attachments||[])this.attachments.set(a.id,a);
    return {messages:page,next_cursor:optionalCursor(x.next_cursor),newer_cursor:x.newer_cursor===undefined?undefined:optionalCursor(x.newer_cursor),incomplete_turns:arr(x.incomplete_turns),turn_outcomes:arr(x.turn_outcomes)};
  }
  async historyWindow(threadId: string, before?: string, limit = 30, signal?: AbortSignal, aroundRef?: number) {
    if (!this.supportsLatest) throw new ProtocolError('latest history unavailable');
    const seq=++this.fetchSequence, epoch=this.projectionEpoch;
    if (aroundRef !== undefined && (!this.supportsAttachmentOrigin || !Number.isSafeInteger(aroundRef) || aroundRef <= 0 || before)) throw new ProtocolError('Target history unavailable');
    const x = await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query({latest:before||aroundRef!==undefined?undefined:'true',before,around_ref_seq:aroundRef,limit}),undefined,signal);
    const page = arr(x.messages).map(validMessage);
    if (aroundRef !== undefined && (page.length > limit || !page.some(m=>m.ref_seq===aroundRef) || page.some((m,i)=>!Number.isSafeInteger(m.ref_seq)||m.ref_seq<=0||i>0&&m.ref_seq<=page[i-1].ref_seq))) throw new ProtocolError('Target history mismatch');
    const receipts=this.historyReceipts(page,threadId,x.receipts);
    if(epoch!==this.projectionEpoch)return {messages:page,older_cursor:optionalCursor(x.older_cursor)};
    for(const r of receipts)this.storeReceipt(r,false);
    const byRef = new Map((this.messages.get(threadId)||[]).map(m=>[m.ref_seq,m]));
    if(epoch===this.projectionEpoch) page.forEach(m=>{ const key=threadId+':'+m.ref_seq; if(seq >= (this.messageSequence.get(key)||0)) { byRef.set(m.ref_seq,m); this.messageSequence.set(key,seq) } });
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq));
    if(!before && !page.length) this.knownEmptyThreads.add(threadId);
    if(page.length) this.knownEmptyThreads.delete(threadId);
    for(const m of page)for(const a of m.attachments||[])this.attachments.set(a.id,a);
    this.changed();
    return {messages:page,older_cursor:optionalCursor(x.older_cursor),next_cursor:x.next_cursor===undefined?null:optionalCursor(x.next_cursor)};
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
        this.tailContinuations.set(threadId, { cursor: page.next_cursor });
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
    this.tailContinuations.set(threadId, { cursor: cursor! });
    this.tailIncomplete.add(threadId); this.changed();
    throw new ProtocolError('message catch-up exceeds 300 refs; locate latest in thread');
  }
  /** Only after an explicit complete forward history traversal by the caller. */
  resumeTail(threadId:string) { this.tailContinuations.delete(threadId); if(this.tailIncomplete.delete(threadId)) this.changed() }

  /** Continue the exact unfinished forward page, without reopening a UI or
   * jumping to a latest window (which could skip the intervening messages). */
  recoverHistoryTail(threadId: string, signal?: AbortSignal): Promise<Message[]> {
    const existing = this.tailRecoveryJobs.get(threadId);
    if (existing && !existing.signal?.aborted) return existing.promise;
    let job: { promise: Promise<Message[]>; signal?: AbortSignal };
    const promise = this.continueHistoryTail(threadId, signal).finally(() => {
      if (this.tailRecoveryJobs.get(threadId) === job) this.tailRecoveryJobs.delete(threadId);
    });
    job = { promise, signal }; this.tailRecoveryJobs.set(threadId, job);
    return promise;
  }
  private async continueHistoryTail(threadId: string, signal?: AbortSignal): Promise<Message[]> {
    if (!this.tailIncomplete.has(threadId)) return this.messages.get(threadId) || [];
    const continuation = this.tailContinuations.get(threadId), epoch = this.projectionEpoch;
    if (!continuation) throw new ProtocolError('history continuation unavailable');
    const seen = new Set<string>();
    for (let pageCount = 0; pageCount < 20; pageCount++) {
      if (signal?.aborted || epoch !== this.projectionEpoch) throw new Error('aborted');
      if (this.tailContinuations.get(threadId) !== continuation) return this.messages.get(threadId) || [];
      const cursor = continuation.cursor;
      if (seen.has(cursor)) throw new ProtocolError('history continuation did not advance');
      seen.add(cursor);
      const page = await this.history(threadId, cursor, 100, signal);
      if (signal?.aborted || epoch !== this.projectionEpoch) throw new Error('aborted');
      if (this.tailContinuations.get(threadId) !== continuation) return this.messages.get(threadId) || [];
      if (page.next_cursor === null) { this.resumeTail(threadId); return this.messages.get(threadId) || []; }
      if (seen.has(page.next_cursor)) throw new ProtocolError('history continuation did not advance');
      continuation.cursor = page.next_cursor;
    }
    throw new ProtocolError('history recovery page budget exceeded');
  }
  private async refreshSummaries(rank: number, signal?: AbortSignal) {
    let after: string | null = null;
    do {
      const x=await this.call('GET','/v1/snapshot'+query({after,limit:100}),undefined,signal);
      this.batchChanges(() => {
        for (const summary of arr(x.threads).map(validSummary)) {
          const key='summary:'+summary.id;
          if (rank >= (this.versions.get(key)||0)) {
            const old=this.threads.get(summary.id);
            if (old && summary.read_ref<old.read_ref) { summary.read_ref=old.read_ref; summary.unread_count=old.unread_count }
            this.threads.set(summary.id,summary); this.reconcileActiveReceipts(summary); this.versions.set(key,rank); this.changed()
          }
        }
      });
      after=optionalCursor(x.next_after);
    } while(after);
  }
  async markRead(threadId: string, visibleRef: number) { const epoch=this.projectionEpoch; num(visibleRef); const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/read',{ref_seq:visibleRef}); const ref=num(x.ref_seq); const old=this.threads.get(threadId); if (epoch===this.projectionEpoch && old && ref>=old.read_ref) { old.read_ref=ref; old.unread_count=num(x.unread_count); this.changed() } return ref }
  async snapshot(signal?: AbortSignal): Promise<void> {
    const epoch=this.projectionEpoch;
    let after: string|null=null; let earliest: string|null=null; const pages: ThreadSummary[]=[];
    do { const x=await this.call('GET','/v1/snapshot'+query({after,limit:100}),undefined,signal); if (earliest===null) earliest=str(x.waterline); pages.push(...arr(x.threads).map(validSummary)); after=optionalCursor(x.next_after) } while(after);
    if (signal?.aborted || epoch!==this.projectionEpoch) throw new Error('aborted');
    await this.listChannels(signal);
    if (signal?.aborted || epoch!==this.projectionEpoch) throw new Error('aborted');
    this.batchChanges(() => {
      for (const t of pages) { const key='thread:'+t.id; if ((this.versions.get(key)||0)===0) { this.threads.set(t.id,t); this.reconcileActiveReceipts(t) } for(const item of t.pending_interactions||[])this.interactions.set(item.id,item) }
    });
    if (this.options.onCheckpoint) await this.options.onCheckpoint({...this.checkpoint(),cursor:earliest,lastEventId:0});
    if (signal?.aborted || epoch!==this.projectionEpoch) throw new Error('aborted');
    this.cursor=earliest; this.lastEventId=0; this.changed();
  }
  private async applyEvents(events: readonly Event[], signal?: AbortSignal) {
    const epoch = this.projectionEpoch;
    const pending: Event[] = [];
    let last = this.lastEventId;
    let gap = false;
    for (const event of events) {
      if (event.event_id <= last) continue;
      if (last && event.event_id !== last + 1) { gap = true; break }
      pending.push(event); last = event.event_id;
    }
    const owned = new Map<string, Event>();
    for (const event of pending) {
      const key = event.kind+':'+event.thread_id+':'+event.ref;
      if (event.version > (this.versions.get(key) || 0) && event.version > (owned.get(key)?.version || 0)) owned.set(key,event);
    }
    const messageGroups = new Map<string, Event[]>();
    const reads: Array<() => Promise<unknown>> = [];
    let summariesRank = 0;
    let channels = false;
    for (const event of owned.values()) {
      if (event.kind === 'channel') channels = true;
      else if (event.kind === 'message') {
        const group = messageGroups.get(event.thread_id) || [];
        group.push(event); messageGroups.set(event.thread_id,group);
        summariesRank = Math.max(summariesRank,event.event_id);
      } else if (event.kind === 'read') summariesRank = Math.max(summariesRank,event.event_id);
      else if (event.kind === 'thread') reads.push(() => this.getThread(event.thread_id,event.event_id,signal));
      else if (event.kind === 'receipt') reads.push(() => this.getReceipt(event.ref,signal));
      else if (event.kind === 'interaction') reads.push(() => this.getInteraction(event.thread_id,event.ref,signal));
      else if (event.kind === 'attachment') reads.push(() => this.getAttachment(event.thread_id,event.ref,signal));
    }
    if (channels) reads.push(() => this.listChannels(signal));
    for (const [threadId, group] of messageGroups) reads.push(async () => {
      // Exact edits can sit outside the latest/tail window. Never coalesce
      // different edited refs into a tail-only read.
      for (const event of group) if (event.version > 1) {
        const ref = Number(event.ref);
        if (!Number.isSafeInteger(ref) || ref <= 0) throw new ProtocolError('invalid message reference');
        await this.history(threadId,undefined,1,signal,undefined,ref);
      }
      try { await this.historyTail(threadId,signal) }
      catch (error) {
        if (!this.tailIncomplete.has(threadId)) throw error;
        await this.recoverHistoryTail(threadId,signal);
      }
    });
    if (summariesRank) reads.push(() => this.refreshSummaries(summariesRank,signal));
    // No selection/priority here. Independent sessions publish as their reads
    // finish. Wait for every owner to settle before acknowledging this page;
    // failed pages replay idempotently and cannot leave detached mutations.
    const outcomes = await Promise.allSettled(reads.map(read => read()));
    if (signal?.aborted || epoch !== this.projectionEpoch) throw new Error('aborted');
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failure) throw failure.reason;
    const nextVersions = new Map(this.versions);
    for (const [key,event] of owned) nextVersions.set(key,event.version);
    const tail=pending.at(-1);
    if (this.options.onCheckpoint) await this.options.onCheckpoint({
      ...this.checkpoint(),cursor:tail?.cursor ?? this.cursor,lastEventId:tail?.event_id ?? this.lastEventId,versions:[...nextVersions],
    });
    if (signal?.aborted || epoch !== this.projectionEpoch) throw new Error('aborted');
    for (const [key,event] of owned) this.versions.set(key,Math.max(this.versions.get(key)||0,event.version));
    for (const event of pending) { this.lastEventId = event.event_id; this.cursor = event.cursor }
    if (gap) throw new ResyncRequired('event gap');
  }
  async catchUp(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('aborted');
    if (this.replay?.signal?.aborted) this.replay=null;
    if (this.replay) { await this.replay.job; return this.catchUp(signal) }
    const job=(async()=>{ if (this.cursor===null) await this.snapshot(signal); let more=true; while(more) {
      const x=await this.call('GET','/v1/sync'+query({cursor:this.cursor,limit:200}),undefined,signal);
      const events=arr(x.events).map(validEvent); str(x.waterline); const next=str(x.next_cursor); more=x.has_more===true;
      if (!events.length && next!==this.cursor) throw new ResyncRequired('empty page advanced cursor');
      if (events.length && next!==events.at(-1)!.cursor) throw new ResyncRequired('page cursor mismatch');
      if (more && !events.length) throw new ResyncRequired('empty continuation page');
      await this.applyEvents(events,signal);
      if (!events.length && next!==this.cursor) throw new ResyncRequired('empty page advanced cursor');
      if (events.length && next!==this.cursor) throw new ResyncRequired('page cursor mismatch');
      if (more && !events.length) throw new ResyncRequired('empty continuation page');
    } })(); const replay={job,signal}; this.replay=replay; try { await job } finally { if (this.replay===replay) this.replay=null }
  }
  /** Explicit resync after ResyncRequired; never silently rewinds a foreign/future cursor. */
  async resync(signal?: AbortSignal): Promise<void> {
    const epoch=++this.projectionEpoch;
    // Build a replacement away from the visible projection. Do not publish
    // an empty timeline or overwrite the durable cache on a failed reset.
    const staged=new HermesClient({http:this.options.http,socket:this.options.socket,token:()=>this.token(),requestTimeoutMs:this.options.requestTimeoutMs});
    staged.supportsLatest=this.supportsLatest;staged.supportsSendIdentity=this.supportsSendIdentity;
    staged.receiptIdentity=new Map(this.receiptIdentity);
    await staged.snapshot(signal);
    await Promise.all([...this.messages].map(async ([id,rows])=>{
      if (!rows.length || !staged.threads.has(id)) return;
      // Refresh the entire previously cached interval, including edits older
      // than the latest window. Snapshot alone cannot recover expired edits.
      const first=rows[0].ref_seq;
      let after: string | undefined;
      const seen=new Set<string>();
      for(let count=0;count<100;count++) {
        const page=await staged.history(id,after,100,signal,after?undefined:Math.max(0,first-1));
        if(!page.next_cursor)return;
        if(seen.has(page.next_cursor))throw new ProtocolError('resync history cursor did not advance');
        seen.add(page.next_cursor);after=page.next_cursor;
      }
      throw new ProtocolError('resync history page budget exceeded');
    }));
    await staged.catchUp(signal);
    if(signal?.aborted || epoch!==this.projectionEpoch)throw new Error('aborted');
    if(this.options.onCheckpoint)await this.options.onCheckpoint(staged.checkpoint());
    if(signal?.aborted || epoch!==this.projectionEpoch)throw new Error('aborted');
    ++this.projectionEpoch; // fence requests started while staging was loading
    this.batchChanges(()=>{
      const replace=<T>(target:Map<string,T>,source:Map<string,T>)=>{target.clear();for(const [key,value]of source)target.set(key,value)};
      replace(this.channels,staged.channels);replace(this.threads,staged.threads);replace(this.receipts,staged.receipts);
      replace(this.messages,staged.messages);replace(this.interactions,staged.interactions);replace(this.attachments,staged.attachments);
      this.receiptIdentity=staged.receiptIdentity;this.versions=staged.versions;this.entitySequence=staged.entitySequence;
      this.messageSequence=staged.messageSequence;this.fetchSequence=staged.fetchSequence;
      this.tailIncomplete.clear();this.tailContinuations.clear();this.tailRecoveryJobs.clear();this.knownEmptyThreads=staged.knownEmptyThreads;
      this.cursor=staged.cursor;this.lastEventId=staged.lastEventId;
      this.options.onResync?.();this.changed();
    });
  }
  /** Release server content only; directory, credentials and durable input are not touched. */
  protected releaseContent(): void {
    ++this.projectionEpoch;
    this.messages.clear();this.receipts.clear();this.receiptIdentity.clear();this.interactions.clear();this.attachments.clear();this.drafts.clear();
    this.versions.clear();this.messageSequence.clear();this.tailIncomplete.clear();this.tailContinuations.clear();this.tailRecoveryJobs.clear();this.knownEmptyThreads.clear();
  }
  protected retainContent(threadId:string|null): void {
    for(const id of this.messages.keys())if(id!==threadId)this.messages.delete(id);
    for(const id of this.drafts.keys())if(id!==threadId)this.drafts.delete(id);
    for(const [id,row]of this.receipts)if(row.thread_id!==threadId){this.receipts.delete(id);this.receiptIdentity.delete(id)}
    for(const [id,row]of this.interactions)if(row.thread_id!==threadId)this.interactions.delete(id);
    for(const [id,row]of this.attachments)if(row.thread_id!==threadId)this.attachments.delete(id);
    for(const key of this.messageSequence.keys())if(threadId===null||!key.startsWith(threadId+':'))this.messageSequence.delete(key);
    for(const id of this.knownEmptyThreads)if(id!==threadId)this.knownEmptyThreads.delete(id);
    for(const id of this.tailIncomplete)if(id!==threadId)this.tailIncomplete.delete(id);
    for(const id of this.tailContinuations.keys())if(id!==threadId)this.tailContinuations.delete(id);
    for(const id of this.tailRecoveryJobs.keys())if(id!==threadId)this.tailRecoveryJobs.delete(id);
  }
  protected decodeScopedState(value:unknown,threadId:string):{receipts:Receipt[];interactions:Interaction[]} {
    const body=obj(value);if(body.thread_id!==threadId)throw new ProtocolError('live state identity mismatch');
    const receipts=arr(body.active_receipts).map(validReceipt),interactions=arr(body.pending_interactions).map(validInteraction);
    if(receipts.length>32||interactions.length>20||receipts.some(r=>r.thread_id!==threadId)||interactions.some(i=>i.thread_id!==threadId))throw new ProtocolError('live state scope mismatch');
    return {receipts,interactions};
  }

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
      let pongTimer: ReturnType<typeof setTimeout> | undefined;
      const active=()=>!done && !signal.aborted && gen===this.generation;
      const finish=(error?: unknown) => {
        if(done)return; done=true; clearTimeout(helloTimer); clearTimeout(pongTimer); signal.removeEventListener('abort',abort); attempt.abort();
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
          if(data==='pong') { if(!hello)throw new ProtocolError('pong before hello'); if(awaitingPong)stable(); awaitingPong=false; clearTimeout(pongTimer); pongTimer=undefined; return }
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
        const interval=timeout(this.options.livenessMs,10000);
        while(active()) {
          try { await wait(interval,signal) } catch { break }
          if(!active())break;
          if(!hello)continue;
          try {
            if(socket.send) {
              // The pong deadline starts at send, independently of any slow
              // durable replay. Never send a second ping while one is pending.
              if(!awaitingPong) {
                awaitingPong=true;
                pongTimer=setTimeout(()=>finish(new TimeoutError('WebSocket liveness timed out')),interval);
                socket.send('ping');
              }
            } else { // Adapters without ping support rotate the socket periodically.
              stable();finish();break;
            }
            // Keep one replay owner; HTTP must not delay ping or its deadline.
            if(active())void replayNow();
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
