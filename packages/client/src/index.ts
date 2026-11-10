/** Owner-scoped HTTP operations and projections. Live connection lifecycle is separate. */
import { createWorkspaceApi, type ConditionalHeaders, type WorkspaceApi } from './workspace';
import { createSessionFilesApi, type SessionFilesApi } from './sessionFiles';
import { createSessionTextApi, type SessionTextApi } from './sessionText';
import { parseAutomationDetail, parseAutomationPage, parseAutomationUpdate, parseAutomations, type Automation, type AutomationDetail, type AutomationPage } from './automations';
export { utf8Size, workspacePath } from './workspace';
import { validSitePath } from './attachmentPages';
export { attachmentPageUrl, validSitePath } from './attachmentPages';
export type { SessionFile, SessionFileList, SessionFilePage, FileSearchHit, FileSearchPage } from './sessionFiles';
export type { SessionTextHit, SessionTextPage, SessionTextRefinement } from './sessionText';
export { threadModelOptions, threadModelLabel, threadModelKey, threadModelRequest, type ThreadModelOption } from './threadModel';
import { parseThreadUsage, type ThreadUsage } from './threadUsage';
export { formatTokens, exactTokens, cacheHitPercent, parseThreadUsage, type ThreadUsage, type ThreadCache } from './threadUsage';
export type { ConditionalHeaders, WorkspaceApi, WorkspaceState, WorkspaceEntry, WorkspacePage, AgentsDocument, ChannelAttachmentPage } from './workspace';
export type ReceiptState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' | 'received';
export type ReceiptProcessing = 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' | null;
export interface Receipt { id: string; client_message_id: string; thread_id: string; state: ReceiptState; durable: true; version?: number; ref_seq?: number; admission?: 'followup'; handed_off?: true; processing?: ReceiptProcessing; feedback?: string }
export interface Thread { id: string; project_id: string; title: string; title_alphabet?: string; archived: number | boolean; markers?: string[]; markers_updated_at?: number; [key: string]: unknown }
export interface ThreadSummary { id: string; project_id: string; title: string; title_alphabet?: string; archived: number | boolean; markers?: string[]; markers_updated_at?: number; running?: boolean; completed_unread?: boolean; result_version?: number; result_ref?: number; last_message_at?: number; origin?: 'user' | 'automation'; participated?: boolean }
export interface Channel { id: string; name: string; description?: string; /** Server folder bound as the Channel primary path; null when none. */ bound_primary_path?: string | null; [key: string]: unknown }
/** Patch for updateChannel. primary_path: a string binds, null unbinds, omitted keeps the current binding. */
export interface ChannelPatch { name?: string; description?: string; primary_path?: string | null }
export interface AgentModelSettings { scope: 'connected-default'; provider: string; model: string; providers: {id: string; name: string; models: string[]}[] }
export interface ModelSelectionConfirmation { confirmation_required: true; warning: string; provider: string; model: string }
/** Model for one new Thread. Omit it to use the connection's primary model. */
export interface ThreadModelChoice { provider: string; model: string }
export interface Attachment { id: string; thread_id: string; name?: string; mime?: string; size?: number; receipt_id?: string | null; public_url?: string; site_path?: string; state: 'available' | 'missing' | 'deleted' }
/** Saved login or address of the connected Hermes profile (metadata only; no password or address field). */
export interface VaultItem { id: string; kind: 'login' | 'address'; label: string; origin: string | null; created_at: string; identifier?: string; identifier_type?: string; has_otp?: boolean }
export type NewVaultItem =
  | { kind: 'login'; label: string; origin: string; secret: { identifier: string; password: string; otp_secret?: string } }
  | { kind: 'address'; label: string; origin?: string; secret: { address_line1: string; address_line2?: string; city: string; state?: string; postal_code: string; country: string } };
/** An open in-chat vault prompt: Hermes waits for a login to save or a one-time code. */
export interface VaultPrompt { id: string; kind: 'save_login' | 'code'; thread_id: string; receipt_id: string; generation: string; site: string; origin: string; hint: string; expires_at: number;
  /** save_login (servers with vault_manage): a saved login for this address exists; its password did not work. */
  update?: boolean;
  /** save_login: the account to prefill. */
  identifier?: string;
  /** save_login: saved logins of the same site on another address; one tap reuses one. */
  matches?: VaultMatch[] }
export interface VaultMatch { id: string; label: string; identifier: string; origin: string }
export type VaultPromptAnswer = { decision: 'decline' } | { decision: 'submit'; identifier: string; password: string; otp_secret?: string } | { decision: 'submit'; code: string } | { decision: 'use'; item_id: string };
/** Change of a saved login: empty password keeps the old one; clear_otp removes the authenticator key. */
export type VaultItemChange =
  | { label?: string; origin?: string; identifier?: string; password?: string; otp_secret?: string; clear_otp?: boolean }
  | { label?: string; secret: { address_line1: string; address_line2?: string; city: string; state?: string; postal_code: string; country: string } };
export interface VaultImportResult { added: number; updated: number; unchanged: number; otp_skipped: number; skipped: { not_login: number; no_website: number; no_username: number; no_password: number } }
/** Largest password-manager CSV export the server takes (plugin vault.IMPORT_MAX_BYTES). */
export const VAULT_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export interface Interaction { id: string; kind: 'approval' | 'clarify'; thread_id: string; receipt_id: string; generation: string; prompt: string; choices: string[]; state: 'pending' | 'settled' | 'expired' }
/** Display-only summaries from the authenticated server, never raw tool arguments/results. */
export interface ToolCall { id: string; name: string; label: string; detail?: string; caption?: string; icon?: string }
export interface Message { id: string; ref_seq: number; role: string; text: string; created_at?: number; display_kind?: 'direct' | 'final' | 'system_notice'; notice_kind?: 'review' | 'compression' | 'branch'; tool_calls?: ToolCall[]; attachments?: Attachment[]; receipt_id?: string; client_message_id?: string; model?: string }
/** A page the agent opened while answering ('read') or a link its reply cites ('cited'). */
export interface MessageSource { url: string; kind: 'read' | 'cited' }

