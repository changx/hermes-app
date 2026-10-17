import type { ChildProcess } from 'node:child_process';
import { BrowserControlError } from '../shared/browser-control';

/**
 * Minimal MCP client sessions used by the desktop app: one stdio session (newline-delimited
 * JSON-RPC) and one Streamable HTTP session. Both implement only what tool use needs:
 * initialize, tools/list, tools/call, cancellation and ping. See docs/desktop-mcp-host.md.
 */

export const MCP_PROTOCOL = '2025-06-18';
const MAX_LINE = 64 * 1024 * 1024;
const MAX_STDERR = 2000;

export interface McpSession {
  readonly ready: Promise<void>;
  readonly closed: boolean;
  request(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): void;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Message = { id?: unknown; method?: unknown; result?: unknown; error?: { message?: string } };
const initializeParams = () => ({ protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'hermes-app-desktop', version: '1' } });

/** Answer for a request the server sends to us: ping is answered, everything else is not supported. */
function serverRequestAnswer(message: Message): Record<string, unknown> {
  return message.method === 'ping'
    ? { jsonrpc: '2.0', id: message.id, result: {} }
    : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported by Hermes' } };
}

/** One stdio MCP session over a child process. `label` names the server in error messages. */
export class StdioSession implements McpSession {
  private nextId = 0;
  private buffer = '';
  private stderr = '';
  private readonly pending = new Map<number, Pending>();
  readonly ready: Promise<void>;
  closed = false;
  /** Why the process could not start (for example ENOENT), when known. */
  startError?: string;
  constructor(private readonly child: ChildProcess, private readonly label = 'Cua Driver', initTimeoutMs = 30_000) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.read(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-MAX_STDERR); });
    child.on('error', (error: NodeJS.ErrnoException) => { this.startError = error.code ?? error.message; this.close(); });
    child.on('close', () => this.close());
    child.stdin?.on('error', () => this.close());
    this.ready = this.request('initialize', initializeParams(), initTimeoutMs)
      .then(() => { this.notify('notifications/initialized'); });
  }
  /** The last lines the server wrote to stderr; shown when it fails to start. */
  stderrTail(): string { return this.stderr.trim(); }
  private read(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE) { this.close(); return; }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message: Message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object') continue;
      if (typeof message.method === 'string') {
        // A request or notification from the server. Requests need an answer, or the server may wait forever.
        if (message.id !== undefined && message.id !== null) { try { this.write(serverRequestAnswer(message)); } catch { /* closed */ } }
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const waiter = this.pending.get(message.id);
      if (!waiter) continue;
      if (message.error) waiter.reject(new BrowserControlError('driver_error', String(message.error.message ?? `${this.label} error.`).slice(0, 2000)));
      else waiter.resolve(message.result);
    }
  }
  private write(body: Record<string, unknown>): void {
    if (this.closed || !this.child.stdin?.writable) throw new BrowserControlError('unknown', `${this.label} stopped.`);
    this.child.stdin.write(JSON.stringify(body) + '\n');
  }
  private send(body: Record<string, unknown>): void { this.write({ jsonrpc: '2.0', ...body }); }
  notify(method: string, params?: Record<string, unknown>): void { try { this.send({ method, ...(params ? { params } : {}) }); } catch { /* closed */ } }
  request(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new BrowserControlError('cancelled', 'Stopped.')); return; }
      const id = ++this.nextId;
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.pending.delete(id); };
      const onAbort = () => { finish(); this.notify('notifications/cancelled', { requestId: id }); reject(new BrowserControlError('cancelled', 'Stopped.')); };
      // No answer in time: the result is unknown and the session may be stuck, so it is replaced.
      const timer = setTimeout(() => { finish(); this.close(); reject(new BrowserControlError('unknown', `${this.label} did not answer in time.`)); }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } });
      try { this.send({ id, method, params }); } catch (error) { finish(); reject(error as Error); }
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of [...this.pending.values()]) waiter.reject(new BrowserControlError('unknown', `${this.label} stopped during the action.`));
    this.pending.clear();
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }
}

type Fetch = typeof fetch;

/** Reads one JSON-RPC answer with `id` from a text/event-stream body. */
async function readEventStream(body: ReadableStream<Uint8Array>, id: number, onRequest: (message: Message) => void): Promise<Message | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_LINE) return undefined;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); continue; }
        if (line !== '' || !data.length) continue;
        const text = data.join('\n'); data = [];
        let message: Message;
        try { message = JSON.parse(text); } catch { continue; }
        if (!message || typeof message !== 'object') continue;
        if (typeof message.method === 'string') { if (message.id !== undefined && message.id !== null) onRequest(message); continue; }
        if (message.id === id) return message;
      }
    }
  } finally { void reader.cancel().catch(() => undefined); }
}

