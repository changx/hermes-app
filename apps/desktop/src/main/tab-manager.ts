import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DesktopSnapshot, DesktopTabKind } from '../shared/desktop-api';
import { snapshotDelta } from '../shared/snapshot-delta';
import type { DesktopConnections } from './connections';
import type { DesktopBrowserSidebar } from './browser-sidebar';

export type TabMenuAction = 'close' | 'close-right' | 'close-others';
type Tab = { id: string; view: WebContentsView; connectionKey?: string; threadId?: string; initialChannelId?: string;
  /** Automation tabs: the qualified job ID and the tab title (the job name). */ automationId?: string; title?: string;
  /** New chat tab whose first message starts an automation's settings conversation. */ automationEditor?: boolean;
  kind: DesktopTabKind; busy: boolean; baseline?: DesktopSnapshot;
  /** The view has had real bounds at least once; hidden views keep them until they become visible. */ sized?: boolean };
export class DesktopTabManager {
  readonly tabs = new Map<string, Tab>();
  activeTabId?: string;
  readonly draftThreads = new Set<string>();
  private revision = 0;
  /** Changes after a job is deleted, so the Automations lists reload. */
  private automationsVersion = 0;
  private baseline?: DesktopSnapshot;
  private bounds = { x: 280, y: 48, width: 800, height: 600, visible: true };
  private closed = false;
  private connectionKey?: string;
  constructor(private readonly window: BrowserWindow, private readonly service: DesktopConnections,
    private readonly directory: string, private readonly secure: (contents: WebContents) => void, private readonly browser?: DesktopBrowserSidebar,
    private readonly openSettings?: () => void, private readonly published?: () => void) { this.shortcuts(window.webContents); }

  /** The conversation's tab, opened in the background (not activated) when missing. */
  ensureSessionTab(threadId: string): Tab {
    const existing = [...this.tabs.values()].find(tab => tab.threadId === threadId);
    if (existing) return existing;
    if (this.closed || !this.service.snapshot().threads.some(thread => thread.id === threadId)) throw new Error('Conversation unavailable');
    const tab = this.create('session', threadId); this.publish(); return tab;
  }

