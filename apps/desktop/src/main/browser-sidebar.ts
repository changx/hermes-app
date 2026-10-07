import { app, dialog, ipcMain, session as electronSession, WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DesktopBrowserState } from '../shared/desktop-api';
import { browserUrl, chromeUserAgent, pdfExtension, pdfViewerResource, previewResponse, type PreviewDocument } from '../shared/browser-policy';
import { BrowserControlError, blockedSubresource, clientHints, CONTROL_TEXT, InputLedger, keyFor, navigable, validUserAgentData, withClientHints, type BrowserAction, type BrowserControlState, type UserAgentData } from '../shared/browser-control';

type Bounds = { x: number; y: number; width: number; height: number; visible: boolean };
type PreviewState = { host: string; file: PreviewDocument; resolve?: (name: string) => Promise<PreviewDocument | undefined>; resources: Map<string, PreviewDocument>; pending: Map<string, Promise<PreviewDocument | undefined>>; size: number };
type Pane = {
  id: string; view: WebContentsView; state: DesktopBrowserState; document?: PreviewState; generation: number; previewRequest: number; partition: string;
  control?: BrowserControlState; ledger: InputLedger; idle?: NodeJS.Timeout; resume: Set<() => void>; handoff?: () => void; action?: AbortController;
  requests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
};
type SessionState = { session: Session; panes: Set<Pane>; decisions: Map<string, boolean>; asking: Map<string, Promise<boolean>> };

/** Logins persist per Project (Channel); see docs/desktop-browser-control.md. */
export function browserPartition(connectionKey?: string, channelId?: string): string {
  const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20);
  return `persist:hermes-browser-${digest(connectionKey || 'local')}-${channelId ? digest(channelId) : 'default'}`;
}

const AGENT_IDLE_MS = 20_000;
const TAKEOVER_WAIT_MS = 290_000;
const BACKGROUND_SIZE = { width: 1024, height: 768 };
const SAFE_PERMISSIONS = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock']);
const PERMISSION_TEXT: Record<string, string> = {
  media: 'use your camera or microphone', geolocation: 'know your location', notifications: 'show notifications',
  'clipboard-read': 'see text and images you copy', midi: 'use MIDI devices', midiSysex: 'use MIDI devices',
  openExternal: 'open another app', 'display-capture': 'share your screen', hid: 'connect to a device', serial: 'connect to a device',
  usb: 'connect to a device', 'idle-detection': 'know when you are away', 'storage-access': 'use its cookies on this site',
  'top-level-storage-access': 'use its cookies on this site', 'window-management': 'place windows on your screens',
};

const sessions = new Map<string, SessionState>();
const byContents = new Map<number, { owner: DesktopBrowserSidebar; pane: Pane }>();
let owner: DesktopBrowserSidebar | undefined;
let ipcReady = false;
let userAgentData: UserAgentData | undefined;
let userAgentLoaded = false;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const originOf = (value: string | undefined) => { try { const url = new URL(value ?? ''); return /^https?:$/.test(url.protocol) ? url.origin : undefined; } catch { return undefined; } };

function userAgentFile(): string | undefined { try { return join(app.getPath('userData'), 'browser-user-agent.json'); } catch { return undefined; } }
function hints(): Record<string, string> | undefined {
  if (!userAgentLoaded) {
    userAgentLoaded = true;
    try { const file = userAgentFile(), saved = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined; if (saved?.chrome === process.versions.chrome) userAgentData = validUserAgentData(saved.data); } catch { /* Learned again from the next page. */ }
  }
  return userAgentData ? clientHints(userAgentData) : undefined;
}
function learnUserAgent(value: unknown): void {
  const data = validUserAgentData(value);
  if (!data || JSON.stringify(data) === JSON.stringify(userAgentData)) return;
  userAgentData = data; userAgentLoaded = true;
  try { const file = userAgentFile(); if (file) writeFileSync(file, JSON.stringify({ chrome: process.versions.chrome, data })); } catch { /* Kept in memory. */ }
}

