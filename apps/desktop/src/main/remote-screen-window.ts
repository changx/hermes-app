import { BrowserWindow, type WebContents } from 'electron';
import { join } from 'node:path';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { snapshotDelta } from '../shared/snapshot-delta';

/** What the Remote browser windows need from the connections. */
export interface RemoteScreenSource {
  snapshot(thread?: string, pages?: boolean, connectionKey?: string): DesktopSnapshot;
  hasConnection(connectionKey?: string): boolean;
  remoteScreenName(connectionKey: string): string | undefined;
}

interface Entry { key: string; window: BrowserWindow; baseline?: DesktopSnapshot }

/**
 * Remote browser (docs/remote-screen.md): one separate native window per connection
 * whose server has a remote screen. The window can be moved, resized, maximized and
 * made full screen apart from the workspace window. Its page connects only the screen
 * of its own connection and receives no conversation content.
 */
export class RemoteScreenWindows {
  private readonly entries = new Map<string, Entry>();
  private revision = 0;

  constructor(private readonly directory: string, private readonly service: RemoteScreenSource,
    private readonly secure: (contents: WebContents) => void) {}

  private entry(contents?: WebContents): Entry | undefined {
    if (!contents) return undefined;
    for (const entry of this.entries.values()) if (!entry.window.isDestroyed() && entry.window.webContents === contents) return entry;
    return undefined;
  }

  owns(contents?: WebContents): boolean { return !!this.entry(contents); }

  /** Opens the connection's Remote browser window, or brings the open one to the front. */
  open(connectionKey: string): void {
    if (!this.service.hasConnection(connectionKey)) throw new Error('Remote browser unavailable');
    const name = this.service.remoteScreenName(connectionKey); if (!name) throw new Error('Remote browser unavailable');
    const open = this.entries.get(connectionKey);
    if (open && !open.window.isDestroyed()) {
      if (open.window.isMinimized()) open.window.restore();
      open.window.show(); open.window.focus(); return;
    }
    const window = new BrowserWindow({
      title: this.title(connectionKey, name), width: 1440, height: 900, minWidth: 640, minHeight: 400,
      show: false, backgroundColor: '#1f1f1f', autoHideMenuBar: true, fullscreenable: true,
      webPreferences: { preload: join(this.directory, '../preload/index.cjs'), additionalArguments: ['--hermes-remote-screen-view'],
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false },
    });
    const entry: Entry = { key: connectionKey, window };
    this.entries.set(connectionKey, entry);
    this.secure(window.webContents);
    window.webContents.on('before-input-event', (event, input) => {
      // Cmd/Ctrl+W closes this window, as it closed the tab before; other keys reach the remote screen.
      if (input.type === 'keyDown' && !input.isAutoRepeat && input.key.toLowerCase() === 'w' && (input.meta || input.control) && !input.alt && !input.shift) {
        event.preventDefault(); window.close();
      }
    });
    // The window keeps its own title (the screen's name); the page's <title> is the app name.
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.on('did-start-loading', () => { entry.baseline = undefined; });
    window.webContents.on('render-process-gone', () => { entry.baseline = undefined; });
    // Hidden or minimized: the page disconnects after a while to save bandwidth (tabActive false).
    for (const name of ['show', 'hide', 'minimize', 'restore'] as const) window.on(name as 'show', () => this.publishEntry(entry));
    window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
    window.on('closed', () => { if (this.entries.get(connectionKey) === entry) this.entries.delete(connectionKey); });
    void window.loadFile(join(this.directory, '../renderer/index.html'));
  }

  /** The connection of a Remote browser window's own page; the page never names another one. */
  target(contents: WebContents): string {
    const entry = this.entry(contents);
    if (!entry || !this.service.hasConnection(entry.key)) throw new Error('Remote browser unavailable');
    return entry.key;
  }

  /** The exact baseline the page reconciles; later deltas are computed from it. */
  snapshot(contents: WebContents): DesktopSnapshot {
    const entry = this.entry(contents); if (!entry) throw new Error('Remote browser unavailable');
    entry.baseline ??= this.next(entry);
    return entry.baseline;
  }

  /** Sends each window its change; closes windows whose connection or screen is gone. */
  publish(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.window.isDestroyed()) { this.entries.delete(entry.key); continue; }
      const name = this.service.hasConnection(entry.key) ? this.service.remoteScreenName(entry.key) : undefined;
      if (!name) { entry.window.close(); continue; }
      const title = this.title(entry.key, name);
      if (entry.window.getTitle() !== title) entry.window.setTitle(title);
      this.publishEntry(entry);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) if (!entry.window.isDestroyed()) entry.window.destroy();
    this.entries.clear();
  }

  private publishEntry(entry: Entry): void {
    if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed() || !entry.baseline) return;
    const next = this.next(entry);
    entry.window.webContents.send('desktop:snapshot', snapshotDelta(entry.baseline, next)); entry.baseline = next;
  }

  /** "AdsPower", or "AdsPower · <connection>" when several connections are saved (as in the sidebar). */
  private title(key: string, name: string): string {
    const rows = this.service.snapshot(undefined, false, key).connections ?? [];
    const row = rows.find(c => c.connectionKey === key);
    return rows.length > 1 && row?.name ? `${name} · ${row.name}` : name;
  }

  private next(entry: Entry): DesktopSnapshot {
    // Connection state only. Never send conversation content to this window.
    const base = this.service.snapshot(undefined, false, entry.key);
    const window = entry.window, visible = !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    const row = base.connections?.find(c => c.connectionKey === entry.key);
    return { ...base, revision: ++this.revision, channels: [], threads: [], messages: [], interactions: [], vaultPrompts: [],
      sessionPages: undefined, tabs: undefined, browser: undefined, focusMessage: undefined, draftIdentity: undefined, draftThreadIds: undefined,
      tabId: `remote-screen:${entry.key}`, tabKind: 'remote-screen', tabActive: visible,
      remoteScreen: { name: this.service.remoteScreenName(entry.key) ?? 'Remote browser', online: row?.state === 'online' } };
  }
}