  /** `skip` turns workspace shortcuts off while it returns true (a page in a separate browser window). */
  attachShortcuts(contents: WebContents, skip?: () => boolean): void { this.shortcuts(contents, skip); }
  private shortcuts(contents: WebContents, skip?: () => boolean): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control) || input.alt || input.isAutoRepeat || this.closed || skip?.()) return;
      const key = input.key.toLowerCase();
      if (key === ',' && this.openSettings) { event.preventDefault(); this.openSettings(); return; }
      // Shift+Cmd+L (Mail's Flag) toggles the active Session's todo flag, also while the sidebar has focus.
      if (key === 'l' && input.shift) {
        event.preventDefault(); const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
        if (tab?.kind === 'session' && !tab.view.webContents.isDestroyed()) tab.view.webContents.send('desktop:toggle-todo');
        return;
      }
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

  private create(kind: Tab['kind'], threadId?: string, initialChannelId?: string, automationId?: string): Tab {
    const view = new WebContentsView({ webPreferences: { preload: join(this.directory, '../preload/index.cjs'),
      additionalArguments: ['--hermes-tab-view'], nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } });
    const connectionKey = automationId ? this.service.connectionForAutomation(automationId) : threadId ? this.service.snapshot(threadId, false).connectionKey : this.service.connectionForChannel(initialChannelId);
    const tab: Tab = { id: randomUUID(), view, kind, threadId, initialChannelId, automationId, connectionKey, busy: false };
    this.tabs.set(tab.id, tab); this.window.contentView.addChildView(view); view.setVisible(false);
    this.secure(view.webContents);
    this.shortcuts(view.webContents);
    view.webContents.on('did-finish-load', () => { tab.baseline = undefined; this.publish(); if (tab.id === this.activeTabId) this.focusActive(); });
    view.webContents.on('render-process-gone', () => {
      // Reload only the failed view on explicit user activation. Never rerun a task.
      tab.baseline = undefined;
    });
    void view.webContents.loadFile(join(this.directory, '../renderer/index.html'));
    return tab;
  }
  newTab(channelId?: string, automation = false): void {
    const snapshot = this.service.snapshot();
    if (snapshot.phase !== 'connected' || channelId && !snapshot.channels.some(c => c.id === channelId)) throw new Error('Choose a project');
    const tab = this.create('new', undefined, channelId ?? snapshot.selectedChannelId);
    if (automation) tab.automationEditor = true;
    this.activeTabId = tab.id; this.service.deactivateThread(tab.connectionKey); this.publish(); this.focusActive();
  }
  /** The single Automations list tab: every job of every connection, page by page. */
  openAutomationList(): void {
    if (this.closed || this.service.snapshot().phase !== 'connected') throw new Error('Automations unavailable');
    const tab = [...this.tabs.values()].find(t => t.kind === 'automations') ?? this.create('automations');
    tab.title = 'Automations';
    this.activeTabId = tab.id; this.service.deactivateThread(tab.connectionKey); this.publish(); this.focusActive();
  }
  /** The Automations list tab, for requests that only that tab or the main window may make. */
  isAutomationList(contents: WebContents): boolean { return this.sender(contents)?.kind === 'automations'; }
  /** One tab per job: activates the job's tab, or opens it. No Session is selected while it shows. */
  openAutomation(automationId: string, title: string): void {
    const snapshot = this.service.snapshot();
    if (this.closed || snapshot.phase !== 'connected') throw new Error('Automation unavailable');
    let tab = [...this.tabs.values()].find(t => t.kind === 'automation' && t.automationId === automationId);
    if (!tab) {
      if (!this.service.hasConnection(this.service.connectionForAutomation(automationId))) throw new Error('Automation unavailable');
      tab = this.create('automation', undefined, undefined, automationId); tab.title = title.trim() || 'Automation';
    }
    this.activeTabId = tab.id; this.service.deactivateThread(tab.connectionKey); this.publish(); this.focusActive();
  }
  /** The job of an Automation tab's own page; the renderer never names another job. */
  automationTarget(contents: WebContents): Tab & { automationId: string } {
    const tab = this.sender(contents);
    if (!tab || tab.kind !== 'automation' || !tab.automationId || !this.service.hasConnection(tab.connectionKey)) throw new Error('Automation unavailable');
    return tab as Tab & { automationId: string };
  }
  /** A job was deleted: close its tabs and let the Automations lists reload. */
  automationDeleted(automationId: string): void {
    this.automationsVersion++;
    const ids = [...this.tabs.values()].filter(tab => tab.kind === 'automation' && tab.automationId === automationId).map(tab => tab.id);
    for (const id of ids) { try { this.close(id); } catch { /* A busy tab stays; its page shows the job is gone. */ } }
    this.publish();
  }
  /** The tab shows the job's current name after each page load. */
  setTabTitle(tab: Tab, title: string): void { if (this.tabs.get(tab.id) === tab && tab.title !== title) { tab.title = title; this.publish(); } }
  sync(snapshot: DesktopSnapshot): void {
    if (this.closed) return;
    this.connectionKey = snapshot.connectionKey;
    const previous = this.activeTabId;
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
    // Opening a Session from the sidebar moves keyboard focus into its page.
    if (this.activeTabId && this.activeTabId !== previous) this.focusActive();
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
  /** Context-menu entries for one tab, in display order. Tab order is insertion order. */
  menu(id: string): { action: TabMenuAction; label: string; enabled: boolean }[] {
    const ids = [...this.tabs.keys()], index = ids.indexOf(id);
    if (index < 0) throw new Error('Tab unavailable');
    return [
      { action: 'close', label: 'Close Tab', enabled: true },
      { action: 'close-right', label: 'Close Tabs to the Right', enabled: index < ids.length - 1 },
      { action: 'close-others', label: 'Close Other Tabs', enabled: ids.length > 1 },
    ];
  }
  menuAction(id: string, action: TabMenuAction): void {
    const ids = [...this.tabs.keys()], index = ids.indexOf(id);
    if (index < 0) throw new Error('Tab unavailable');
    if (action === 'close') { this.close(id); return; }
    this.closeMany(action === 'close-right' ? ids.slice(index + 1) : ids.filter(other => other !== id), id);
  }
  /** Close several tabs at once. A busy tab stays open; if the active tab closes, `keepId` becomes active. */
  closeMany(ids: readonly string[], keepId: string): void {
    const requested = ids.map(id => this.tabs.get(id)).filter((tab): tab is Tab => !!tab);
    const targets = requested.filter(tab => !tab.busy);
    const activeClosing = targets.some(tab => tab.id === this.activeTabId);
    for (const tab of targets) this.destroy(tab);
    if (activeClosing) { this.activeTabId = this.tabs.has(keepId) ? keepId : [...this.tabs.keys()][0]; this.service.deactivateThread(); }
    for (const tab of targets) if (tab.threadId) this.service.closeSessionPage(tab.threadId);
    if (activeClosing && this.activeTabId) this.activate(this.activeTabId);
    else { if (!this.activeTabId) this.service.deactivateThread(); this.publish(); }
    if (targets.length < requested.length) throw new Error('Wait for the current action');
  }
  /** The window became active: a visible Session page takes focus and puts the cursor in its composer. */
  windowFocused(): void {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab || tab.kind !== 'session' || !this.bounds.visible || tab.view.webContents.isDestroyed()) return;
    tab.view.webContents.focus(); tab.view.webContents.send('desktop:focus-composer');
  }
  private focusActive(): void {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
  }
  private destroy(tab: Tab): void {
    this.browser?.remove(tab.id);
    this.tabs.delete(tab.id); if (this.activeTabId === tab.id) this.activeTabId = undefined;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  dispose(): void { this.closed = true; for (const tab of [...this.tabs.values()]) this.destroy(tab); this.browser?.dispose(); this.baseline = undefined; }
  /** Window content position of the Session pages; a page's menu coordinates are relative to it. */
  contentOrigin(): { x: number; y: number } { return { x: this.bounds.x, y: this.bounds.y }; }
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
    const next = { x: Math.min(width, Math.round(bounds.x)), y: Math.min(height, Math.round(bounds.y)),
      width: Math.min(width - Math.min(width, Math.round(bounds.x)), Math.round(bounds.width)),
      height: Math.min(height - Math.min(height, Math.round(bounds.y)), Math.round(bounds.height)), visible: bounds.visible === true };
    const old = this.bounds; this.bounds = next;
    // Snapshots carry only `visible` (tabActive). A sidebar drag changes position and size many times per second,
    // so it re-lays out the views but publishes nothing.
    if (old.visible !== next.visible) { this.publish(); return; }
    if (old.x !== next.x || old.y !== next.y || old.width !== next.width || old.height !== next.height) this.layout();
  }
  private layout(): void {
    this.browser?.layout(this.activeTabId, this.bounds.visible);
    for (const tab of this.tabs.values()) {
      const visible = tab.id === this.activeTabId && this.bounds.visible;
      // Only the visible tab follows the bounds. Each resize makes that page lay out its whole timeline again
      // (and on macOS waits for its new frame), so hidden tabs take the current bounds when they become visible.
      if (visible || !tab.sized) { tab.view.setBounds(this.bounds); tab.sized = this.bounds.width > 0 && this.bounds.height > 0; }
      tab.view.setVisible(visible); tab.view.webContents.setAudioMuted(!visible);
    }
  }
  snapshot(contents?: WebContents): DesktopSnapshot {
    const tab = contents && this.sender(contents);
    const base = this.service.snapshot(tab?.threadId, false, tab?.connectionKey);
    if (tab) {
      const session = tab.kind === 'session';
      return { ...base, revision: this.revision, automationsVersion: this.automationsVersion, selectedThreadId: session ? tab.threadId : undefined,
        selectedThreadTitle: session ? base.selectedThreadTitle : undefined, selectedChannelId: session ? base.threads.find(t => t.id === tab.threadId)?.channelId : tab.initialChannelId,
        messages: session ? base.messages : [], interactions: session ? base.interactions : [],
        loadingMessages: session && base.loadingMessages, canLoadOlder: session && base.canLoadOlder, focusMessage: session ? base.focusMessage : undefined,
        tabId: tab.id, tabActive: tab.id === this.activeTabId && this.bounds.visible, tabKind: tab.kind, initialChannelId: tab.initialChannelId,
        ...(tab.automationId ? { automationId: tab.automationId } : {}), ...(tab.automationEditor ? { automationEditor: true } : {}) };
    }
    return { ...base, draftIdentity: base.connections?.find(c => c.connectionKey)?.connectionKey ?? base.draftIdentity, revision: this.revision, automationsVersion: this.automationsVersion, browser: this.browser?.state(this.activeTabId), browserMode: this.browser?.mode, messages: [], interactions: [], focusMessage: undefined, sessionPages: undefined, draftThreadIds: [...this.draftThreads],
      tabs: [...this.tabs.values()].map(tab => ({ id: tab.id, kind: tab.kind, threadId: tab.threadId,
        initialChannelId: tab.initialChannelId, ...(tab.automationId ? { automationId: tab.automationId } : {}), ...(tab.automationEditor ? { automationEditor: true } : {}),
        title: tab.kind === 'new' ? (tab.automationEditor ? 'New automation' : 'New chat') : tab.kind === 'automation' ? tab.title ?? 'Automation'
          : tab.kind === 'automations' ? 'Automations' : base.threads.find(t => t.id === tab.threadId)?.title ?? 'Conversation' })), activeTabId: this.activeTabId };
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
    this.published?.();
  }
}
