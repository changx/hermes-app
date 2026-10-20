import { BrowserWindow, type WebContents } from 'electron';
import { join } from 'node:path';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { snapshotDelta } from '../shared/snapshot-delta';

/**
 * Settings is a separate, single-instance native window. The workspace
 * window and its Session/preview views are never hidden or covered, so the
 * conversation remains visible and usable while Settings is open.
 */
export class DesktopSettingsWindow {
  private window?: BrowserWindow;
  private baseline?: DesktopSnapshot;
  private revision = 0;

  constructor(private readonly directory: string, private readonly source: () => DesktopSnapshot,
    private readonly secure: (contents: WebContents) => void) {}

  get contents(): WebContents | undefined {
    return this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed() ? this.window.webContents : undefined;
  }
  get isOpen(): boolean { return !!this.contents; }
  owns(contents: WebContents): boolean { return !!contents && contents === this.contents; }

  private request?: { page: string; nonce: number };
  private nonce = 0;

  /** `page` (for example `connection:<id>`) asks the Settings page to show that page, also when Settings is already open. */
  open(page?: string): void {
    if (page) { this.request = { page, nonce: ++this.nonce }; this.publish(); }
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show(); this.window.focus(); return;
    }
    const window = new BrowserWindow({
      title: 'Settings', width: 880, height: 620, minWidth: 600, minHeight: 440,
      show: false, backgroundColor: '#ffffff', maximizable: false, fullscreenable: false, autoHideMenuBar: true,
      webPreferences: { preload: join(this.directory, '../preload/index.cjs'), additionalArguments: ['--hermes-settings-view'],
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false },
    });
    this.window = window; this.baseline = undefined;
    this.secure(window.webContents);
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      const key = input.key.toLowerCase();
      // Escape and Cmd/Ctrl+W close only Settings; never a workspace tab.
      if ((key === 'escape' && !input.meta && !input.control && !input.alt) || (key === 'w' && (input.meta || input.control) && !input.alt)) { event.preventDefault(); window.close(); }
    });
    window.webContents.on('did-start-loading', () => { this.baseline = undefined; });
    window.webContents.on('render-process-gone', () => { this.baseline = undefined; });
    window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
    window.on('closed', () => { if (this.window === window) { this.window = undefined; this.baseline = undefined; } });
    void window.loadFile(join(this.directory, '../renderer/index.html'));
  }

  close(): void { if (this.window && !this.window.isDestroyed()) this.window.close(); }

  /** The exact baseline the renderer reconciles; later deltas are computed from it. */
  snapshot(): DesktopSnapshot {
    if (!this.baseline) this.baseline = this.next();
    return this.baseline;
  }

  publish(): void {
    const contents = this.contents;
    if (!contents || !this.baseline) return;
    const next = this.next();
    contents.send('desktop:snapshot', snapshotDelta(this.baseline, next)); this.baseline = next;
  }

  private next(): DesktopSnapshot {
    // Settings needs connection state only. Never send conversation content to this window.
    const base = this.source();
    return { ...base, revision: ++this.revision, channels: [], threads: [], messages: [], interactions: [], sessionPages: undefined, tabs: undefined, browser: undefined,
      ...(this.request ? { settingsRequest: this.request } : {}) };
  }
}