export interface HttpReply { status: number; body: unknown; retryAfterMs?: number }
export interface BinaryReply { status: number; body: Uint8Array }
/** A local file that a platform transport sends or fills without loading it into JS memory (for example a mobile file URI). */
export interface LocalFile { uri: string; size: number }
export interface FileReply { status: number; size: number }
/** Bytes moved so far, and the total when known. Called often; consumers throttle their own display. */
export type TransferProgress = (done: number, total?: number) => void;
export interface HttpTransport { request(method: string, path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<HttpReply>; conditionalRequest?(method: string, path: string, token: string, headers: ConditionalHeaders, body?: unknown, signal?: AbortSignal): Promise<HttpReply>; upload?(path: string, token: string, name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<HttpReply>; putBytes?(path: string, token: string, headers: ConditionalHeaders, bytes: Uint8Array, signal?: AbortSignal): Promise<HttpReply>; download?(path: string, token: string, signal?: AbortSignal): Promise<BinaryReply>; uploadFile?(path: string, token: string, name: string, file: LocalFile, signal?: AbortSignal): Promise<HttpReply>; downloadFile?(path: string, token: string, destination: string, signal?: AbortSignal, onProgress?: TransferProgress): Promise<FileReply>; uploadChunk?(path: string, token: string, bytes: Uint8Array, signal?: AbortSignal): Promise<HttpReply> }
export interface Socket { onMessage(handler: (data: string) => void): void; onClose(handler: () => void): void; close(): void; send?(data: string): void }
export interface SocketFactory { connect(path: string, token: string, signal: AbortSignal): Promise<Socket> }
export type ConnectionState = 'connecting' | 'syncing' | 'online' | 'retrying' | 'suspended' | 'blocked';
export interface Options { http: HttpTransport; socket: SocketFactory; token: () => string; onChange?: () => void; onError?: (error: Error) => void; onConnectionState?: (state: ConnectionState) => void; onRetryScheduled?: (retryAt: number | null) => void; backoffMs?: number[]; requestTimeoutMs?: number; connectTimeoutMs?: number; livenessMs?: number;
  /** Ping interval while the owner marks the connection idle. Unset keeps `livenessMs` always. The pong deadline stays `livenessMs`. */
  idleLivenessMs?: number;
  /** Random spread (0–0.5) applied to each ordinary backoff delay. Server Retry-After is never shortened. */
  backoffJitter?: number }
export class ProtocolError extends Error { constructor(message: string) { super(message); this.name = 'ProtocolError' } }
/** Thread creation needs the user's confirmation of a native cost/data warning first. Nothing was created.
 * A ProtocolError, so no retry path treats it as a temporary failure. */
export class ModelConfirmationRequired extends ProtocolError {
  constructor(readonly warning: string, readonly choice: ThreadModelChoice) { super('model confirmation required'); this.name = 'ModelConfirmationRequired' }
}

const diagnosticRoute = (path: string): string => {
  const clean=path.split('?')[0];
  if(['/v1/capabilities','/v1/catalogue'].includes(clean))return clean;
  if(/^\/v1\/receipts\/[^/]+$/.test(clean))return '/v1/receipts/:id';
  if(/^\/v1\/threads\/[^/]+\/messages$/.test(clean))return '/v1/threads/:id/messages';
  if(/^\/v1\/threads\/[^/]+\/live-state$/.test(clean))return '/v1/threads/:id/live-state';
  return 'API';
};
export class HttpError extends ProtocolError {
  readonly route: string;
  constructor(readonly status: number, readonly retryAfterMs?: number, path = '', readonly code?: string) {
    super('HTTP ' + status + (path ? ' ' + path : '')); this.name = 'HttpError'; this.route=diagnosticRoute(path);
  }
}
export class TimeoutError extends Error { constructor(message: string) { super(message); this.name = 'TimeoutError' } }
/** One client crash report (`POST /v1/client-logs`). */
export type ClientLogReport = { kind: 'error' | 'fatal' | 'unhandled_rejection' | 'render' | 'console'; message: string; stack?: string; component_stack?: string;
  route?: string; platform?: string; os_version?: string; app_version?: string; runtime_version?: string; client_time?: string; fatal?: boolean };
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

const validChannel = (v: unknown): Channel => { const x = obj(v); str(x.id); str(x.name); return x as unknown as Channel };

const validAttachment = (v: unknown): Attachment => { const x=obj(v), state=str(x.state); if (!['available','missing','deleted'].includes(state)) throw new ProtocolError('invalid attachment'); const a:Attachment={id:str(x.id),thread_id:str(x.thread_id),state:state as Attachment['state']}; if(state!=='deleted') {a.name=str(x.name);a.mime=str(x.mime);a.size=num(x.size);a.receipt_id=x.receipt_id===null?null:str(x.receipt_id)} if(typeof x.public_url==='string') {try {const u=new URL(x.public_url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith('/media/'+a.id+'/'))a.public_url=u.href;}catch{/* Optional links never invalidate durable attachment metadata. */}} const site=validSitePath(a.id,x.site_path); if(site&&state==='available')a.site_path=site; return a };
const validInteraction = (v: unknown): Interaction => { const x=obj(v), kind=str(x.kind), state=str(x.state); if(!['approval','clarify'].includes(kind)||!['pending','settled','expired'].includes(state)) throw new ProtocolError('invalid interaction'); return {id:str(x.id),kind:kind as Interaction['kind'],thread_id:str(x.thread_id),receipt_id:str(x.receipt_id),generation:str(x.generation),prompt:str(x.prompt),choices:arr(x.choices).map(str),state:state as Interaction['state']} };
const validVaultPrompt = (v: unknown): VaultPrompt => { const x=obj(v), kind=str(x.kind); if(!['save_login','code'].includes(kind)) throw new ProtocolError('invalid vault prompt'); const prompt:VaultPrompt={id:str(x.id),kind:kind as VaultPrompt['kind'],thread_id:str(x.thread_id),receipt_id:str(x.receipt_id),generation:str(x.generation),site:str(x.site),origin:str(x.origin),hint:str(x.hint),expires_at:num(x.expires_at)}; if(kind==='save_login'){if(x.update===true)prompt.update=true;if(typeof x.identifier==='string'&&x.identifier)prompt.identifier=x.identifier;if(Array.isArray(x.matches))prompt.matches=x.matches.slice(0,8).map(m=>{const y=obj(m);return {id:str(y.id),label:str(y.label),identifier:typeof y.identifier==='string'?y.identifier:'',origin:str(y.origin)}})} return prompt };
const validVaultItem = (v: unknown): VaultItem => { const x=obj(v), kind=str(x.kind); if(!['login','address'].includes(kind)) throw new ProtocolError('invalid vault item'); const item:VaultItem={id:str(x.id),kind:kind as VaultItem['kind'],label:str(x.label),origin:x.origin===null||x.origin===undefined?null:str(x.origin),created_at:str(x.created_at)}; if(kind==='login'){item.identifier=str(x.identifier);item.identifier_type=str(x.identifier_type);item.has_otp=x.has_otp===true} return item };
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
// The model that produced a final reply. A malformed value is dropped, never shown.
const replyModel = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:+-]{0,255}$/.test(value) ? value : undefined;
const validMessage = (v: unknown): Message => {
  const x = obj(v), role = str(x.role);
  if (role === 'system' && x.display_kind !== 'system_notice') throw new ProtocolError('invalid system notice');
  if (x.display_kind === 'system_notice' && role !== 'system') throw new ProtocolError('invalid system notice');
  if (x.display_kind === 'final' && (role !== 'assistant' || typeof x.text !== 'string' || !x.text.trim() ||
    x.tool_calls !== undefined && (!Array.isArray(x.tool_calls) || x.tool_calls.length > 0))) throw new ProtocolError('invalid final reply');
  return { id: str(x.id), ref_seq: num(x.ref_seq), role, text: str(x.text),
    ...(role === 'assistant' && (x.display_kind === 'direct' || x.display_kind === 'final') ? {display_kind: x.display_kind} : {}),
    ...(role === 'system' ? {display_kind: 'system_notice' as const} : {}),
    ...(role === 'assistant' && x.display_kind === 'final' && replyModel(x.model) ? {model: replyModel(x.model)} : {}),
    ...(role === 'system' && (x.notice_kind === 'review' || x.notice_kind === 'compression' || x.notice_kind === 'branch') ? {notice_kind: x.notice_kind} : {}),
    ...(x.created_at === undefined ? {} : {created_at:timestamp(x.created_at)}),
    ...(role === 'assistant' && x.tool_calls !== undefined ? {tool_calls:validToolCalls(x.tool_calls)} : {}),
    ...(x.receipt_id == null ? {} : {receipt_id:str(x.receipt_id)}),
    ...(x.client_message_id == null ? {} : {client_message_id:str(x.client_message_id)}),
    attachments:x.attachments===undefined?[]:arr(x.attachments).map(validAttachment) };
};

const timeout = (value: number | undefined, fallback: number): number => value === undefined ? fallback : Math.max(1, value);
// Attachment transfers get the normal request deadline plus time for their bytes
// at 128 KiB/s (about 1 Mbit/s): 100 MiB adds about 13 minutes.
export const TRANSFER_BYTES_PER_SECOND = 128 * 1024;
/** One request body through the Cloudflare edge: larger files use chunked uploads. */
export const SINGLE_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Reads exactly `length` bytes at `offset` of a local file. */
export type ChunkReader = (offset: number, length: number) => Promise<Uint8Array>;
const CHUNK_RETRIES = 6;
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('aborted')); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(new Error('aborted')); };
  signal?.addEventListener('abort', stop, { once: true });
});
const transferTimeout = (value: number | undefined, size: number | undefined): number =>
  timeout(value, 15000) + Math.ceil(Math.max(0, size ?? 0) / TRANSFER_BYTES_PER_SECOND * 1000);
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
  /** Open vault prompts of the open conversation (process state on the server; never persisted here). */
  readonly vaultPrompts = new Map<string, VaultPrompt>();
  readonly attachments = new Map<string, Attachment>();
  readonly messages = new Map<string, Message[]>();
  readonly drafts = new Map<string, string>(); // ephemeral stream text; never merged into durable history


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
  supportsFullHistory = false;
  supportsSendIdentity = false;
  supportsChannelWorkspace = false;
  supportsChannelPrimaryPath = false;
  supportsSessionFiles = false;
  supportsFileSearch = false;
  /** Session full-text search over message text, and its AI refine (plugin `session_search`). */
  supportsSessionSearch = false;
  supportsSessionSearchRefine = false;
  supportsAttachmentOrigin = false;
  supportsSessionLabels = false;
  /** directory_changed may name changed Threads, read at /v1/catalogue/threads (plugin 0.2.29+). */
  supportsCatalogueThreads = false;
  /** Largest `/v1/catalogue` page the server accepts; older servers accept 30. */
  cataloguePageLimit = 30;
  /** Server branch endpoint, message sources and conversation export (plugin 0.2.9+). */
  supportsThreadBranch = false;
  supportsMessageSources = false;
  supportsThreadExport = false;
  supportsChannelArchive = false;
  /** Session context size and cumulative tokens at `/v1/threads/{id}/usage` (plugin 0.2.55+). */
  supportsThreadUsage = false;
  supportsVault = false;
  /** Edit, CSV import, save prompts that update or reuse a saved login (plugin 0.2.59+). */
  supportsVaultManage = false;
  /** The host's remote screen (plugin capability `remote_screen`): its display name. */
  remoteScreen: { name: string } | undefined = undefined;
  /** Read-only Automations directory and Thread origin (plugin 0.2.22+). */
  supportsAutomations = false;
  /** Automation editing (plugin 0.2.28): paged list, direct controls, settings Threads. */
  supportsAutomationsPaged = false;
  supportsAutomationControls = false;
  supportsAutomationEditors = false;
  /** Server accepts a model choice when a Thread is created (`thread_model`). */
  supportsThreadModel = false;
  /** Files above the 100 MB edge limit upload in chunks (`uploadChunked`), up to `uploadMaxBytes`. */
  supportsChunkedUpload = false;
  uploadMaxBytes = SINGLE_UPLOAD_BYTES;
  readonly workspace: WorkspaceApi;
  readonly files: SessionFilesApi;
  readonly sessionText: SessionTextApi;
  readonly tailIncomplete = new Set<string>();
  private tailContinuations = new Map<string, { cursor: string }>();
  private tailRecoveryJobs = new Map<string, { promise: Promise<Message[]>; signal?: AbortSignal }>();
  private knownEmptyThreads = new Set<string>();
  constructor(private readonly options: Options, directory?: Pick<HermesClient, 'channels' | 'threads'>) {
    this.channels = directory?.channels ?? new Map();
    this.threads = directory?.threads ?? new Map();
    this.workspace = createWorkspaceApi((method,path,body,signal,headers) => this.call(method,path,body,signal,headers),
      (path,signal) => this.downloadPath(path,signal), message => new ProtocolError(message),
      (path,headers,bytes,signal) => this.putPath(path,headers,bytes,signal));
    this.files = createSessionFilesApi((method,path,body,signal) => this.call(method,path,body,signal), message => new ProtocolError(message),
      (threadId,id,destination,size,signal,onProgress) => this.transferToFile(threadId,id,destination,size,signal,onProgress));
    this.sessionText = createSessionTextApi((method,path,body,signal) => this.call(method,path,body,signal), message => new ProtocolError(message));
  }



  private notificationDepth = 0;
  private notificationPending = false;
  protected changed() {
    if (this.notificationDepth) { this.notificationPending = true; return }
    this.options.onChange?.();
  }
  /** A directory row (`thread:<id>` / `channel:<id>`) was set from a confirmed
   * mutation response. A live directory keeps it over an older catalogue walk. */
  protected directoryAdopted(_key: string): void {}
  /** Apply a server-confirmed Thread row with the same ordering guard as getThread.
   * `directory`: a mutation reply; an archived Thread leaves the directory, as in the catalogue. */
  private adoptThread(thread: Thread, seq: number, epoch: number, directory = false): void {
    const key = 'thread:'+thread.id;
    if (epoch!==this.projectionEpoch || seq < (this.entitySequence.get(key) || 0)) return;
    if (directory && thread.archived) this.threads.delete(thread.id);
    else { const old = this.threads.get(thread.id); this.threads.set(thread.id,{...old,...thread,...(old?.last_message_at!==undefined?{last_message_at:old.last_message_at}:{})}); }
    this.entitySequence.set(key,seq); if (directory) this.directoryAdopted(key); this.changed();
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
  protected async call(method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: ConditionalHeaders, requestTimeoutMs?: number): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new Error('aborted');
    const token = this.token();
    if (headers && !this.options.http.conditionalRequest) throw new ProtocolError('Conditional writes unavailable');
    const response = await bounded(s => headers ? this.options.http.conditionalRequest!(method,path,token,headers,body,s)
      : this.options.http.request(method, path, token, body, s),timeout(requestTimeoutMs??this.options.requestTimeoutMs,15000),signal);
    if (signal?.aborted) throw new Error('aborted');

    if (response.status < 200 || response.status >= 300) {
      const body = response.body && typeof response.body === 'object' ? (response.body as Record<string, unknown>) : {};
      const code = typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : undefined;
      throw new HttpError(response.status,response.retryAfterMs,path.split('?')[0],code);
    }
    return obj(response.body);
  }
  async capabilities(signal?: AbortSignal) { const x = await this.call('GET','/v1/capabilities',undefined,signal); if (x.protocol !== 1) throw new ProtocolError('unsupported protocol'); this.supportsLatest=x.history_latest===true; this.supportsFullHistory=x.history_full===true; this.supportsSendIdentity=x.message_send_identity===true; this.supportsChannelWorkspace=x.channel_workspace===true&&x.channel_files===true&&x.channel_agents===true&&Boolean(this.options.http.conditionalRequest); this.supportsChannelPrimaryPath=x.channel_primary_path===true; this.supportsSessionFiles=x.session_files===true; this.supportsFileSearch=x.file_search===true; this.supportsSessionSearch=x.session_search===true; this.supportsSessionSearchRefine=this.supportsSessionSearch&&x.session_search_refine===true; this.supportsSessionLabels=x.session_labels===true; this.supportsCatalogueThreads=x.catalogue_threads===true; this.cataloguePageLimit=typeof x.catalogue_page_limit==='number'&&Number.isSafeInteger(x.catalogue_page_limit)&&x.catalogue_page_limit>30?Math.min(x.catalogue_page_limit,500):30; this.supportsAttachmentOrigin=x.attachment_origin===true&&x.history_around===true&&x.history_latest===true; this.supportsThreadBranch=x.thread_branch===true; this.supportsMessageSources=x.message_sources===true; this.supportsThreadExport=x.thread_export===true&&Boolean(this.options.http.download);this.supportsChannelArchive=x.channel_archive===true; this.supportsThreadUsage=x.thread_usage===true; this.supportsVault=x.vault===true; this.supportsVaultManage=this.supportsVault&&x.vault_manage===true; const screen=(x.remote_screen&&typeof x.remote_screen==='object'?x.remote_screen:undefined) as {protocol?:unknown;name?:unknown}|undefined; this.remoteScreen=screen?.protocol===1?{name:typeof screen.name==='string'&&screen.name.trim()?screen.name.trim().slice(0,64):'Remote browser'}:undefined; this.supportsAutomations=x.automations===true&&x.thread_origin===true; this.supportsAutomationsPaged=this.supportsAutomations&&x.automations_paged===true; this.supportsAutomationControls=this.supportsAutomations&&x.automation_controls===true; this.supportsAutomationEditors=this.supportsAutomations&&x.automation_editors===true; this.supportsThreadModel=x.thread_model===true; this.supportsChunkedUpload=x.chunked_uploads===true&&Boolean(this.options.http.uploadChunk); this.uploadMaxBytes=this.supportsChunkedUpload&&typeof x.upload_max_bytes==='number'&&Number.isSafeInteger(x.upload_max_bytes)&&x.upload_max_bytes>SINGLE_UPLOAD_BYTES?x.upload_max_bytes:SINGLE_UPLOAD_BYTES; this.capabilitiesReady=true; return x }
  /** Developer crash report for this server's client log; never shown to the user. */
  async reportClientLog(report: ClientLogReport, signal?: AbortSignal): Promise<void> { await this.call('POST','/v1/client-logs',report,signal,undefined,10000) }
  protected adoptCapabilities(owner: HermesClient): void {
    this.capabilitiesReady = owner.capabilitiesReady;
    this.supportsLatest = owner.supportsLatest;
    this.supportsFullHistory = owner.supportsFullHistory;
    this.supportsSendIdentity = owner.supportsSendIdentity;
    this.supportsChannelWorkspace = owner.supportsChannelWorkspace;
    this.supportsChannelPrimaryPath = owner.supportsChannelPrimaryPath;
    this.supportsSessionFiles = owner.supportsSessionFiles;
    this.supportsFileSearch = owner.supportsFileSearch;
    this.supportsSessionSearch = owner.supportsSessionSearch;
    this.supportsSessionSearchRefine = owner.supportsSessionSearchRefine;
    this.supportsAttachmentOrigin = owner.supportsAttachmentOrigin;
    this.supportsSessionLabels = owner.supportsSessionLabels;
    this.supportsCatalogueThreads = owner.supportsCatalogueThreads;
    this.cataloguePageLimit = owner.cataloguePageLimit;
    this.supportsThreadBranch = owner.supportsThreadBranch;
    this.supportsMessageSources = owner.supportsMessageSources;
    this.supportsThreadExport = owner.supportsThreadExport;
    this.supportsChannelArchive = owner.supportsChannelArchive;
    this.supportsThreadUsage = owner.supportsThreadUsage;
    this.supportsVault = owner.supportsVault;
    this.supportsVaultManage = owner.supportsVaultManage;
    this.remoteScreen = owner.remoteScreen;
    this.supportsAutomations = owner.supportsAutomations;
    this.supportsAutomationsPaged = owner.supportsAutomationsPaged;
    this.supportsAutomationControls = owner.supportsAutomationControls;
    this.supportsAutomationEditors = owner.supportsAutomationEditors;
    this.supportsThreadModel = owner.supportsThreadModel;
    this.supportsChunkedUpload = owner.supportsChunkedUpload;
    this.uploadMaxBytes = owner.uploadMaxBytes;
  }
  /** Conditional raw-byte write. Never retried: a lost reply is reconciled by the caller. */
  private async putPath(path: string, headers: ConditionalHeaders, bytes: Uint8Array, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if(!this.options.http.putBytes)throw new ProtocolError('Binary file writes unavailable');
    const reply=await bounded(s=>this.options.http.putBytes!(path,this.token(),headers,bytes,s),timeout(this.options.requestTimeoutMs,60000),signal);
    if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,reply.retryAfterMs,path.split('?')[0]);
    return obj(reply.body);
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
  async createChannel(name: string, description = '', primaryPath?: string): Promise<Channel> { const x = await this.call('POST','/v1/channels',primaryPath===undefined?{name,description}:{name,description,primary_path:primaryPath}); const c = validChannel(x.channel); this.channels.set(c.id,c); this.directoryAdopted('channel:'+c.id); this.changed(); return c }
  async updateChannel(id: string, patch: ChannelPatch): Promise<Channel> { const x = await this.call('PATCH','/v1/channels/'+idPath(id),patch); const c = validChannel(x.channel); this.channels.set(id,c); this.directoryAdopted('channel:'+id); this.changed(); return c }
  /** Core project archive: the Channel and its Threads leave the directory; nothing is deleted. */
  /** This connection's scheduled jobs. Requires `supportsAutomations`. */
  async automations(signal?: AbortSignal): Promise<Automation[]> { return parseAutomations(await this.call('GET','/v1/automations',undefined,signal)) }
  /** One page of jobs (requires `supportsAutomationsPaged`); `channel` keeps one Channel's jobs. */
  async automationsPage(options: { limit?: number; after?: string; channel?: string } = {}, signal?: AbortSignal): Promise<AutomationPage> {
    return parseAutomationPage(await this.call('GET','/v1/automations'+query({limit:options.limit ?? 30, after:options.after, channel:options.channel}),undefined,signal));
  }
  /** Pause, Resume or Run now (requires `supportsAutomationControls`). Returns the job after the change. */
  async automationControl(id: string, control: 'pause' | 'resume' | 'run'): Promise<Automation> {
    return parseAutomationUpdate(await this.call('POST','/v1/automations/'+idPath(id)+'/'+control,{}));
  }
  /** Change the schedule; the server parses the same forms as the agent's cron tool. */
  async setAutomationSchedule(id: string, schedule: string): Promise<Automation> {
    return parseAutomationUpdate(await this.call('PATCH','/v1/automations/'+idPath(id),{schedule}));
  }
  /** Delete the job (plugin 0.2.31, when its `controls` has `delete`). Its conversations stay.
   *  A job that is already gone (404, e.g. a repeated request) counts as deleted. */
  async deleteAutomation(id: string): Promise<void> {
    let body: Record<string, unknown>;
    try { body = await this.call('DELETE','/v1/automations/'+idPath(id)); }
    catch (error) { if (error instanceof HttpError && error.status === 404) return; throw error; }
    if (body.deleted !== true) throw new ProtocolError('automation delete not confirmed');
  }
  /** The job's settings conversation, created on first use (requires `supportsAutomationEditors`). */
  async automationEditor(id: string): Promise<Thread> {
    return validThread((await this.call('POST','/v1/automations/'+idPath(id)+'/editor',{})).thread);
  }
  /** One job and the Threads it delivered into, newest first; pass `before` for the next page. */
  async automation(id: string, before?: number, signal?: AbortSignal): Promise<AutomationDetail> {
    return parseAutomationDetail(await this.call('GET','/v1/automations/'+idPath(id)+(before===undefined?'':'?before='+before),undefined,signal));
  }
  async archiveChannel(id: string): Promise<void> { const x = await this.call('PATCH','/v1/channels/'+idPath(id),{archived:true}); if (validChannel(x.channel).archived !== true) throw new ProtocolError('archive not confirmed'); this.channels.delete(id); this.directoryAdopted('channel:'+id); this.changed() }
  async deleteChannel(id: string): Promise<void> { const x = await this.call('DELETE','/v1/channels/'+idPath(id)); if (x.deleted !== true) throw new ProtocolError('delete not confirmed'); this.channels.delete(id); this.directoryAdopted('channel:'+id); this.changed() }
  async listThreads(channelId: string, after?: string, limit = 50) { const x = await this.call('GET','/v1/channels/'+idPath(channelId)+'/threads'+query({after,limit})); return {threads: arr(x.threads).map(validThread),next_cursor:optionalCursor(x.next_cursor)} }
  /** Creates a Thread. `model` applies to this Thread only (requires `supportsThreadModel`); omit it for the
   * primary model. A native cost/data warning throws ModelConfirmationRequired and creates nothing; repeat
   * with `confirmModel` after the user agrees. */
  async createThread(channelId: string, title: string, clientThreadId?: string, model?: ThreadModelChoice, confirmModel = false, options: { automationEditor?: boolean } = {}): Promise<Thread> {
    const seq = ++this.fetchSequence, epoch = this.projectionEpoch;
    const x = await this.call('POST','/v1/channels/'+idPath(channelId)+'/threads',{title,...(clientThreadId?{client_thread_id:clientThreadId}:{}),
      ...(options.automationEditor?{automation_editor:true}:{}),
      ...(model?{model:{provider:model.provider,model:model.model,...(confirmModel?{confirm_selection:true}:{})}}:{})});
    if (model && x.confirmation_required === true) {
      if (x.provider !== model.provider || x.model !== model.model) throw new ProtocolError('model confirmation identity mismatch');
      throw new ModelConfirmationRequired(displayString(x.warning, 12000), {provider:model.provider, model:model.model});
    }
    const thread = validThread(x.thread);
    // The server returns the canonical model it stored; null only when a later /new cleared it.
    if (model && x.model !== null && (typeof x.model !== 'object' || obj(x.model).provider !== model.provider || typeof obj(x.model).model !== 'string'))
      throw new ProtocolError('thread model not confirmed');
    if (thread.project_id !== channelId || (clientThreadId && thread.id !== clientThreadId)) throw new ProtocolError('thread identity mismatch');
    // The created row is server-confirmed; the catalogue refresh follows in the background.
    this.adoptThread(thread, seq, epoch, true);
    return thread;
  }
  async getThread(id: string, signal?: AbortSignal): Promise<Thread> {
    const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('GET','/v1/threads/'+idPath(id),undefined,signal); const thread = validThread(x.thread);
    this.adoptThread(thread, seq, epoch);
    return thread;
  }
  // The PATCH/DELETE reply is the stored row (same as GET), so no readback request.
  async updateThread(id: string, patch: {title?: string; archived?: boolean}): Promise<Thread> { const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('PATCH','/v1/threads/'+idPath(id),patch); const t = validThread(x.thread); if (t.id !== id) throw new ProtocolError('thread identity mismatch'); this.adoptThread(t, seq, epoch, true); return t }
  async archiveThread(id: string): Promise<Thread> { const seq = ++this.fetchSequence, epoch=this.projectionEpoch; const x = await this.call('DELETE','/v1/threads/'+idPath(id)); const t=validThread(x.thread); if (t.id !== id) throw new ProtocolError('thread identity mismatch'); this.adoptThread(t, seq, epoch, true); return t }
  /** New Thread from a final reply; the same requestId returns the same Thread. Failures carry HttpError.code. */
  async branchThread(threadId: string, anchorRefSeq: number, requestId: string): Promise<Thread> {
    if (!Number.isSafeInteger(anchorRefSeq) || anchorRefSeq <= 0 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) throw new ProtocolError('invalid branch');
    const x = await this.call('POST','/v1/threads/'+idPath(threadId)+'/branch',{anchor_ref_seq:anchorRefSeq,request_id:requestId},undefined,undefined,60000);
    const t = validThread(x.thread);
    if (t.id === threadId) throw new ProtocolError('branch identity mismatch');
    await this.getThread(t.id).catch(() => {});
    return t;
  }
  async messageSources(threadId: string, refSeq: number, signal?: AbortSignal): Promise<MessageSource[]> {
    const x = await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages/'+num(refSeq)+'/sources',undefined,signal);
    return arr(x.sources).slice(0,50).map(value => { const s = obj(value), url = displayLine(s.url, 2048);
      if (!/^https?:\/\//i.test(url) || (s.kind !== 'read' && s.kind !== 'cited')) throw new ProtocolError('invalid source');
      return { url, kind: s.kind }; });
  }
  /** The visible conversation as Markdown text. */
  async exportThread(threadId: string, signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode(await this.downloadPath('/v1/threads/'+idPath(threadId)+'/export', signal));
  }
  /** Context size and cumulative tokens of one Session; undefined when the server does not report them. */
  async threadUsage(threadId: string, signal?: AbortSignal): Promise<ThreadUsage | undefined> {
    if (!this.supportsThreadUsage) return undefined;
    const usage = parseThreadUsage(await this.call('GET','/v1/threads/'+idPath(threadId)+'/usage',undefined,signal), threadId);
    if (!usage) throw new ProtocolError('invalid usage');
    return usage;
  }
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
  /** Settings > Passwords & Logins. Secret values go to the server once and are never returned. */
  async vaultItems(signal?:AbortSignal):Promise<VaultItem[]> {const x=await this.call('GET','/v1/vault/items',undefined,signal);return arr(x.items).map(validVaultItem)}
  async addVaultItem(item:NewVaultItem):Promise<VaultItem> {const x=await this.call('POST','/v1/vault/items',item);return validVaultItem(x.item)}
  async removeVaultItem(id:string):Promise<boolean> {const x=await this.call('DELETE','/v1/vault/items/'+idPath(id));return x.removed===true}
  /** Servers with vault_manage. The item gets a new ID; the old one is gone. */
  async updateVaultItem(id:string,change:VaultItemChange):Promise<VaultItem> {const x=await this.call('PUT','/v1/vault/items/'+idPath(id),change);return validVaultItem(x.item)}
  /** Servers with vault_manage: one CSV export (iCloud Passwords, Bitwarden, Chrome, Firefox, 1Password) as text. */
  async importVaultCsv(csv:string):Promise<VaultImportResult> {if(csv.length>VAULT_IMPORT_MAX_BYTES)throw new Error('vault import file is too large');const x=await this.call('POST','/v1/vault/import',{csv});const n=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:0;const s=obj(x.skipped);return {added:n(x.added),updated:n(x.updated),unchanged:n(x.unchanged),otp_skipped:n(x.otp_skipped),skipped:{not_login:n(s.not_login),no_website:n(s.no_website),no_username:n(s.no_username),no_password:n(s.no_password)}}}
  /** A 400 (a value the server cannot use, e.g. a bad authenticator key) keeps the prompt open so the user can fix it. */
  async answerVaultPrompt(item:VaultPrompt,answer:VaultPromptAnswer):Promise<void> {try{await this.call('POST','/v1/threads/'+idPath(item.thread_id)+'/vault-prompts/'+idPath(item.id)+'/answer',{generation:item.generation,...answer})}catch(error){if(error instanceof HttpError&&error.status===400)throw error;if(this.vaultPrompts.delete(item.id))this.changed();throw error}if(this.vaultPrompts.delete(item.id))this.changed()}
  async stop(threadId:string):Promise<boolean> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/stop',{});return x.stopped===true}
  async cancelQueued(threadId:string,receiptId:string):Promise<Receipt> {const x=await this.call('POST','/v1/threads/'+idPath(threadId)+'/receipts/'+idPath(receiptId)+'/cancel',{});const r=validReceipt(x.receipt);this.storeReceipt(r);return r}
  async upload(threadId:string,name:string,bytes:Uint8Array,signal?:AbortSignal):Promise<Attachment> {if(!this.options.http.upload)throw new ProtocolError('binary upload unavailable');const reply=await bounded(s=>this.options.http.upload!('/v1/threads/'+idPath(threadId)+'/attachments',this.token(),name,bytes,s),transferTimeout(this.options.requestTimeoutMs,bytes.byteLength),signal);return this.uploaded(threadId,reply)}
  /** Upload a local file through the transport without reading it into memory. */
  async uploadFile(threadId:string,name:string,file:LocalFile,signal?:AbortSignal):Promise<Attachment> {if(!this.options.http.uploadFile)throw new ProtocolError('file upload unavailable');const reply=await bounded(s=>this.options.http.uploadFile!('/v1/threads/'+idPath(threadId)+'/attachments',this.token(),name,file,s),transferTimeout(this.options.requestTimeoutMs,file.size),signal);return this.uploaded(threadId,reply)}
  get supportsFileTransfer():boolean {return Boolean(this.options.http.uploadFile&&this.options.http.downloadFile)}
  /**
   * Upload a large local file in ordered chunks (requires `supportsChunkedUpload`). Only one chunk is in
   * memory at a time. A lost reply or a network failure retries from the byte the server confirmed; after
   * repeated failures the server upload is deleted and the error is thrown.
   */
  async uploadChunked(threadId:string,name:string,size:number,read:ChunkReader,signal?:AbortSignal,onProgress?:(sent:number,size:number)=>void):Promise<Attachment> {
    if(!this.supportsChunkedUpload||!this.options.http.uploadChunk)throw new ProtocolError('chunked upload unavailable');
    if(!Number.isSafeInteger(size)||size<1||size>this.uploadMaxBytes)throw new ProtocolError('upload size unsupported');
    const base='/v1/threads/'+idPath(threadId)+'/uploads';
    const created=obj((await this.call('POST',base,{name,size},signal)).upload);
    const url=base+'/'+idPath(str(created.id)), step=Math.min(64*1024*1024,Math.max(1024*1024,num(created.chunk_size)));
    const received=(body:unknown):number=>{const value=num(obj(obj(body).upload).received);if(!Number.isSafeInteger(value)||value<0||value>size)throw new ProtocolError('invalid upload state');return value};
    // Retry a step on network/server failures, resyncing the confirmed offset in between.
    const retrying=async<T>(attempt:()=>Promise<T>,resync:()=>Promise<void>):Promise<T>=>{
      for(let failures=0;;failures++){
        try{return await attempt()}catch(error){
          if(signal?.aborted||!isRetryableError(error)||failures>=CHUNK_RETRIES)throw error;
          await pause(Math.min(1000*2**failures,15000),signal);
          await resync().catch(()=>{});
        }
      }
    };
    let offset=0;
    try{
      const resync=async()=>{offset=received(await this.call('GET',url,undefined,signal))};
      while(offset<size){
        await retrying(async()=>{
          const length=Math.min(step,size-offset),start=offset,bytes=await read(start,length);
          if(bytes.byteLength!==length)throw new ProtocolError('local file changed');
          const reply=await bounded(s=>this.options.http.uploadChunk!(url+'?offset='+start,this.token(),bytes,s),transferTimeout(this.options.requestTimeoutMs,length),signal);
          // 409 carries the confirmed offset after a retried or out-of-order chunk.
          if(reply.status!==200&&reply.status!==409)throw new HttpError(reply.status,reply.retryAfterMs,'upload');
          offset=received(reply.body);
        },resync);
        onProgress?.(offset,size);
      }
      const done=await retrying(()=>this.call('POST',url+'/complete',undefined,signal),async()=>{});
      return this.uploaded(threadId,{status:201,body:done});
    }catch(error){
      void this.call('DELETE',url).catch(()=>{});
      throw error;
    }
  }
  private uploaded(threadId:string,reply:HttpReply):Attachment {if(reply.status!==201)throw new HttpError(reply.status,reply.retryAfterMs,'upload');const x=obj(reply.body),raw=obj(x.attachment);const a=validAttachment({...raw,state:'available',receipt_id:null});if(a.thread_id!==threadId)throw new ProtocolError('attachment thread mismatch');this.attachments.set(a.id,a);this.changed();return a}
  async getAttachment(threadId:string,id:string,signal?:AbortSignal):Promise<Attachment> {const epoch=this.projectionEpoch;const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id)+'/metadata',undefined,signal);const a=validAttachment(x.attachment);if(a.id!==id||a.thread_id!==threadId)throw new ProtocolError('attachment identity mismatch');if(epoch!==this.projectionEpoch)return a;this.attachments.set(id,a);this.changed();return a}
  async download(threadId:string,id:string,signal?:AbortSignal):Promise<Uint8Array> {if(!this.options.http.download)throw new ProtocolError('binary download unavailable');const reply=await bounded(s=>this.options.http.download!('/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id),this.token(),s),transferTimeout(this.options.requestTimeoutMs,this.attachments.get(id)?.size),signal);if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,undefined,'download');return reply.body}
  /** Download an attachment into a local file (destination URI) without holding it in memory. Returns the written size. */
  async downloadFile(threadId:string,id:string,destination:string,signal?:AbortSignal,onProgress?:TransferProgress):Promise<number> {return this.transferToFile(threadId,id,destination,this.attachments.get(id)?.size,signal,onProgress)}
  /** Streams one attachment to a local file. No chat cache is read or written; `files.downloadFile` uses it for files of Sessions that are not open. */
  protected async transferToFile(threadId:string,id:string,destination:string,size:number|undefined,signal?:AbortSignal,onProgress?:TransferProgress):Promise<number> {if(!this.options.http.downloadFile)throw new ProtocolError('file download unavailable');const reply=await bounded(s=>this.options.http.downloadFile!('/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id),this.token(),destination,s,onProgress),transferTimeout(this.options.requestTimeoutMs,size),signal);if(reply.status<200||reply.status>=300)throw new HttpError(reply.status,undefined,'download');return reply.size}
  async deleteUnattached(threadId:string,id:string):Promise<void> {const x=await this.call('DELETE','/v1/threads/'+idPath(threadId)+'/attachments/'+idPath(id));if(x.deleted!==true)throw new ProtocolError('delete not confirmed');this.attachments.set(id,{id,thread_id:threadId,state:'deleted'});this.changed()}
  async search(threadId:string,text:string,after?:string,limit=20,signal?:AbortSignal) {const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/search'+query({q:text,after,limit}),undefined,signal);return {messages:arr(x.messages).map(validMessage),next_cursor:optionalCursor(x.next_cursor)}}
  async history(threadId: string, after?: string, limit = 50, signal?: AbortSignal, afterRefSeq?:number, refSeq?:number, throughRefSeq?:number, full = false) {
    if(full&&!this.supportsFullHistory)throw new ProtocolError('Server does not support complete history');
    const seq=++this.fetchSequence, epoch=this.projectionEpoch;
    const x=await this.call('GET','/v1/threads/'+idPath(threadId)+'/messages'+query(full?{full:'true'}:{after,after_ref_seq:afterRefSeq,ref_seq:refSeq,through_ref_seq:throughRefSeq,limit}),undefined,signal,undefined,full?60000:undefined);
    if(full&&(x.complete!==true||x.next_cursor!==null||x.older_cursor!==null))throw new ProtocolError('Incomplete full history response');
    const page=arr(x.messages).map(validMessage); const existing=this.messages.get(threadId)||[];
    if(full&&page.some((m,i)=>i>0&&m.ref_seq<=page[i-1].ref_seq))throw new ProtocolError('Full history order mismatch');
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
    // Attachments first: changed() makes LivePageClient mirror them for the desktop's image reads.
    for(const m of page)for(const a of m.attachments||[])this.attachments.set(a.id,a);
    this.messages.set(threadId,[...byRef.values()].sort((a,b)=>a.ref_seq-b.ref_seq)); this.changed();
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

  /** Release server content only; directory, credentials and durable input are not touched. */
  protected releaseContent(): void {
    ++this.projectionEpoch;
    this.messages.clear();this.receipts.clear();this.receiptIdentity.clear();this.interactions.clear();this.vaultPrompts.clear();this.attachments.clear();this.drafts.clear();
    this.messageSequence.clear();this.tailIncomplete.clear();this.tailContinuations.clear();this.tailRecoveryJobs.clear();this.knownEmptyThreads.clear();
  }
  protected retainContent(threadId:string|null): void {
    for(const id of this.messages.keys())if(id!==threadId)this.messages.delete(id);
    for(const id of this.drafts.keys())if(id!==threadId)this.drafts.delete(id);
    for(const [id,row]of this.receipts)if(row.thread_id!==threadId){this.receipts.delete(id);this.receiptIdentity.delete(id)}
    for(const [id,row]of this.interactions)if(row.thread_id!==threadId)this.interactions.delete(id);
    for(const [id,row]of this.vaultPrompts)if(row.thread_id!==threadId)this.vaultPrompts.delete(id);
    for(const [id,row]of this.attachments)if(row.thread_id!==threadId)this.attachments.delete(id);
    for(const key of this.messageSequence.keys())if(threadId===null||!key.startsWith(threadId+':'))this.messageSequence.delete(key);
    for(const id of this.knownEmptyThreads)if(id!==threadId)this.knownEmptyThreads.delete(id);
    for(const id of this.tailIncomplete)if(id!==threadId)this.tailIncomplete.delete(id);
    for(const id of this.tailContinuations.keys())if(id!==threadId)this.tailContinuations.delete(id);
    for(const id of this.tailRecoveryJobs.keys())if(id!==threadId)this.tailRecoveryJobs.delete(id);
  }
  protected decodeScopedState(value:unknown,threadId:string):{receipts:Receipt[];interactions:Interaction[];vaultPrompts:VaultPrompt[]} {
    const body=obj(value);if(body.thread_id!==threadId)throw new ProtocolError('live state identity mismatch');
    const receipts=arr(body.active_receipts).map(validReceipt),interactions=arr(body.pending_interactions).map(validInteraction);
    if(receipts.length>32||interactions.length>20||receipts.some(r=>r.thread_id!==threadId)||interactions.some(i=>i.thread_id!==threadId))throw new ProtocolError('live state scope mismatch');
    const vaultPrompts=body.vault_prompts===undefined?[]:arr(body.vault_prompts).map(validVaultPrompt);
    if(vaultPrompts.length>20||vaultPrompts.some(p=>p.thread_id!==threadId))throw new ProtocolError('live state scope mismatch');
    return {receipts,interactions,vaultPrompts};
  }

  close() { this.releaseContent(); this.state('suspended') }
}
