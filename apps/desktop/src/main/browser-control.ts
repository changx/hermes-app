import WebSocket from 'ws';
import { trackSocket } from './socket-registry';
import { BROWSER_ACTIONS, BROWSER_PROTOCOL, BrowserControlError, MAC_ACTION, MCP_ACTION, parseServerFrame, type BrowserCommand } from '../shared/browser-control';
import type { DesktopTabKind } from '../shared/desktop-api';

/** One paired server the desktop may receive browser commands from. */
export type BrowserAccount = Readonly<{
  connectionKey: string; baseUrl: string; token: string;
  /** Wire Thread/Project ID -> desktop (qualified) ID, and back. */
  qualify(raw: string): string; unqualify(id: string): string | undefined;
}>;
export type BrowserTab = Readonly<{ id: string; threadId?: string; connectionKey?: string; kind: DesktopTabKind }>;
export type BrowserControlDeps = Readonly<{
  accounts(): readonly BrowserAccount[];
  tabs(): readonly BrowserTab[];
  activeTabId(): string | undefined;
  windowFocused(): boolean;
  /** Desktop Thread ID -> desktop Project ID, computed once per report. */
  channels(): ReadonlyMap<string, string>;
  /** Returns the tab for a conversation, opening it in the background when needed. */
  ensureTab(threadId: string): Promise<BrowserTab>;
  execute(tabId: string, command: BrowserCommand, signal: AbortSignal): Promise<Record<string, unknown>>;
  /** Native Mac app control; offered to the server only while the driver is installed. */
  mac?: Readonly<{ available(): boolean; run(args: BrowserCommand['args'], signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> }>;
  /** MCP servers configured on this computer; the enabled names are reported with the bindings. */
  mcp?: Readonly<{ servers(): readonly string[]; run(args: BrowserCommand['args'], signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> }>;
  deviceName: string;
  connect?: (url: string, token: string) => WebSocket;
}>;
type Link = { account: BrowserAccount; key: string; ws?: WebSocket; ready: boolean; retry?: NodeJS.Timeout; attempt: number; blocked: boolean; bindings?: string };

const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];
const MISSING_ENDPOINT_RETRY_MS = 5 * 60_000;

/**
 * Desktop side of the App-side browser tools. Commands run on the conversation's own tab browser.
 * A command whose connection drops is aborted locally; the server reports its result as unknown
 * and never resends it. Duplicate command IDs are answered from the finished cache.
 */
export class DesktopBrowserControl {
  private readonly links = new Map<string, Link>();
  private readonly running = new Map<string, { abort: AbortController; link: Link }>();
  private readonly finished = new Map<string, string>();
  private readonly focusedAt = new Map<string, number>();
  private lastFocus = 0;
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(private readonly deps: BrowserControlDeps) {}

  /** Reconciles connections and reports open conversations. Cheap; debounced. */
  sync(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.reconcile(); }, 150);
  }
  private reconcile(): void {
    if (this.closed) return;
    const accounts = this.deps.accounts(), wanted = new Map(accounts.map(account => [account.connectionKey, account]));
    for (const [key, link] of this.links) {
      const account = wanted.get(key);
      if (!account || account.baseUrl + account.token !== link.key) this.drop(link);
    }
    for (const account of accounts) {
      const link = this.links.get(account.connectionKey);
      if (!link) { const created: Link = { account, key: account.baseUrl + account.token, ready: false, attempt: 0, blocked: false }; this.links.set(account.connectionKey, created); this.open(created); }
      else link.account = account;
    }
    const focused = this.deps.windowFocused(), active = this.deps.activeTabId();
    if (focused) this.lastFocus = Date.now();
    const channels = this.links.size ? this.deps.channels() : new Map<string, string>();
    for (const link of this.links.values()) this.sendBindings(link, focused, active, channels);
  }
  private sendBindings(link: Link, focused: boolean, active: string | undefined, channels: ReadonlyMap<string, string>): void {
    if (!link.ready || !link.ws) return;
    const threads = this.deps.tabs().flatMap(tab => {
      if (tab.kind !== 'session' || !tab.threadId || tab.connectionKey !== link.account.connectionKey) return [];
      const raw = link.account.unqualify(tab.threadId); if (!raw) return [];
      const isActive = focused && tab.id === active;
      if (isActive) this.focusedAt.set(tab.threadId, Date.now());
      const channel = channels.get(tab.threadId), rawChannel = channel ? link.account.unqualify(channel) : undefined;
      return [{ thread_id: raw, channel_id: rawChannel ?? null, active: isActive, focused_at: this.focusedAt.get(tab.threadId) ?? 0 }];
    }).slice(0, 64);
    // Older servers ignore mcp_servers.
    const body = JSON.stringify({ type: 'bindings', focused_at: this.lastFocus, threads, ...(this.deps.mcp ? { mcp_servers: this.deps.mcp.servers().slice(0, 64) } : {}) });
    if (body === link.bindings) return;
    link.bindings = body; link.ws.send(body);
  }
  private open(link: Link): void {
    if (this.closed || link.blocked) return;
    const url = link.account.baseUrl.replace(/^http/, 'ws') + '/v1/desktop-browser';
    let ws: WebSocket;
    try { ws = this.deps.connect ? this.deps.connect(url, link.account.token) : trackSocket(new WebSocket(url, { headers: { Authorization: `Bearer ${link.account.token}` }, followRedirects: false, maxPayload: 1024 * 1024, handshakeTimeout: 15_000 })); }
    catch { this.retry(link); return; }
    link.ws = ws; link.ready = false; link.bindings = undefined;
    ws.on('message', (data, binary) => {
      if (binary || link.ws !== ws) return;
      let frame;
      try { frame = parseServerFrame(data.toString()); } catch { ws.close(1008); return; }
      if (!frame) return;
      if (frame.type === 'hello') {
        if (frame.protocol !== BROWSER_PROTOCOL) { link.blocked = true; ws.close(1000); return; }
        ws.send(JSON.stringify({ type: 'hello', protocol: BROWSER_PROTOCOL, device_name: this.deps.deviceName.slice(0, 64), actions: [...BROWSER_ACTIONS, ...(this.deps.mac?.available() ? [MAC_ACTION] : []), ...(this.deps.mcp ? [MCP_ACTION] : [])] }));
        link.ready = true; link.attempt = 0;
        this.sendBindings(link, this.deps.windowFocused(), this.deps.activeTabId(), this.deps.channels());
      } else if (frame.type === 'cancel') this.running.get(frame.id)?.abort.abort();
      else if (link.ready) void this.run(link, frame.command);
    });
    ws.on('unexpected-response', (_request, response) => {
      // An older plugin has no browser endpoint; a rejected credential waits for re-pairing.
      if (response.statusCode === 401 || response.statusCode === 403) link.blocked = true;
      link.attempt = response.statusCode === 404 ? -1 : link.attempt;
    });
    ws.on('error', () => { /* Reported through close. */ });
    ws.on('close', () => {
      if (link.ws !== ws) return;
      link.ws = undefined; link.ready = false;
      for (const [id, entry] of this.running) if (entry.link === link) { entry.abort.abort(); this.running.delete(id); }
      if (this.links.get(link.account.connectionKey) === link) this.retry(link);
    });
  }
  private retry(link: Link): void {
    if (this.closed || link.blocked || link.retry) return;
    const delay = link.attempt < 0 ? MISSING_ENDPOINT_RETRY_MS : RETRY_MS[Math.min(link.attempt, RETRY_MS.length - 1)];
    link.attempt = link.attempt < 0 ? 0 : link.attempt + 1;
    link.retry = setTimeout(() => { link.retry = undefined; if (this.links.get(link.account.connectionKey) === link) this.open(link); }, delay);
  }
  private drop(link: Link): void {
    this.links.delete(link.account.connectionKey);
    if (link.retry) clearTimeout(link.retry);
    const ws = link.ws; link.ws = undefined; link.ready = false;
    for (const [id, entry] of this.running) if (entry.link === link) { entry.abort.abort(); this.running.delete(id); }
    ws?.close(1000);
  }
  private async run(link: Link, command: BrowserCommand): Promise<void> {
    if (this.running.has(command.id)) return;
    const cached = this.finished.get(command.id);
    if (cached) { link.ws?.send(cached); return; }
    const abort = new AbortController();
    this.running.set(command.id, { abort, link });
    let frame: Record<string, unknown>;
    try {
      if (command.action === MCP_ACTION) {
        // MCP servers need no conversation tab.
        if (!this.deps.mcp) throw new BrowserControlError('no_server', 'No MCP servers on this computer.');
        frame = { type: 'result', id: command.id, ok: true, result: await this.deps.mcp.run(command.args, abort.signal, command.timeoutMs) };
      } else if (command.action === MAC_ACTION) {
        // Mac app control needs no conversation tab.
        if (!this.deps.mac) throw new BrowserControlError('no_driver', 'Cua Driver is not installed on this Mac.');
        frame = { type: 'result', id: command.id, ok: true, result: await this.deps.mac.run(command.args, abort.signal, command.timeoutMs) };
      } else {
        const tab = await this.deps.ensureTab(link.account.qualify(command.threadId));
        if (abort.signal.aborted) throw new BrowserControlError('cancelled', 'Stopped.');
        frame = { type: 'result', id: command.id, ok: true, result: await this.deps.execute(tab.id, command, abort.signal) };
      }
    } catch (error) {
      const failure = error instanceof BrowserControlError ? error : new BrowserControlError('failed', 'The browser action failed.');
      frame = { type: 'result', id: command.id, ok: false, error: { code: failure.code, message: failure.message.slice(0, 2000) } };
    } finally { this.running.delete(command.id); }
    const body = JSON.stringify(frame);
    this.finished.set(command.id, body);
    if (this.finished.size > 100) this.finished.delete(this.finished.keys().next().value!);
    if (link.ws && link.ready && this.links.get(link.account.connectionKey) === link) link.ws.send(body);
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const link of [...this.links.values()]) this.drop(link);
  }
}