/** One Streamable HTTP MCP session. The older HTTP+SSE transport is not supported. */
export class HttpSession implements McpSession {
  private nextId = 0;
  private sessionId?: string;
  private initialized = false;
  private readonly lifetime = new AbortController();
  readonly ready: Promise<void>;
  closed = false;
  constructor(private readonly url: string, private readonly headers: Readonly<Record<string, string>> = {},
    private readonly label = 'MCP server', private readonly fetchImpl: Fetch = fetch, initTimeoutMs = 30_000) {
    this.ready = this.request('initialize', initializeParams(), initTimeoutMs)
      .then(() => { this.initialized = true; this.notify('notifications/initialized'); });
  }
  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.initialized ? { 'mcp-protocol-version': MCP_PROTOCOL } : {}),
    };
  }
  private post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(this.url, { method: 'POST', headers: this.requestHeaders(), body: JSON.stringify({ jsonrpc: '2.0', ...body }), signal, redirect: 'error' });
  }
  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed) return;
    void this.post({ method, ...(params ? { params } : {}) }, this.lifetime.signal).then(r => r.body?.cancel()).catch(() => undefined);
  }
  private answerServer(message: Message): void {
    if (this.closed) return;
    void this.fetchImpl(this.url, { method: 'POST', headers: this.requestHeaders(), body: JSON.stringify(serverRequestAnswer(message)), signal: this.lifetime.signal, redirect: 'error' })
      .then(r => r.body?.cancel()).catch(() => undefined);
  }
  async request(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) throw new BrowserControlError('unknown', `${this.label} stopped.`);
    if (signal?.aborted) throw new BrowserControlError('cancelled', 'Stopped.');
    const id = ++this.nextId;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signals = [this.lifetime.signal, timeout.signal, ...(signal ? [signal] : [])];
    const combined = AbortSignal.any(signals);
    try {
      const response = await this.post({ id, method, params }, combined);
      if (method === 'initialize') { const sid = response.headers.get('mcp-session-id'); if (sid) this.sessionId = sid; }
      if (response.status === 404 && this.sessionId) { this.close(); throw new BrowserControlError('unknown', `${this.label} ended the session.`); }
      if (!response.ok) { void response.body?.cancel(); throw new BrowserControlError('driver_error', `${this.label} answered HTTP ${response.status}.`); }
      const type = (response.headers.get('content-type') ?? '').toLowerCase();
      let message: Message | undefined;
      if (type.includes('text/event-stream') && response.body) {
        message = await readEventStream(response.body, id, m => this.answerServer(m));
      } else {
        const text = await response.text();
        if (text.length > MAX_LINE) throw new BrowserControlError('driver_error', `${this.label} sent too much data.`);
        const body = JSON.parse(text) as Message | Message[];
        message = Array.isArray(body) ? body.find(m => m && m.id === id) : body;
      }
      if (!message) throw new BrowserControlError('unknown', `${this.label} closed the answer without a result.`);
      if (message.error) throw new BrowserControlError('driver_error', String(message.error.message ?? `${this.label} error.`).slice(0, 2000));
      return message.result;
    } catch (error) {
      if (error instanceof BrowserControlError) throw error;
      if (signal?.aborted) { this.notify('notifications/cancelled', { requestId: id }); throw new BrowserControlError('cancelled', 'Stopped.'); }
      if (timeout.signal.aborted) { this.close(); throw new BrowserControlError('unknown', `${this.label} did not answer in time.`); }
      if (this.lifetime.signal.aborted) throw new BrowserControlError('unknown', `${this.label} stopped during the action.`);
      if (error instanceof SyntaxError) throw new BrowserControlError('driver_error', `${this.label} sent an answer that is not valid JSON.`);
      throw new BrowserControlError(this.initialized ? 'unknown' : 'driver_error', `${this.label} could not be reached: ${(error as Error).message.slice(0, 300)}`);
    } finally { clearTimeout(timer); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    if (this.sessionId) void this.fetchImpl(this.url, { method: 'DELETE', headers: { ...this.headers, 'mcp-session-id': this.sessionId }, redirect: 'error' }).then(r => r.body?.cancel()).catch(() => undefined);
  }
}
