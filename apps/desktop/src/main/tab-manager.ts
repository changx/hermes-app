import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DesktopSnapshot, DesktopTabKind } from '../shared/desktop-api';
import { snapshotDelta } from '../shared/snapshot-delta';
import { windowTitle } from './window-title';
import type { DesktopConnections } from './connections';
import type { DesktopBrowserSidebar } from './browser-sidebar';

export type TabMenuAction = 'close' | 'close-right' | 'close-others';
type Tab = { id: string; view: WebContentsView; connectionKey?: string; threadId?: string; initialChannelId?: string;
  /** Automation tabs: the qualified job ID and the tab title (the job name). */ automationId?: string; title?: string;
  /** New chat tab whose first message starts an automation's settings conversation. */ automationEditor?: boolean;
  kind: DesktopTabKind; busy: boolean; baseline?: DesktopSnapshot;
  /** The view has had real bounds at least once; hidden views keep them until they become visible. */ sized?: boolean;
  /** Session tabs: side chat panels of the right column (docs/side-chat.md), in tab order. */ sides?: string[];
  /** Session tabs: the right column's front item, `browser` or a panel ID. */ rightTab?: string;
  /** The browser was in this tab's right column at the last publish. */ browserShown?: boolean;
  /** Side chat panels only: the Session tab whose right column shows it. */ parentId?: string };
/** A side chat page in the right column of one Session tab. It is not in the tab strip. */
type Panel = Tab & { parentId: string; threadId: string };
export class DesktopTabManager {
  readonly tabs = new Map<string, Tab>();
  /** Side chat panels by ID; each belongs to one Session tab (`parentId`). */
  readonly panels = new Map<string, Panel>();
  private sideBounds = { x: 0, y: 0, width: 0, height: 0, visible: false };
  activeTabId?: string;
  /** The downloaded update version while it waits for a restart (title-bar button); else undefined. */
  updateReady?: string;
  readonly draftThreads = new Set<string>();
  private revision = 0;
  /** Changes after a job is deleted, so the Automations lists reload. */
  private automationsVersion = 0;
  private baseline?: DesktopSnapshot;
  private bounds = { x: 280, y: 48, width: 800, height: 600, visible: true };
  private closed = false;
  private connectionKey?: string;
  /** The active connection group (docs/connection-groups.md) and the last active tab of each group. */
  private group: string | null = null;
  private readonly groupTabs = new Map<string | null, string>();
  constructor(private readonly window: BrowserWindow, private readonly service: DesktopConnections,
    private readonly directory: string, private readonly secure: (contents: WebContents) => void, private readonly browser?: DesktopBrowserSidebar,
    private readonly openSettings?: () => void, private readonly published?: () => void) { this.shortcuts(window.webContents); }

