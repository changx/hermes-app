import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DesktopBrowserState } from '../shared/desktop-api';
import { browserUrl, chromeUserAgent, pdfExtension, pdfViewerResource, previewResponse, type PreviewDocument } from '../shared/browser-policy';

type Bounds = { x: number; y: number; width: number; height: number; visible: boolean };
type Pane = { view: WebContentsView; state: DesktopBrowserState; document?: { host: string; file: PreviewDocument; resolve?: (name: string) => Promise<PreviewDocument | undefined>; resources: Map<string, PreviewDocument>; pending: Map<string, Promise<PreviewDocument | undefined>>; size: number }; generation: number; previewRequest: number };
export class DesktopBrowserSidebar {
  readonly panes = new Map<string, Pane>();
  private bounds: Bounds = { x: 0, y: 48, width: 0, height: 0, visible: false };
  private active?: string;
  private visible = false;
  private closed = false;
  constructor(private readonly window: BrowserWindow, private readonly changed: () => void, private readonly shortcuts?: (contents: WebContents) => void) {}
  state(id?: string): DesktopBrowserState | undefined { return id ? this.panes.get(id)?.state : undefined; }
  private update(id: string, patch: Partial<DesktopBrowserState>): void {
    const pane = this.panes.get(id); if (!pane || this.closed) return;
    pane.state = { ...pane.state, ...patch }; this.changed();
  }
  private create(id: string): Pane {
    const existing = this.panes.get(id); if (existing) return existing;
    if (this.closed) throw new Error('Browser is closed');
    const view = new WebContentsView({ webPreferences: { partition: `hermes-browser-${randomUUID()}`, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false } });
    const pane: Pane = { view, state: { open: true, url: '', title: 'Browser', loading: false, canGoBack: false, canGoForward: false }, generation: 0, previewRequest: 0 };
    this.panes.set(id, pane); this.window.contentView.addChildView(view); view.setVisible(false);
    const contents = view.webContents, session = contents.session;
    this.shortcuts?.(contents);
    const ua = chromeUserAgent(process.platform, process.versions.chrome);
    session.setUserAgent(ua); contents.setUserAgent(ua);
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.on('will-download', event => { event.preventDefault(); this.update(id, { error: 'Downloads are not available here. Save attachments from the conversation.' }); });
    const allowed = (value: string) => {
      if (value === 'about:blank') return true;
      try { const url = new URL(value); if (url.protocol === 'hermes-preview:') return url.host === pane.document?.host && !url.username && !url.password; return browserUrl(value) === url.href; } catch { return false; }
    };
    session.webRequest.onBeforeRequest((details, callback) => {
      const inline = details.resourceType !== 'mainFrame' && /^(data:|blob:)/.test(details.url);
      const socket = details.resourceType === 'webSocket' && /^wss?:/.test(details.url) && allowed(details.url.replace(/^ws(s?):/, 'http$1:'));
      // Only Chromium's bundled PDF viewer may use an extension scheme. Top-level navigation still rejects it.
      const pdfViewer = details.url.startsWith(`${pdfExtension}/`) || pdfViewerResource(details);
      callback({ cancel: !inline && !socket && !pdfViewer && !allowed(details.url) });
    });
    session.protocol.handle('hermes-preview', async request => {
      const doc = pane.document;
      try {
        const url = new URL(request.url);
        if (!doc || this.panes.get(id) !== pane || url.host !== doc.host || request.method !== 'GET') return new Response('Preview unavailable', { status: 404 });
        const name = decodeURIComponent(url.pathname.slice(1));
        if (name.includes('/') || name.includes('\\') || name === '..') return new Response('Not found', { status: 404 });
        if (name === doc.file.name) return previewResponse(doc.file);
        let resource = doc.resources.get(name);
        if (!resource && doc.resolve) {
          let pending = doc.pending.get(name);
          if (!pending) {
            if (doc.resources.size + doc.pending.size >= 8) return new Response('Too many resources', { status: 413 });
            pending = doc.resolve(name); doc.pending.set(name, pending);
          }
          let result: PreviewDocument | undefined;
          try { result = await pending; } finally { doc.pending.delete(name); }
          if (pane.document !== doc || this.panes.get(id) !== pane) return new Response('Preview unavailable', { status: 404 });
          if (result && !doc.resources.has(name)) {
            if (doc.size + result.bytes.byteLength > 30 * 1024 * 1024) return new Response('Preview too large', { status: 413 });
            doc.size += result.bytes.byteLength; doc.resources.set(name, result);
          }
          resource = doc.resources.get(name);
        }
        return resource ? previewResponse(resource, true) : new Response('Not found', { status: 404 });
      } catch { return new Response('Preview unavailable', { status: 404 }); }
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-frame-navigate', event => { if (!allowed(event.url) && !(!event.isMainFrame && event.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => { if (allowed(url) && url !== 'about:blank') void this.navigate(id, url); return { action: 'deny' }; });
    const navigation = () => this.update(id, { url: /^https?:/.test(contents.getURL()) ? contents.getURL() : '', canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() });
    contents.on('did-start-loading', () => this.update(id, { loading: true, error: undefined }));
    contents.on('did-stop-loading', () => { this.update(id, { loading: false }); navigation(); });
    contents.on('did-navigate', navigation); contents.on('did-navigate-in-page', navigation);
    contents.on('page-title-updated', (_event, title) => this.update(id, { title: title.slice(0, 200) || 'Browser' }));
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) this.update(id, { loading: false, error: 'The page could not be loaded. Check the address or reload.' }); });
    contents.on('render-process-gone', () => this.update(id, { loading: false, error: 'The browser stopped. Reload to open this page again.' }));
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
    for (const [id, pane] of this.panes) { const show = id === active && visible && this.bounds.visible && this.bounds.width > 0 && this.bounds.height > 0; pane.view.setBounds(this.bounds); pane.view.setVisible(show); pane.view.webContents.setAudioMuted(!show); }
  }
  remove(id: string): void {
    const pane = this.panes.get(id); if (!pane) return;
    this.panes.delete(id); pane.document = undefined;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(pane.view);
    if (!pane.view.webContents.isDestroyed()) {
      const session = pane.view.webContents.session;
      session.protocol.unhandle('hermes-preview'); session.webRequest.onBeforeRequest(null); session.removeAllListeners('will-download');
      pane.view.webContents.close({ waitForBeforeUnload: false });
      void session.clearStorageData().catch(() => {}); void session.clearCache().catch(() => {});
    }
  }
  dispose(): void { this.closed = true; for (const id of [...this.panes.keys()]) this.remove(id); }
}
