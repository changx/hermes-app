import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { snapshotDelta } from '../shared/snapshot-delta';
import type { DesktopConnections } from './connections';
import type { DesktopBrowserSidebar } from './browser-sidebar';

type Tab = { id: string; view: WebContentsView; connectionKey?: string; threadId?: string; initialChannelId?: string; kind: 'new' | 'session'; busy: boolean; baseline?: DesktopSnapshot };
export class DesktopTabManager {
  readonly tabs = new Map<string, Tab>();
  activeTabId?: string;
  readonly draftThreads = new Set<string>();
  private revision = 0;
  private baseline?: DesktopSnapshot;
  private bounds = { x: 280, y: 48, width: 800, height: 600, visible: true };
  private closed = false;
  private connectionKey?: string;
  constructor(private readonly window: BrowserWindow, private readonly service: DesktopConnections,
    private readonly directory: string, private readonly secure: (contents: WebContents) => void, private readonly browser?: DesktopBrowserSidebar) { this.shortcuts(window.webContents); }

  attachShortcuts(contents: WebContents): void { this.shortcuts(contents); }
  private shortcuts(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control) || input.alt || input.isAutoRepeat || this.closed) return;
      const key = input.key.toLowerCase();
      if ((key === 't' || key === 'n') && this.service.snapshot().phase === 'connected') {
        event.preventDefault(); const tab = this.sender(contents), snapshot = this.snapshot(contents);
        this.newTab(tab?.initialChannelId ?? snapshot.selectedChannelId); return;
      }
      if (key === 'w' && this.activeTabId) {
        event.preventDefault(); try { this.close(this.activeTabId); } catch { /* Keep a busy tab alive. */ } return;
      }
      if (key === 'tab' && this.tabs.size > 1) {
        event.preventDefault(); const ids = [...this.tabs.keys()], index = ids.indexOf(this.activeTabId ?? '');
        this.activate(ids[(index + (input.shift ? -1 : 1) + ids.length) % ids.length]);
      }
    });
  }

  private create(kind: Tab['kind'], threadId?: string, initialChannelId?: string): Tab {
    const view = new WebContentsView({ webPreferences: { preload: join(this.directory, '../preload/index.cjs'),
      additionalArguments: ['--hermes-tab-view'], nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } });
    const tab: Tab = { id: randomUUID(), view, kind, threadId, initialChannelId, connectionKey: threadId ? this.service.snapshot(threadId, false).connectionKey : this.service.connectionForChannel(initialChannelId), busy: false };
    this.tabs.set(tab.id, tab); this.window.contentView.addChildView(view); view.setVisible(false);
    this.secure(view.webContents);
    this.shortcuts(view.webContents);
    view.webContents.on('did-finish-load', () => { tab.baseline = undefined; this.publish(); });
    view.webContents.on('render-process-gone', () => {
      // Reload only the failed view on explicit user activation. Never rerun a task.
      tab.baseline = undefined;
    });
    void view.webContents.loadFile(join(this.directory, '../renderer/index.html'));
    return tab;
  }
  newTab(channelId?: string): void {
    const snapshot = this.service.snapshot();
    if (snapshot.phase !== 'connected' || channelId && !snapshot.channels.some(c => c.id === channelId)) throw new Error('Choose a project');
    const tab = this.create('new', undefined, channelId ?? snapshot.selectedChannelId);
    this.activeTabId = tab.id; this.service.deactivateThread(tab.connectionKey); this.publish();
  }
  sync(snapshot: DesktopSnapshot): void {
    if (this.closed) return;
    this.connectionKey = snapshot.connectionKey;
    for (const tab of [...this.tabs.values()]) {
      if (!this.service.hasConnection(tab.connectionKey) ||
          tab.kind === 'session' && !snapshot.loadingConversations && !snapshot.threads.some(t => t.id === tab.threadId)) this.destroy(tab);
    }
    if (snapshot.selectedThreadId && snapshot.threads.some(thread => thread.id === snapshot.selectedThreadId)) {
      let tab = [...this.tabs.values()].find(t => t.threadId === snapshot.selectedThreadId);
      if (!tab) tab = this.create('session', snapshot.selectedThreadId);
      if (tab.kind === 'session') this.activeTabId = tab.id;
    }
    this.publish();
  }
  activate(id: string): void {
    const tab = this.tabs.get(id); if (!tab) throw new Error('Tab unavailable');
    this.activeTabId = id;
    if (tab.kind === 'session' && tab.threadId) void this.service.selectThread(tab.threadId);
    else this.service.deactivateThread(tab.connectionKey);
    if (tab.view.webContents.isCrashed()) { tab.baseline = undefined; tab.view.webContents.reload(); }
    this.publish(); tab.view.webContents.focus();
  }
  close(id: string): void {
    const tab = this.tabs.get(id); if (!tab) return;
    if (tab.busy) throw new Error('Wait for the current action');
    const ids = [...this.tabs.keys()], index = ids.indexOf(id), active = id === this.activeTabId;
    this.destroy(tab);
    if (active) this.activeTabId = [...this.tabs.keys()][Math.min(index, this.tabs.size - 1)];
    if (active) this.service.deactivateThread();
    if (tab.threadId) this.service.closeSessionPage(tab.threadId);
    if (this.activeTabId) this.activate(this.activeTabId); else { this.service.deactivateThread(); this.publish(); }
  }
  private destroy(tab: Tab): void {
    this.browser?.remove(tab.id);
    this.tabs.delete(tab.id); if (this.activeTabId === tab.id) this.activeTabId = undefined;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  dispose(): void { this.closed = true; for (const tab of [...this.tabs.values()]) this.destroy(tab); this.browser?.dispose(); this.baseline = undefined; }
  sender(contents: WebContents): Tab | undefined { return [...this.tabs.values()].find(tab => tab.view.webContents === contents); }
  authorize(contents: WebContents, frameUrl: string | undefined): Tab | undefined {
    if (frameUrl !== contents.getURL()) throw new Error('Untrusted desktop request');
    if (contents === this.window.webContents) return undefined;
    const tab = this.sender(contents);
    if (!tab || !this.service.hasConnection(tab.connectionKey)) throw new Error('Untrusted desktop request');
    return tab;
  }
  target(contents: WebContents): string {
    const tab = this.sender(contents), id = tab ? tab.threadId : this.service.snapshot().selectedThreadId;
    if (!id || tab && (!this.tabs.has(tab.id) || !this.service.hasConnection(tab.connectionKey))) throw new Error('Session unavailable');
    return id;
  }
  complete(contents: WebContents): void {
    const tab = this.sender(contents); if (!tab?.threadId) throw new Error('Session unavailable');
    tab.kind = 'session';
    if (tab.id === this.activeTabId) void this.service.selectThread(tab.threadId);
    this.publish();
  }
  setBounds(bounds: typeof this.bounds): void {
    const [width, height] = this.window.getContentSize();
    for (const key of ['x','y','width','height'] as const) if (!Number.isFinite(bounds[key]) || bounds[key] < 0) throw new Error('Invalid content bounds');
    this.bounds = { x: Math.min(width, Math.round(bounds.x)), y: Math.min(height, Math.round(bounds.y)),
      width: Math.min(width - Math.min(width, Math.round(bounds.x)), Math.round(bounds.width)),
      height: Math.min(height - Math.min(height, Math.round(bounds.y)), Math.round(bounds.height)), visible: bounds.visible === true };
    this.publish();
  }
  private layout(): void {
    this.browser?.layout(this.activeTabId, this.bounds.visible);
    for (const tab of this.tabs.values()) {
      const visible = tab.id === this.activeTabId && this.bounds.visible;
      tab.view.setBounds(this.bounds); tab.view.setVisible(visible); tab.view.webContents.setAudioMuted(!visible);
    }
  }
  snapshot(contents?: WebContents): DesktopSnapshot {
    const tab = contents && this.sender(contents);
    const base = this.service.snapshot(tab?.threadId, false, tab?.connectionKey);
    if (tab) {
      const session = tab.kind === 'session';
      return { ...base, revision: this.revision, selectedThreadId: session ? tab.threadId : undefined,
        selectedThreadTitle: session ? base.selectedThreadTitle : undefined, selectedChannelId: session ? base.threads.find(t => t.id === tab.threadId)?.channelId : tab.initialChannelId,
        messages: session ? base.messages : [], interactions: session ? base.interactions : [],
        loadingMessages: session && base.loadingMessages, canLoadOlder: session && base.canLoadOlder,
        tabId: tab.id, tabActive: tab.id === this.activeTabId && this.bounds.visible, tabKind: tab.kind, initialChannelId: tab.initialChannelId };
    }
    return { ...base, draftIdentity: base.connections?.find(c => c.connectionKey)?.connectionKey ?? base.draftIdentity, revision: this.revision, browser: this.browser?.state(this.activeTabId), messages: [], interactions: [], sessionPages: undefined, draftThreadIds: [...this.draftThreads],
      tabs: [...this.tabs.values()].map(tab => ({ id: tab.id, kind: tab.kind, threadId: tab.threadId,
        initialChannelId: tab.initialChannelId, title: tab.kind === 'new' ? 'New chat' : base.threads.find(t => t.id === tab.threadId)?.title ?? 'Conversation' })), activeTabId: this.activeTabId };
  }
  publish(): void {
    if (this.closed || this.window.isDestroyed()) return;
    this.revision++; this.layout();
    const shell = this.snapshot();
    this.window.webContents.send('desktop:snapshot', this.baseline ? snapshotDelta(this.baseline, shell) : shell); this.baseline = shell;
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.isDestroyed()) continue;
      const next = this.snapshot(tab.view.webContents);
      tab.view.webContents.send('desktop:snapshot', tab.baseline ? snapshotDelta(tab.baseline, next) : next); tab.baseline = next;
    }
  }
}