function registerIpc(): void {
  if (ipcReady) return; ipcReady = true;
  // Only the main frame of a browser pane may answer, and only its own pending requests.
  ipcMain.on('hermes-browser:response', (event, message: { id?: unknown; ok?: unknown; result?: unknown; code?: unknown; message?: unknown }) => {
    const entry = byContents.get(event.sender.id);
    if (!entry || event.senderFrame !== event.sender.mainFrame || typeof message?.id !== 'string') return;
    const request = entry.pane.requests.get(message.id); if (!request) return;
    entry.pane.requests.delete(message.id); clearTimeout(request.timer);
    if (message.ok === true) request.resolve(message.result);
    else request.reject(new BrowserControlError(typeof message.code === 'string' ? message.code.slice(0, 40) : 'failed', typeof message.message === 'string' ? message.message.slice(0, 300) : 'The page could not be read.'));
  });
  ipcMain.on('hermes-browser:user-agent', (event, value: unknown) => { if (byContents.has(event.sender.id) && event.senderFrame === event.sender.mainFrame) learnUserAgent(value); });
}

function uniqueDownload(directory: string, name: string): string {
  const safe = basename(name).replace(/[\\/:\x00-\x1f]/g, '_') || 'download', ext = extname(safe), stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(directory, safe);
  for (let i = 1; existsSync(candidate) && i < 1000; i++) candidate = join(directory, `${stem} (${i})${ext}`);
  return candidate;
}

export type BrowserSidebarOptions = {
  /** Resolves the persistent partition for a tab (per Project). */
  partitionFor?: (tabId: string) => string;
  /** Asks the user about a site permission. Tests replace it. */
  askPermission?: (host: string, text: string) => Promise<boolean>;
  downloadsDirectory?: () => string;
  preload?: string;
};