  /** A tab belongs to the active group when its connection does. The Automations list is shared by every group. */
  private shown(tab: Tab, keys = this.service.visibleConnectionKeys()): boolean {
    return tab.kind === 'automations' || this.service.activeGroupId() === null || !!tab.connectionKey && keys.has(tab.connectionKey);
  }
  /** Tabs of the active group, in tab order. Other groups' tabs stay open but hidden. */
  shownTabIds(): string[] { const keys = this.service.visibleConnectionKeys(); return [...this.tabs.values()].filter(tab => this.shown(tab, keys)).map(tab => tab.id); }
  /** Lists of a snapshot narrowed to the active group's connections; `own` keeps a tab's own connection. */
  private scoped(base: DesktopSnapshot, own?: string): DesktopSnapshot {
    if (this.service.activeGroupId() === null) return base;
    const keys = this.service.visibleConnectionKeys(); if (own) keys.add(own);
    const channels = base.channels.filter(channel => !!channel.connectionKey && keys.has(channel.connectionKey)), ids = new Set(channels.map(channel => channel.id));
    return { ...base, channels, threads: base.threads.filter(thread => ids.has(thread.channelId)) };
  }

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
      // Cmd+B shows or hides the main window's left sidebar from every page.
      if (key === 'b' && !input.shift) {
        event.preventDefault(); if (!this.window.isDestroyed()) this.window.webContents.send('desktop:toggle-sidebar');
        return;
      }
      // Cmd+K and Shift+Cmd+F open the search in the main window, so it covers the whole window from every page.
      // The search dialog hides the Session view, so the main window's own page takes the keyboard focus.
      if ((key === 'k' && !input.shift) || (key === 'f' && input.shift)) {
        event.preventDefault(); this.openSearch(key === 'f' ? 'files' : 'all');
        return;
      }
      // Find in page: Cmd+F opens the find bar, Cmd+G / Shift+Cmd+G go to the next / previous match,
      // Cmd+E finds the selected text. From the main window they act on the active tab's page.
      // Pages in the browser panel keep these keys for themselves.
      if ((key === 'f' || key === 'g' || (key === 'e' && !input.shift)) && (contents === this.window.webContents || this.sender(contents))) {
        const action = key === 'f' ? 'open' : key === 'e' ? 'selection' : input.shift ? 'previous' : 'next';
        if (this.find(contents, action)) event.preventDefault();
        return;
      }
      if ((key === 't' || key === 'n') && this.service.snapshot().phase === 'connected') {
        event.preventDefault(); const tab = this.sender(contents), snapshot = this.snapshot(contents);
        this.newTab(tab?.initialChannelId ?? snapshot.selectedChannelId); return;
      }
      if (key === 'w' && this.panelOf(contents)) {
        event.preventDefault(); try { this.closeSide(this.panelOf(contents)!.id); } catch { /* Keep a busy panel alive. */ } return;
      }
      if (key === 'w' && this.activeTabId) {
        event.preventDefault(); try { this.close(this.activeTabId); } catch { /* Keep a busy tab alive. */ } return;
      }
      if (key === 'tab' && this.shownTabIds().length > 1) {
        event.preventDefault(); const ids = this.shownTabIds(), index = ids.indexOf(this.activeTabId ?? '');
        this.activate(ids[(index + (input.shift ? -1 : 1) + ids.length) % ids.length]);
      }
    });
  }

  private create(kind: Tab['kind'], threadId?: string, initialChannelId?: string, automationId?: string, parentId?: string): Tab {
    const view = new WebContentsView({ webPreferences: { preload: join(this.directory, '../preload/index.cjs'),
      additionalArguments: ['--hermes-tab-view'], nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } });
    const connectionKey = automationId ? this.service.connectionForAutomation(automationId) : threadId ? this.service.snapshot(threadId, false).connectionKey : this.service.connectionForChannel(initialChannelId);
    const tab: Tab = { id: randomUUID(), view, kind, threadId, initialChannelId, automationId, connectionKey, busy: false, ...(parentId ? { parentId } : {}) };
    if (parentId) this.panels.set(tab.id, tab as Panel); else this.tabs.set(tab.id, tab);
    this.window.contentView.addChildView(view); view.setVisible(false);
    this.secure(view.webContents);
    this.shortcuts(view.webContents);
    view.webContents.on('did-finish-load', () => { tab.baseline = undefined; this.publish(); if (tab.id === this.activeTabId) this.focusActive(); else if (parentId && this.frontPanel()?.id === tab.id) view.webContents.focus(); });
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
    // An archived side chat (or one whose connection left) closes its panel.
    for (const panel of [...this.panels.values()])
      if (!this.service.hasConnection(panel.connectionKey) || !snapshot.loadingConversations && !snapshot.threads.some(t => t.id === panel.threadId)) this.closeSide(panel.id, false);
    const keys = this.service.visibleConnectionKeys(), groupAll = this.service.activeGroupId() === null;
    const visibleThread = (id?: string) => !!id && (groupAll || this.scoped(snapshot).threads.some(thread => thread.id === id));
    // Another group became active (sidebar switcher, Settings or a link): its last tab comes back.
    // A Session that a link just selected in that group wins over the remembered tab.
    let restored: Tab | null | undefined;
    if (this.service.activeGroupId() !== this.group) {
      if (this.activeTabId) this.groupTabs.set(this.group, this.activeTabId);
      this.group = this.service.activeGroupId();
      // The Automations lists show the active group's jobs; they reload.
      this.automationsVersion++;
      if (!visibleThread(snapshot.selectedThreadId)) {
        const saved = this.groupTabs.get(this.group), tab = saved ? this.tabs.get(saved) : undefined;
        restored = tab && this.shown(tab, keys) ? tab : [...this.tabs.values()].find(other => this.shown(other, keys)) ?? null;
        this.activeTabId = restored?.id;
      }
    } else if (this.activeTabId && !this.shown(this.tabs.get(this.activeTabId)!, keys)) {
      // The active tab's connection moved to another group.
      restored = [...this.tabs.values()].find(other => this.shown(other, keys)) ?? null;
      this.activeTabId = restored?.id;
    }
    // A selected side chat (a link, search or the sidebar) opens in its source Session's right column.
    const selectedSide = snapshot.threads.find(thread => thread.id === snapshot.selectedThreadId)?.sideOf;
    if (selectedSide && snapshot.threads.some(thread => thread.id === selectedSide.threadId) && visibleThread(selectedSide.threadId)) {
      const side = snapshot.selectedThreadId!;
      const parent = [...this.tabs.values()].find(t => t.kind === 'session' && t.threadId === selectedSide.threadId) ?? this.create('session', selectedSide.threadId);
      this.activeTabId = parent.id; restored = undefined;
      this.openSide(parent, side, false);
      void this.service.selectThread(selectedSide.threadId);
    } else
    // A selected Session of a hidden group never opens a tab here; a link first shows its group.
    if (snapshot.selectedThreadId && snapshot.threads.some(thread => thread.id === snapshot.selectedThreadId) && visibleThread(snapshot.selectedThreadId)) {
      let tab = [...this.tabs.values()].find(t => t.threadId === snapshot.selectedThreadId);
      if (!tab) tab = this.create('session', snapshot.selectedThreadId);
      if (tab.kind === 'session') { this.activeTabId = tab.id; restored = undefined; }
    }
    if (restored !== undefined) {
      // Select the restored tab's Session (or none) on its own connection, like a tab click.
      if (restored?.kind === 'session' && restored.threadId) void this.service.selectThread(restored.threadId);
      else this.service.deactivateThread(restored?.connectionKey && this.service.hasConnection(restored.connectionKey) ? restored.connectionKey : undefined);
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
    const ids = this.shownTabIds(), index = ids.indexOf(id), active = id === this.activeTabId;
    this.destroy(tab);
    const rest = this.shownTabIds();
    if (active) this.activeTabId = rest[Math.min(Math.max(index, 0), rest.length - 1)];
    if (active) this.service.deactivateThread();
    if (tab.threadId) this.releasePage(tab.threadId);
    if (this.activeTabId) this.activate(this.activeTabId); else { this.service.deactivateThread(); this.publish(); }
  }
  /** Context-menu entries for one tab, in display order. Tab order is insertion order. */
  menu(id: string): { action: TabMenuAction; label: string; enabled: boolean }[] {
    // The tab strip shows only the active group's tabs; the menu acts on those.
    const ids = this.shownTabIds(), index = ids.indexOf(id);
    if (index < 0) throw new Error('Tab unavailable');
    return [
      { action: 'close', label: 'Close Tab', enabled: true },
      { action: 'close-right', label: 'Close Tabs to the Right', enabled: index < ids.length - 1 },
      { action: 'close-others', label: 'Close Other Tabs', enabled: ids.length > 1 },
    ];
  }
  menuAction(id: string, action: TabMenuAction): void {
    const ids = this.shownTabIds(), index = ids.indexOf(id);
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
    if (activeClosing) { this.activeTabId = this.tabs.has(keepId) ? keepId : this.shownTabIds()[0]; this.service.deactivateThread(); }
    for (const tab of targets) if (tab.threadId) this.releasePage(tab.threadId);
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
    for (const id of tab.sides ?? []) { const panel = this.panels.get(id); if (panel) { this.destroyView(panel); this.panels.delete(id); this.releasePage(panel.threadId); } }
    tab.sides = []; tab.rightTab = undefined;
    this.browser?.remove(tab.id);
    this.tabs.delete(tab.id); if (this.activeTabId === tab.id) this.activeTabId = undefined;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  private destroyView(tab: Tab): void {
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  /** Close a Session page only when no tab or panel shows it any more. */
  private releasePage(threadId: string): void {
    if ([...this.tabs.values(), ...this.panels.values()].some(tab => tab.threadId === threadId)) return;
    this.service.closeSessionPage(threadId);
  }
  dispose(): void { this.closed = true; for (const tab of [...this.tabs.values()]) this.destroy(tab); this.browser?.dispose(); this.baseline = undefined; }

  // -- Side chat panels (docs/side-chat.md) ------------------------------------------------------

  /** The panel of `contents`, if it is a side chat panel. */
  panelOf(contents: WebContents): Panel | undefined { return [...this.panels.values()].find(panel => panel.view.webContents === contents); }
  /** The Session tab whose browser a page uses: a panel uses its parent tab's browser. */
  browserOwner(contents: WebContents): Tab | undefined { const own = this.sender(contents); return own?.parentId ? this.tabs.get(own.parentId) : own; }
  /** The browser shows in the right column (not in a separate window) for this tab. */
  private browserInColumn(tab: Tab): boolean { return !!this.browser && this.browser.mode !== 'window' && this.browser.state(tab.id)?.open === true; }
  /** The right column's front item of a tab after the browser opened or closed. */
  private frontOf(tab: Tab): string | undefined {
    const sides = tab.sides ?? [], browser = this.browserInColumn(tab);
    if (tab.rightTab === 'browser' && browser) return 'browser';
    if (tab.rightTab && sides.includes(tab.rightTab)) return tab.rightTab;
    return browser ? 'browser' : sides[sides.length - 1];
  }
  /** The visible side chat panel of the active tab, if its right column shows one. */
  private frontPanel(): Panel | undefined {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined, front = tab && this.frontOf(tab);
    return front && front !== 'browser' ? this.panels.get(front) : undefined;
  }
  /** Opens (or brings to the front) side chat `threadId` in the right column of Session tab `parent`. */
  openSide(parent: Tab, threadId: string, publish = true): void {
    if (this.closed || parent.kind !== 'session' || parent.parentId) throw new Error('Side chat unavailable');
    const sides = parent.sides ??= [];
    let panel = sides.map(id => this.panels.get(id)).find(item => item?.threadId === threadId);
    if (!panel) {
      panel = this.create('session', threadId, undefined, undefined, parent.id) as Panel;
      sides.push(panel.id);
      void this.service.selectThread(threadId, false);
    }
    parent.rightTab = panel.id;
    if (!publish) return;
    this.publish();
    if (parent.id === this.activeTabId && !panel.view.webContents.isLoading()) panel.view.webContents.focus();
  }
  /** Opens a side chat in its source Session's tab (opening that tab when needed). `from`: the page that asked. */
  openSideChat(threadId: string, from?: WebContents): void {
    const snapshot = this.service.snapshot(), side = snapshot.threads.find(thread => thread.id === threadId)?.sideOf;
    if (this.closed || snapshot.phase !== 'connected' || !side || !snapshot.threads.some(thread => thread.id === side.threadId)) throw new Error('Side chat unavailable');
    const own = from && this.sender(from), asked = own?.parentId ? this.tabs.get(own.parentId) : own;
    const parent = asked?.kind === 'session' && asked.threadId === side.threadId ? asked
      : [...this.tabs.values()].find(tab => tab.kind === 'session' && tab.threadId === side.threadId) ?? this.create('session', side.threadId);
    const switching = this.activeTabId !== parent.id;
    this.activeTabId = parent.id;
    this.openSide(parent, threadId);
    if (switching) void this.service.selectThread(side.threadId);
  }
  /** Close one side chat panel; the side chat itself stays. A neighbour (or the browser) comes to the front. */
  closeSide(panelId: string, publish = true): void {
    const panel = this.panels.get(panelId); if (!panel) return;
    if (panel.busy) throw new Error('Wait for the current action');
    const parent = this.tabs.get(panel.parentId), sides = parent?.sides ?? [], index = sides.indexOf(panelId);
    if (parent) {
      sides.splice(index, 1);
      if (parent.rightTab === panelId) parent.rightTab = this.browserInColumn(parent) ? 'browser' : sides[Math.min(Math.max(index, 0), sides.length - 1)];
    }
    this.panels.delete(panelId); this.destroyView(panel); this.releasePage(panel.threadId);
    if (!publish) return;
    this.publish();
    if (parent && parent.id === this.activeTabId) (this.frontPanel() ?? parent).view.webContents.focus();
  }
  /** Bring `browser` or a side chat panel of the active tab to the front of its right column. */
  selectRightTab(key: string): void {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab || (key === 'browser' ? !this.browserInColumn(tab) : !(tab.sides ?? []).includes(key))) throw new Error('Panel unavailable');
    tab.rightTab = key; this.publish();
    if (key !== 'browser') this.panels.get(key)?.view.webContents.focus();
  }
  /** Scroll the source Session of a panel to its anchor message and mark it. */
  async focusSideAnchor(panelId: string): Promise<void> {
    const panel = this.panels.get(panelId), parent = panel && this.tabs.get(panel.parentId);
    const side = panel && this.service.snapshot().threads.find(thread => thread.id === panel.threadId)?.sideOf;
    if (!panel || !parent?.threadId || !side || side.threadId !== parent.threadId) throw new Error('Side chat unavailable');
    if (this.activeTabId !== parent.id) this.activate(parent.id);
    await this.service.openMessage(parent.threadId, side.anchorRefSeq);
    if (!parent.view.webContents.isDestroyed()) parent.view.webContents.focus();
  }
  /** "Send to main": the reply, with a link back, goes into the source Session's composer; nothing is sent. */
  sendToMain(contents: WebContents, refSeq: number): void {
    const panel = this.panelOf(contents), parent = panel && this.tabs.get(panel.parentId);
    if (!panel || !parent || parent.view.webContents.isDestroyed()) throw new Error('Side chat unavailable');
    const text = this.service.sideReplyText(panel.threadId, refSeq);
    if (!text) throw new Error('Reply unavailable');
    if (this.activeTabId !== parent.id) this.activate(parent.id);
    parent.view.webContents.focus(); parent.view.webContents.send('desktop:fill-composer', text);
  }
  setSideBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): void {
    const [width, height] = this.window.getContentSize();
    for (const key of ['x','y','width','height'] as const) if (!Number.isFinite(bounds[key]) || bounds[key] < 0) throw new Error('Invalid panel bounds');
    const x = Math.min(width, Math.round(bounds.x)), y = Math.min(height, Math.round(bounds.y));
    this.sideBounds = { x, y, width: Math.min(width - x, Math.round(bounds.width)), height: Math.min(height - y, Math.round(bounds.height)), visible: bounds.visible === true };
    this.layout();
  }
  /** Window content position of the Session pages; a page's menu coordinates are relative to it. */
  contentOrigin(): { x: number; y: number } { return { x: this.bounds.x, y: this.bounds.y }; }
  /** Opens the search of the main window, over the whole window. `text` fills the keyword. */
  openSearch(scope: 'all' | 'files', text?: string): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.focus(); this.window.webContents.send('desktop:open-search', scope, text);
  }
  /** The page that shows the find bar for `contents`: its own tab page, or the active tab for the main window. */
  findTarget(contents: WebContents): Tab | undefined {
    const own = this.sender(contents);
    const tab = own ?? (contents === this.window.webContents && this.activeTabId ? this.tabs.get(this.activeTabId) : undefined);
    return tab && tab.id === this.activeTabId && this.bounds.visible && !tab.view.webContents.isDestroyed() ? tab : undefined;
  }
  /** Sends a find request to the page of `contents` and gives that page the keyboard focus. False when no page can find. */
  find(contents: WebContents, action: 'open' | 'next' | 'previous' | 'selection', text?: string): boolean {
    const tab = this.findTarget(contents); if (!tab) return false;
    tab.view.webContents.focus(); tab.view.webContents.send('desktop:find', action, text);
    return true;
  }
  /** The tab or side chat panel of `contents`. */
  sender(contents: WebContents): Tab | undefined { return [...this.tabs.values()].find(tab => tab.view.webContents === contents) ?? this.panelOf(contents); }
  authorize(contents: WebContents, frameUrl: string | undefined): Tab | undefined {
    if (frameUrl !== contents.getURL()) throw new Error('Untrusted desktop request');
    if (contents === this.window.webContents) return undefined;
    const tab = this.sender(contents);
    if (!tab || !this.service.hasConnection(tab.connectionKey)) throw new Error('Untrusted desktop request');
    return tab;
  }
  target(contents: WebContents): string {
    const tab = this.sender(contents), id = tab ? tab.threadId : this.service.snapshot().selectedThreadId;
    if (!id || tab && (!this.tabs.has(tab.id) && !this.panels.has(tab.id) || !this.service.hasConnection(tab.connectionKey))) throw new Error('Session unavailable');
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
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined, front = active && this.frontOf(active);
    // A side chat panel in front hides the browser page; the browser keeps its page.
    this.browser?.layout(this.activeTabId, this.bounds.visible && (front === undefined || front === 'browser'));
    const side = this.sideBounds, usable = side.visible && side.width > 0 && side.height > 0;
    for (const panel of this.panels.values()) {
      const visible = this.bounds.visible && usable && panel.id === front && panel.parentId === this.activeTabId;
      if (visible || !panel.sized && usable) { panel.view.setBounds(side); panel.sized = true; }
      panel.view.setVisible(visible); panel.view.webContents.setAudioMuted(!visible);
    }
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
    if (tab?.parentId) {
      // A side chat panel: its own Session, shown while it is the front item of the active tab's right column.
      const base = this.scoped(this.service.snapshot(tab.threadId, false, tab.connectionKey), tab.connectionKey);
      const visible = this.bounds.visible && this.sideBounds.visible && tab.parentId === this.activeTabId && this.frontPanel()?.id === tab.id;
      return { ...base, revision: this.revision, automationsVersion: this.automationsVersion, selectedThreadId: tab.threadId,
        selectedChannelId: base.threads.find(t => t.id === tab.threadId)?.channelId, tabId: tab.id, tabActive: visible, tabKind: 'session', sidePanel: true };
    }
    const full = this.service.snapshot(tab?.threadId, false, tab?.connectionKey);
    // Pages list only the active group's Projects and Sessions (docs/connection-groups.md); a tab keeps its own connection.
    const base = this.scoped(full, tab?.connectionKey);
    if (tab) {
      const session = tab.kind === 'session';
      return { ...base, revision: this.revision, automationsVersion: this.automationsVersion, selectedThreadId: session ? tab.threadId : undefined,
        selectedThreadTitle: session ? base.selectedThreadTitle : undefined, selectedChannelId: session ? base.threads.find(t => t.id === tab.threadId)?.channelId : tab.initialChannelId,
        messages: session ? base.messages : [], interactions: session ? base.interactions : [], vaultPrompts: session ? base.vaultPrompts : [],
        loadingMessages: session && base.loadingMessages, canLoadOlder: session && base.canLoadOlder, focusMessage: session ? base.focusMessage : undefined,
        tabId: tab.id, tabActive: tab.id === this.activeTabId && this.bounds.visible, tabKind: tab.kind, initialChannelId: tab.initialChannelId,
        ...(tab.automationId ? { automationId: tab.automationId } : {}), ...(tab.automationEditor ? { automationEditor: true } : {}),
 };
    }
    const group = this.service.activeGroupId(), keys = this.service.visibleConnectionKeys();
    return { ...base, draftIdentity: base.connections?.find(c => c.connectionKey)?.connectionKey ?? base.draftIdentity,
      connections: group === null ? base.connections : base.connections?.filter(row => row.groupId === group), revision: this.revision, automationsVersion: this.automationsVersion, browser: this.browser?.state(this.activeTabId), browserMode: this.browser?.mode, updateReady: this.updateReady, messages: [], interactions: [], vaultPrompts: [], focusMessage: undefined, sessionPages: undefined, draftThreadIds: [...this.draftThreads],
      ...this.rightColumn(base),
      tabs: [...this.tabs.values()].filter(tab => this.shown(tab, keys)).map(tab => ({ id: tab.id, kind: tab.kind, threadId: tab.threadId,
        initialChannelId: tab.initialChannelId, ...(tab.automationId ? { automationId: tab.automationId } : {}), ...(tab.automationEditor ? { automationEditor: true } : {}),
        title: tab.kind === 'new' ? (tab.automationEditor ? 'New automation' : 'New chat') : tab.kind === 'automation' ? tab.title ?? 'Automation'
          : tab.kind === 'automations' ? 'Automations' : base.threads.find(t => t.id === tab.threadId)?.title ?? 'Conversation' })), activeTabId: this.activeTabId };
  }
  /** Main window: the active tab's side chat panels and the right column's front item. */
  private rightColumn(base: DesktopSnapshot): Pick<DesktopSnapshot, 'sidePanels' | 'rightTab'> {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab?.sides?.length) return {};
    const sidePanels = tab.sides.flatMap(id => { const panel = this.panels.get(id); return panel ? [{ id, threadId: panel.threadId, title: base.threads.find(t => t.id === panel.threadId)?.title ?? 'Side chat' }] : []; });
    return { sidePanels, rightTab: this.frontOf(tab) };
  }
  publish(): void {
    if (this.closed || this.window.isDestroyed()) return;
    // The browser opened: it comes to the front of its tab's right column. It closed: a side chat does.
    for (const tab of this.tabs.values()) {
      const browser = this.browserInColumn(tab);
      if (browser && !tab.browserShown) tab.rightTab = 'browser';
      tab.browserShown = browser;
      if (tab.rightTab) tab.rightTab = this.frontOf(tab);
    }
    this.revision++; this.layout();
    const shell = this.snapshot();
    // The window title bar shows the active tab's title (the Session title); "Hermes" with no tab.
    const title = windowTitle(shell.tabs?.find(tab => tab.id === shell.activeTabId)?.title);
    if (this.window.getTitle() !== title) this.window.setTitle(title);
    this.window.webContents.send('desktop:snapshot', this.baseline ? snapshotDelta(this.baseline, shell) : shell); this.baseline = shell;
    for (const tab of [...this.tabs.values(), ...this.panels.values()]) {
      if (tab.view.webContents.isDestroyed()) continue;
      const next = this.snapshot(tab.view.webContents);
      tab.view.webContents.send('desktop:snapshot', tab.baseline ? snapshotDelta(tab.baseline, next) : next); tab.baseline = next;
    }
    this.published?.();
  }
}