export class DesktopBrowserSidebar {
  readonly panes = new Map<string, Pane>();
  private bounds: Bounds = { x: 0, y: 48, width: 0, height: 0, visible: false };
  private active?: string;
  private visible = false;
  private closed = false;
  constructor(private readonly window: BrowserWindow, private readonly changed: () => void, private readonly shortcuts?: (contents: WebContents) => void, private readonly options: BrowserSidebarOptions = {}) {
    owner = this; registerIpc();
  }
  state(id?: string): DesktopBrowserState | undefined { return id ? this.panes.get(id)?.state : undefined; }
  private update(id: string, patch: Partial<DesktopBrowserState>): void {
    const pane = this.panes.get(id); if (!pane || this.closed) return;
    pane.state = { ...pane.state, ...patch }; this.changed();
  }
  private ask(host: string, text: string): Promise<boolean> {
    if (this.options.askPermission) return this.options.askPermission(host, text);
    const parent = this.window.isDestroyed() ? undefined : this.window;
    const box = { type: 'question' as const, buttons: ['Allow', 'Don’t Allow'], defaultId: 1, cancelId: 1, message: `${host} wants to ${text}.`, detail: 'Hermes remembers your choice until you quit.' };
    return (parent ? dialog.showMessageBox(parent, box) : dialog.showMessageBox(box)).then(result => result.response === 0, () => false);
  }
  private sessionFor(partition: string): SessionState {
    const existing = sessions.get(partition); if (existing) return existing;
    const session = electronSession.fromPartition(partition);
    const state: SessionState = { session, panes: new Set(), decisions: new Map(), asking: new Map() };
    sessions.set(partition, state);
    session.setUserAgent(chromeUserAgent(process.platform, process.versions.chrome));
    const decide = (permission: string, origin: string | undefined): Promise<boolean> => {
      if (SAFE_PERMISSIONS.has(permission)) return Promise.resolve(true);
      if (!origin || !PERMISSION_TEXT[permission]) return Promise.resolve(false);
      const key = `${origin}|${permission}`, known = state.decisions.get(key);
      if (known !== undefined) return Promise.resolve(known);
      let pending = state.asking.get(key);
      if (!pending) {
        const current = owner && !owner.closed ? owner : this;
        pending = current.ask(new URL(origin).host, PERMISSION_TEXT[permission]).then(allowed => { state.decisions.set(key, allowed); state.asking.delete(key); return allowed; });
        state.asking.set(key, pending);
      }
      return pending;
    };
    session.setPermissionRequestHandler((contents, permission, callback, details) => { void decide(permission, originOf((details as { requestingUrl?: string }).requestingUrl ?? contents?.getURL())).then(callback); });
    session.setPermissionCheckHandler((_contents, permission, origin) => SAFE_PERMISSIONS.has(permission) || state.decisions.get(`${originOf(origin)}|${permission}`) === true);
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: blockedSubresource(details.url) && !pdfViewerResource(details) }));
    session.webRequest.onBeforeSendHeaders((details, callback) => callback({ requestHeaders: withClientHints(details.requestHeaders, hints(), details.url) }));
    session.on('will-download', (_event, item, contents) => {
      const entry = contents ? byContents.get(contents.id) : undefined, current = entry?.owner ?? owner;
      let directory: string;
      try { directory = current?.options.downloadsDirectory?.() ?? app.getPath('downloads'); mkdirSync(directory, { recursive: true }); }
      catch { item.cancel(); return; }
      const target = uniqueDownload(directory, item.getFilename());
      item.setSavePath(target);
      item.once('done', (_done, result) => {
        if (!entry || !current) return;
        current.update(entry.pane.id, result === 'completed' ? { notice: `Saved “${basename(target)}” to Downloads.`, error: undefined } : { error: 'The download did not finish.' });
      });
    });
    session.protocol.handle('hermes-preview', async request => {
      try {
        const url = new URL(request.url);
        const pane = [...state.panes].find(item => item.document?.host === url.host), doc = pane?.document;
        if (!pane || !doc || request.method !== 'GET' || url.username || url.password) return new Response('Preview unavailable', { status: 404 });
        const name = decodeURIComponent(url.pathname.slice(1));
        if (name.includes('/') || name.includes('\\') || name === '..') return new Response('Not found', { status: 404 });
        if (name === doc.file.name) return previewResponse(doc.file, false, request.headers.get('range'));
        let resource = doc.resources.get(name);
        if (!resource && doc.resolve) {
          let pending = doc.pending.get(name);
          if (!pending) {
            if (doc.resources.size + doc.pending.size >= 8) return new Response('Too many resources', { status: 413 });
            pending = doc.resolve(name); doc.pending.set(name, pending);
          }
          let result: PreviewDocument | undefined;
          try { result = await pending; } finally { doc.pending.delete(name); }
          if (pane.document !== doc) return new Response('Preview unavailable', { status: 404 });
          if (result && !doc.resources.has(name)) {
            if (doc.size + result.bytes.byteLength > 30 * 1024 * 1024) return new Response('Preview too large', { status: 413 });
            doc.size += result.bytes.byteLength; doc.resources.set(name, result);
          }
          resource = doc.resources.get(name);
        }
        return resource ? previewResponse(resource, true, request.headers.get('range')) : new Response('Not found', { status: 404 });
      } catch { return new Response('Preview unavailable', { status: 404 }); }
    });
    return state;
  }
  private create(id: string): Pane {
    const existing = this.panes.get(id); if (existing) return existing;
    if (this.closed) throw new Error('Browser is closed');
    const partition = this.options.partitionFor?.(id) ?? browserPartition(undefined, undefined), shared = this.sessionFor(partition);
    const view = new WebContentsView({ webPreferences: { session: shared.session, ...(this.options.preload ? { preload: this.options.preload } : {}), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false } });
    const pane: Pane = { id, view, partition, state: { open: true, url: '', title: 'Browser', loading: false, canGoBack: false, canGoForward: false }, generation: 0, previewRequest: 0, ledger: new InputLedger(), resume: new Set(), requests: new Map() };
    this.panes.set(id, pane); shared.panes.add(pane); this.window.contentView.addChildView(view); view.setVisible(false);
    const contents = view.webContents;
    byContents.set(contents.id, { owner: this, pane });
    this.shortcuts?.(contents);
    contents.setUserAgent(chromeUserAgent(process.platform, process.versions.chrome));
    const allowed = (value: string) => {
      if (navigable(value)) return true;
      try { const url = new URL(value); return url.protocol === 'hermes-preview:' && url.host === pane.document?.host && !url.username && !url.password; } catch { return false; }
    };
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-frame-navigate', event => { if (!allowed(event.url) && !(!event.isMainFrame && event.url.startsWith(`${pdfExtension}/`))) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!allowed(url) || url === 'about:blank') return { action: 'deny' };
      // Sign-in popups need a real window with an opener; ordinary new-tab links stay in this pane.
      if (disposition === 'new-window') return { action: 'allow', overrideBrowserWindowOptions: { parent: this.window, width: 520, height: 720, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } } };
      void this.navigate(id, url); return { action: 'deny' };
    });
    contents.on('did-create-window', child => {
      child.webContents.setUserAgent(chromeUserAgent(process.platform, process.versions.chrome));
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      child.webContents.on('will-attach-webview', event => event.preventDefault());
      child.webContents.on('will-frame-navigate', event => { if (!navigable(event.url) && event.isMainFrame) event.preventDefault(); });
    });
    // Any real press or key from the user while Hermes works on the page is a takeover.
    contents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && !pane.ledger.consume('key')) this.userInput(pane); });
    (contents as unknown as NodeJS.EventEmitter).on('before-mouse-event', (_event: unknown, mouse: { type: string; x: number; y: number }) => {
      if (mouse.type === 'mouseDown' && !pane.ledger.consume('mouse', mouse.x, mouse.y)) this.userInput(pane);
    });
    const navigation = () => this.update(id, { url: /^https?:/.test(contents.getURL()) ? contents.getURL() : '', canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() });
    contents.on('did-start-loading', () => this.update(id, { loading: true, error: undefined, notice: undefined }));
    contents.on('did-stop-loading', () => { this.update(id, { loading: false }); navigation(); });
    contents.on('did-navigate', navigation); contents.on('did-navigate-in-page', navigation);
    contents.on('page-title-updated', (_event, title) => this.update(id, { title: title.slice(0, 200) || 'Browser' }));
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) this.update(id, { loading: false, error: 'The page could not be loaded. Check the address or reload.' }); });
    contents.on('render-process-gone', () => { this.failRequests(pane, 'The page stopped.'); this.update(id, { loading: false, error: 'The browser stopped. Reload to open this page again.' }); });
    this.changed(); return pane;
  }
  startPreview(id: string): { current: () => boolean; failed: () => void } {
    const pane = this.create(id), request = ++pane.previewRequest;
    const current = () => this.panes.get(id) === pane && pane.previewRequest === request;
    this.update(id, { loading: true, title: 'Loading attachment…', error: undefined });
    return { current, failed: () => { if (current()) this.update(id, { loading: false, error: 'The attachment could not be previewed. Try Save or Open externally.' }); } };
  }
  async open(id: string, url?: string): Promise<void> { if (url !== undefined) browserUrl(url); this.create(id); await this.navigate(id, url === undefined ? 'about:blank' : browserUrl(url)); }
  private async navigate(id: string, url: string, retainPreview = false): Promise<void> {
    const pane = this.panes.get(id); if (!pane) return;
    if (!retainPreview) pane.previewRequest++;
    const generation = ++pane.generation;
    this.update(id, { error: undefined, title: url === 'about:blank' ? 'Browser' : pane.state.title });
    try { await pane.view.webContents.loadURL(url); }
    catch { if (this.panes.get(id) === pane && pane.generation === generation) this.update(id, { loading: false, error: 'The page could not be loaded. Check the address or reload.' }); }
  }
  async document(id: string, file: PreviewDocument, resolve?: (name: string) => Promise<PreviewDocument | undefined>): Promise<void> {
    previewResponse(file); // Validate before allocating the browser.
    const pane = this.create(id);
    pane.document = { host: randomUUID(), file, resolve, resources: new Map(), pending: new Map(), size: file.bytes.byteLength };
    this.update(id, { title: file.name, url: '', error: undefined });
    await this.navigate(id, `hermes-preview://${pane.document.host}/${encodeURIComponent(file.name)}`, true);
  }
  action(id: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): void {
    const pane = this.panes.get(id); if (!pane) return;
    const contents = pane.view.webContents;
    pane.previewRequest++;
    if (action === 'close') { this.remove(id); this.changed(); return; }
    if (action === 'reload') contents.reload();
    if (action === 'stop') { contents.stop(); this.update(id, { loading: false }); }
    if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  }
  setBounds(bounds: Bounds): void {
    const [width, height] = this.window.getContentSize();
    for (const key of ['x', 'y', 'width', 'height'] as const) if (!Number.isFinite(bounds[key]) || bounds[key] < 0) throw new Error('Invalid browser bounds');
    const x = Math.min(width, Math.round(bounds.x)), y = Math.min(height, Math.round(bounds.y));
    this.bounds = { x, y, width: Math.min(width - x, Math.round(bounds.width)), height: Math.min(height - y, Math.round(bounds.height)), visible: bounds.visible === true };
    this.layout(this.active, this.visible);
  }
  layout(active: string | undefined, visible: boolean): void {
    this.active = active; this.visible = visible;
    const usable = this.bounds.width > 0 && this.bounds.height > 0;
    for (const [id, pane] of this.panes) {
      const show = id === active && visible && this.bounds.visible && usable;
      // A page Hermes works on in the background keeps a real size, so layout and screenshots stay meaningful.
      pane.view.setBounds(show || usable || !pane.control ? this.bounds : { x: 0, y: 0, ...BACKGROUND_SIZE });
      pane.view.setVisible(show); pane.view.webContents.setAudioMuted(!show);
    }
  }
  remove(id: string): void {
    const pane = this.panes.get(id); if (!pane) return;
    this.panes.delete(id); pane.document = undefined; sessions.get(pane.partition)?.panes.delete(pane);
    this.endControl(pane); this.failRequests(pane, 'The browser closed.');
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(pane.view);
    if (!pane.view.webContents.isDestroyed()) {
      byContents.delete(pane.view.webContents.id);
      // Logins persist per Project: closing a page never clears the partition.
      pane.view.webContents.close({ waitForBeforeUnload: false });
    }
  }
  dispose(): void { this.closed = true; for (const id of [...this.panes.keys()]) this.remove(id); if (owner === this) owner = undefined; }

  // -- Agent control ("your browser") ---------------------------------------------------------

  /** Stop / Let Hermes continue / Done, from the sidebar buttons. */
  control(id: string, action: 'stop' | 'resume' | 'done'): void {
    const pane = this.panes.get(id); if (!pane) return;
    if (action === 'stop' && pane.control === 'agent') this.userInput(pane);
    else if (action === 'resume' && pane.control === 'user') { this.setControl(pane, undefined); for (const resume of [...pane.resume]) resume(); }
    else if (action === 'done' && pane.control === 'waiting') pane.handoff?.();
  }
  private setControl(pane: Pane, control: BrowserControlState | undefined, message?: string): void {
    pane.control = control;
    if (control !== 'agent' && pane.idle) { clearTimeout(pane.idle); pane.idle = undefined; }
    if (!pane.view.webContents.isDestroyed()) pane.view.webContents.setBackgroundThrottling(!control);
    this.update(pane.id, { control, controlMessage: control === 'waiting' ? message || CONTROL_TEXT.waitingDefault : control ? CONTROL_TEXT[control] : undefined });
    this.layout(this.active, this.visible);
  }
  private userInput(pane: Pane): void {
    if (pane.control !== 'agent') return;
    pane.action?.abort();
    this.setControl(pane, 'user');
  }
  private endControl(pane: Pane): void {
    pane.action?.abort(); pane.handoff?.();
    for (const resume of [...pane.resume]) resume();
    if (pane.idle) clearTimeout(pane.idle);
  }
  private failRequests(pane: Pane, message: string): void {
    for (const [key, request] of pane.requests) { clearTimeout(request.timer); request.reject(new BrowserControlError('not_ready', message)); pane.requests.delete(key); }
  }
  private request<T>(pane: Pane, op: string, args: Record<string, unknown> = {}, timeout = 8000): Promise<T> {
    const contents = pane.view.webContents;
    if (contents.isDestroyed()) return Promise.reject(new BrowserControlError('not_ready', 'The browser closed.'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { pane.requests.delete(id); reject(new BrowserControlError('not_ready', 'The page did not answer. It may still be loading.')); }, timeout);
      pane.requests.set(id, { resolve: value => resolve(value as T), reject, timer });
      contents.send('hermes-browser:request', { id, op, args });
    });
  }
  private async wait(pane: Pane, signal: AbortSignal, register: (done: () => void) => () => void, timeout: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (value: boolean) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); unregister(); resolve(value); };
      const abort = () => finish(false), timer = setTimeout(() => finish(false), timeout);
      const unregister = register(() => finish(true));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  private async claim(pane: Pane, signal: AbortSignal): Promise<void> {
    if (pane.control === 'waiting') throw new BrowserControlError('user_control', 'The user is finishing something on this page.');
    if (pane.control === 'user') {
      const resumed = await this.wait(pane, signal, done => { pane.resume.add(done); return () => pane.resume.delete(done); }, TAKEOVER_WAIT_MS);
      if (signal.aborted) throw new BrowserControlError('cancelled', 'Stopped.');
      if (!resumed || pane.control) throw new BrowserControlError('user_control', 'The user is using the browser.');
    }
    if (pane.idle) { clearTimeout(pane.idle); pane.idle = undefined; }
    if (pane.control !== 'agent') this.setControl(pane, 'agent');
  }
  private release(pane: Pane): void {
    if (pane.control !== 'agent') return;
    if (pane.idle) clearTimeout(pane.idle);
    pane.idle = setTimeout(() => { pane.idle = undefined; if (pane.control === 'agent' && this.panes.get(pane.id) === pane) this.setControl(pane, undefined); }, AGENT_IDLE_MS);
  }
  private checkpoint(pane: Pane, signal: AbortSignal): void {
    if (signal.aborted) throw new BrowserControlError(pane.control === 'user' ? 'user_control' : 'cancelled', 'Stopped.');
    if (pane.control !== 'agent') throw new BrowserControlError('user_control', 'The user took over the browser.');
  }
  private click(pane: Pane, x: number, y: number): void {
    const contents = pane.view.webContents;
    pane.ledger.note('mouse', x, y);
    contents.sendInputEvent({ type: 'mouseMove', x, y });
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }
  private key(pane: Pane, code: string, char?: string): void {
    const contents = pane.view.webContents;
    pane.ledger.note('key');
    contents.sendInputEvent({ type: 'keyDown', keyCode: code });
    if (char) contents.sendInputEvent({ type: 'char', keyCode: char });
    contents.sendInputEvent({ type: 'keyUp', keyCode: code });
  }
  /** Waits for a navigation that the last input may have started, then for it to finish. */
  private async settle(pane: Pane, signal: AbortSignal, window = 600, maximum = 15_000): Promise<void> {
    const contents = pane.view.webContents, start = Date.now();
    while (Date.now() - start < maximum && !signal.aborted && !contents.isDestroyed()) {
      if (!contents.isLoading() && Date.now() - start >= window) break;
      await sleep(100);
    }
    await sleep(150);
  }
  private page(pane: Pane): { url: string; title: string } {
    const contents = pane.view.webContents;
    return { url: contents.isDestroyed() ? '' : contents.getURL(), title: contents.isDestroyed() ? '' : contents.getTitle() };
  }

  /** Executes one Agent action on the tab's browser with native input only. */
  async command(id: string, action: BrowserAction, args: Readonly<Record<string, unknown>>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    const pane = this.create(id);
    await this.claim(pane, signal);
    const local = new AbortController(), abort = () => local.abort();
    signal.addEventListener('abort', abort, { once: true }); pane.action = local;
    const stop = local.signal;
    try {
      if (action === 'handoff') return await this.handoff(pane, String(args.message ?? ''), stop, timeoutMs);
      const result = await this.perform(pane, action, args, stop);
      this.checkpoint(pane, stop);
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      if (pane.action === local) pane.action = undefined;
      if (signal.aborted && pane.control === 'agent') this.setControl(pane, undefined);
      this.release(pane);
    }
  }
  private async perform(pane: Pane, action: BrowserAction, args: Readonly<Record<string, unknown>>, stop: AbortSignal): Promise<Record<string, unknown>> {
    const contents = pane.view.webContents;
    switch (action) {
      case 'navigate': {
        let url: string;
        try { url = browserUrl(String(args.url ?? '')); } catch { throw new BrowserControlError('invalid', 'Use an HTTP or HTTPS address.'); }
        await this.navigate(pane.id, url); this.checkpoint(pane, stop);
        await this.settle(pane, stop, 0);
        return { ...this.page(pane), loading: contents.isLoading(), ...(pane.state.error ? { error: pane.state.error } : {}) };
      }
      case 'snapshot': return await this.request<Record<string, unknown>>(pane, 'snapshot');
      case 'click': {
        const target = await this.request<{ x: number; y: number; covered: boolean; coveredBy?: string; role: string; label: string }>(pane, 'locate', { ref: args.ref });
        this.checkpoint(pane, stop);
        if (target.covered) throw new BrowserControlError('covered', `Another element (${target.coveredBy ?? 'an overlay'}) covers it. Close that first or click it instead.`);
        await sleep(80); this.click(pane, target.x, target.y);
        const before = contents.getURL();
        await this.settle(pane, stop);
        return { clicked: `${target.role} "${target.label}"`, ...this.page(pane), navigated: contents.getURL() !== before };
      }
      case 'type': {
        const text = String(args.text ?? '');
        const target = await this.request<{ x: number; y: number; covered: boolean; coveredBy?: string; editable: boolean }>(pane, 'locate', { ref: args.ref });
        if (!target.editable) throw new BrowserControlError('not_editable', 'That element is not a text field.');
        if (target.covered) throw new BrowserControlError('covered', `Another element (${target.coveredBy ?? 'an overlay'}) covers the field. Close that first.`);
        this.checkpoint(pane, stop);
        let state = await this.request<{ focused: boolean }>(pane, 'value', { ref: args.ref });
        for (let attempt = 0; !state.focused && attempt < 2; attempt++) {
          this.click(pane, target.x, target.y); await sleep(150); this.checkpoint(pane, stop);
          state = await this.request<{ focused: boolean }>(pane, 'value', { ref: args.ref });
        }
        if (!state.focused) throw new BrowserControlError('not_focused', 'The field did not accept focus. Take a new snapshot.');
        await this.request(pane, 'select', { ref: args.ref }).catch(() => undefined);
        if (text) await contents.insertText(text); else this.key(pane, 'Backspace');
        this.checkpoint(pane, stop);
        const typed = await this.request<{ length: number; preview: string; password: boolean }>(pane, 'value', { ref: args.ref });
        if (args.submit === true) { await sleep(60); this.key(pane, 'Enter', '\r'); await this.settle(pane, stop); }
        return { typed: true, length: typed.length, ...(typed.password ? {} : { value: typed.preview }), submitted: args.submit === true, ...this.page(pane) };
      }
      case 'press': {
        const key = keyFor(String(args.key ?? ''));
        if (!key) throw new BrowserControlError('invalid', 'Use Enter, Escape, Tab, Backspace, Delete, an arrow key, PageUp, PageDown, Home, End or Space.');
        this.key(pane, key.code, key.char); await this.settle(pane, stop, 300);
        return { pressed: key.code, ...this.page(pane) };
      }
      case 'scroll': {
        const before = await this.request<{ scrollY: number; viewportHeight: number; viewportWidth: number }>(pane, 'scroll');
        const down = args.direction !== 'up', x = Math.round(before.viewportWidth / 2), y = Math.round(before.viewportHeight / 2);
        contents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: (down ? -1 : 1) * Math.round(before.viewportHeight * 0.85) });
        await sleep(700); this.checkpoint(pane, stop);
        let after = await this.request<{ scrollY: number; scrollHeight: number; viewportHeight: number }>(pane, 'scroll');
        if (after.scrollY === before.scrollY) { this.key(pane, down ? 'PageDown' : 'PageUp'); await sleep(500); after = await this.request(pane, 'scroll'); }
        return { ...after, moved: after.scrollY !== before.scrollY, atEnd: down ? after.scrollY + after.viewportHeight >= after.scrollHeight - 2 : after.scrollY <= 0 };
      }
      case 'back': {
        if (!contents.navigationHistory.canGoBack()) throw new BrowserControlError('no_history', 'There is no previous page.');
        contents.navigationHistory.goBack(); await this.settle(pane, stop, 0);
        return this.page(pane);
      }
      case 'screenshot': {
        this.layout(this.active, this.visible);
        let image = await contents.capturePage();
        if (image.isEmpty()) throw new BrowserControlError('not_ready', 'The page is not drawn yet. Try again in a moment.');
        const size = image.getSize();
        if (size.width > 1280) image = image.resize({ width: 1280, quality: 'good' });
        const final = image.getSize();
        return { jpeg_base64: image.toJPEG(72).toString('base64'), width: final.width, height: final.height, ...this.page(pane) };
      }
      default: throw new BrowserControlError('invalid', 'Unsupported browser action.');
    }
  }
  private async handoff(pane: Pane, message: string, stop: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    this.setControl(pane, 'waiting', message.slice(0, 300));
    if (!this.window.isDestroyed() && !this.window.isFocused()) { this.window.flashFrame(true); app.dock?.bounce('informational'); }
    try {
      const done = await this.wait(pane, stop, finish => { pane.handoff = finish; return () => { if (pane.handoff === finish) pane.handoff = undefined; }; }, Math.max(1000, timeoutMs - 2000));
      if (stop.aborted) throw new BrowserControlError('cancelled', 'Stopped.');
      if (!done) throw new BrowserControlError('handoff_timeout', 'The user has not finished yet. Ask in chat whether they still need time.');
      return { done: true, ...this.page(pane) };
    } finally {
      if (!this.window.isDestroyed()) this.window.flashFrame(false);
      if (pane.control === 'waiting') this.setControl(pane, undefined);
    }
  }
}
