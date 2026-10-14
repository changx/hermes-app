import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { NavigationPanel } from './navigation-panel';
import { addQueryLabel, emptySessionQuery } from '../../../../packages/client/src/sessionSearch';
import { BrowserSidebar } from './browser-sidebar';
import { Icon } from './icons';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MIN_SIDEBAR_WIDTH, saveSidebarWidth, sidebarMaximum } from './sidebar-width';
import { automaticBrowserWidth, browserMaximum, clampBrowserWidth, loadBrowserWidth, MIN_BROWSER_WIDTH, saveBrowserWidth } from './browser-width';

export function NativeWorkspace({ snapshot, draftThreads, onEditLabels, onRename, onCreateProject, onProjectOptions, onSettings, overlayOpen, children }: {
  snapshot: DesktopSnapshot; draftThreads: ReadonlySet<string>; onEditLabels: (thread: DesktopThread) => void; onRename?: (thread: DesktopThread) => void;
  onCreateProject: () => void; onProjectOptions: (id: string) => void; onSettings: () => void; overlayOpen: boolean; children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false), [error, setError] = useState('');
  // The sidebar search lives here: it survives collapsing the sidebar, and a Session page's label click adds to it.
  const [search, setSearch] = useState(emptySessionQuery);
  useEffect(() => window.hermesDesktop.onSearchLabel?.(label => { setCollapsed(false); setSearch(old => addQueryLabel(old, label)); }), []);
  const [preferredWidth, setPreferredWidth] = useState(loadSidebarWidth);
  const [availableWidth, setAvailableWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  const [preferredBrowserWidth, setPreferredBrowserWidth] = useState(loadBrowserWidth);
  const [dragging, setDragging] = useState<'sidebar' | 'browser' | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'sidebar' | 'browser'; pointerId: number; startX: number; startWidth: number } | null>(null);
  // In separate-window mode the Session's browser has its own window; the main window keeps its full width.
  const browserActive = !!snapshot.browser?.open, browserOpen = browserActive && snapshot.browserMode !== 'window';
  const sidebarHidden = collapsed || browserOpen && availableWidth < 1100;
  // The preview may grow until the conversation keeps its reserve beside a minimum-width left sidebar.
  const browserAvailable = availableWidth - (sidebarHidden ? 0 : MIN_SIDEBAR_WIDTH);
  const browserWidth = !browserOpen ? 0 : clampBrowserWidth(preferredBrowserWidth ?? automaticBrowserWidth(availableWidth), browserAvailable);
  const sidebarWidth = clampSidebarWidth(preferredWidth, availableWidth - browserWidth);
  const latestWidth = useRef(sidebarWidth); latestWidth.current = sidebarWidth;
  const latestAvailable = useRef(availableWidth); latestAvailable.current = availableWidth - browserWidth;
  const latestBrowserWidth = useRef(browserWidth); latestBrowserWidth.current = browserWidth;
  const latestBrowserAvailable = useRef(browserAvailable); latestBrowserAvailable.current = browserAvailable;
  const persistWidth = (width: number) => {
    if (!saveSidebarWidth(width)) setError('The sidebar width could not be saved. It will reset when you reopen the app.');
  };
  const persistBrowserWidth = (width: number | null) => {
    if (!saveBrowserWidth(width)) setError('The preview width could not be saved. It will reset when you reopen the app.');
  };
  const setBrowserWidth = (width: number) => { const next = clampBrowserWidth(width, browserAvailable); setPreferredBrowserWidth(next); persistBrowserWidth(next); };
  useEffect(() => {
    const element = shell.current; if (!element) return;
    const update = () => setAvailableWidth(element.getBoundingClientRect().width);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const stop = () => {
      const kind = drag.current?.kind; if (!kind) return;
      drag.current = null; setDragging(null);
      if (kind === 'sidebar') persistWidth(latestWidth.current); else persistBrowserWidth(latestBrowserWidth.current);
    };
    const move = (event: PointerEvent) => {
      const start = drag.current; if (!start || start.pointerId !== event.pointerId) return;
      if (start.kind === 'browser') {
        // The preview edge is on its left: moving left makes it wider.
        const width = clampBrowserWidth(start.startWidth - (event.clientX - start.startX), latestBrowserAvailable.current);
        latestBrowserWidth.current = width; setPreferredBrowserWidth(width); return;
      }
      const width = clampSidebarWidth(start.startWidth + event.clientX - start.startX, latestAvailable.current);
      latestWidth.current = width; setPreferredWidth(width);
    };
    const release = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) stop(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true); window.removeEventListener('blur', stop); };
  }, []);
  const content = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null), tabs = snapshot.tabs ?? [];
  // The tab strip has no scrollbar: keep the active tab visible and let a vertical wheel scroll it sideways.
  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>('.desktop-tab.active');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [snapshot.activeTabId, tabs.length]);
  useEffect(() => {
    const element = strip.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault(); element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const threadsById = new Map(snapshot.threads.map(thread => [thread.id, thread]));
  const invoke = (operation: Promise<void>) => { setError(''); void operation.catch(() => setError('The tab action could not be completed. Try again.')); };
  useEffect(() => {
    const element = content.current; if (!element) return;
    let disposed = false;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (!disposed) void window.hermesDesktop.setContentBounds({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        visible: !overlayOpen && snapshot.phase === 'connected' && !!snapshot.activeTabId }).catch(() => { if (!disposed) setError('The conversation view could not be positioned.'); });
    };
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    window.addEventListener('resize', update);
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', update); };
  }, [sidebarHidden, sidebarWidth, browserWidth, overlayOpen, snapshot.phase, snapshot.activeTabId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 't' && snapshot.phase === 'connected') { event.preventDefault(); invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
      if (event.key.toLowerCase() === 'w' && snapshot.activeTabId) { event.preventDefault(); invoke(window.hermesDesktop.closeTab(snapshot.activeTabId)); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [snapshot.activeTabId, snapshot.phase, snapshot.selectedChannelId]);
  return <div ref={shell} style={{ '--sidebar-width': `${sidebarWidth}px`, '--browser-width': `${browserWidth}px` } as CSSProperties} className={`desktop-shell native-workspace ${sidebarHidden ? 'sidebar-collapsed' : ''} ${browserOpen ? 'browser-open' : ''} ${dragging === 'sidebar' ? 'sidebar-resizing' : ''} ${dragging === 'browser' ? 'browser-resizing' : ''}`}>
    <button type="button" className="sidebar-edge-toggle sidebar-icon-button" aria-label={sidebarHidden ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarHidden} onClick={() => { if (sidebarHidden && browserOpen && availableWidth < 1100) invoke(window.hermesDesktop.browserAction('close')); setCollapsed(!sidebarHidden); }}><Icon name={sidebarHidden ? 'chevronRight' : 'chevronLeft'} /></button>
    {!sidebarHidden && <aside className="sidebar native-sidebar">
      <NavigationPanel snapshot={snapshot} draftThreads={draftThreads} onNewSession={id => invoke(window.hermesDesktop.newTab(id || undefined))} onEditLabels={onEditLabels} onRename={onRename} onChannelOptions={onProjectOptions} onCreateProject={onCreateProject} search={search} onSearch={setSearch} />
    </aside>}
    {!sidebarHidden && <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={sidebarMaximum(availableWidth - browserWidth)} aria-valuenow={sidebarWidth}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind: 'sidebar', pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }; setDragging('sidebar');
      }}
      onLostPointerCapture={() => { if (drag.current?.kind === 'sidebar') { drag.current = null; setDragging(null); persistWidth(latestWidth.current); } }}
      onDoubleClick={() => { const width = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, availableWidth - browserWidth); setPreferredWidth(width); persistWidth(width); }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? sidebarWidth - 10 : event.key === 'ArrowRight' ? sidebarWidth + 10 : event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? sidebarMaximum(availableWidth - browserWidth) : undefined;
        if (next === undefined) return; event.preventDefault(); const width = clampSidebarWidth(next, availableWidth - browserWidth); setPreferredWidth(width); persistWidth(width);
      }} />}
    <section className="native-workspace-main">
      {/* Tabs scroll under the opaque action panel; the panel never scrolls. */}
      <div className="desktop-tabbar">
      <div ref={strip} className="desktop-tabs" role="tablist" aria-label="Session tabs">{tabs.map(tab => {
        const thread = tab.kind === 'session' && tab.threadId ? threadsById.get(tab.threadId) : undefined;
        const running = thread?.running === true;
        const draft = tab.kind === 'session' && !!tab.threadId && draftThreads.has(tab.threadId);
        const unread = thread?.completedUnread === true;
        const statuses = [running && 'Running', draft && 'Draft', unread && 'Completed, unread'].filter(Boolean);
        return <div className={`desktop-tab ${tab.id === snapshot.activeTabId ? 'active' : ''}`} key={tab.id}
          onContextMenu={event => { event.preventDefault(); invoke(window.hermesDesktop.showTabMenu(tab.id, event.clientX, event.clientY)); }}
          onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); invoke(window.hermesDesktop.showTabMenu(tab.id, Math.max(0, box.left), Math.max(0, box.bottom))); } }}>
          <button type="button" role="tab" aria-selected={tab.id === snapshot.activeTabId} aria-label={[tab.title, ...statuses].join(', ')} title={[tab.title, ...statuses].join(' — ')} onClick={() => invoke(window.hermesDesktop.activateTab(tab.id))}>
            <span className="desktop-tab-title">{tab.kind === 'new' ? '✎ ' : ''}{tab.title}</span>
            {statuses.length > 0 && <span className="desktop-tab-statuses" aria-hidden="true">
              {running && <span className="desktop-tab-dot desktop-tab-dot-running" />}
              {draft && <span className="desktop-tab-dot desktop-tab-dot-draft" />}
              {unread && <span className="desktop-tab-dot desktop-tab-dot-unread" />}
            </span>}
          </button>
          <button type="button" className="desktop-tab-close" aria-label={`Close tab: ${tab.title}`} onClick={() => invoke(window.hermesDesktop.closeTab(tab.id))}>×</button>
        </div>;
      })}</div>
      <div className="desktop-tab-actions">
        <button type="button" className="desktop-tab-add desktop-tab-action" aria-label="New chat tab" title="New tab (⌘T)" disabled={snapshot.phase !== 'connected'} onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}><Icon name="plus" /></button>
        {/* Settings stays usable while unpaired or offline, so the button is never disabled. */}
        <button type="button" className="desktop-tab-settings desktop-tab-action" aria-label="Settings" title="Settings (⌘,)" onClick={onSettings}><Icon name="gear" /></button>
        <button type="button" className="desktop-browser-toggle desktop-tab-action" aria-label={snapshot.browserMode === 'window' ? 'Toggle browser window' : 'Toggle preview sidebar'} title={snapshot.browserMode === 'window' ? 'Browser window' : 'Preview sidebar'} aria-expanded={browserActive} disabled={!snapshot.activeTabId} onClick={() => invoke(browserActive ? window.hermesDesktop.browserAction('close') : window.hermesDesktop.openBrowser())}><Icon name="panelRight" /></button>
      </div>
      </div>
      <main ref={content} className="native-view-slot">{snapshot.errorMessage && <div className="error-banner" role="alert">{snapshot.errorMessage}</div>}{!snapshot.activeTabId && (snapshot.loadingConversations && !snapshot.errorMessage ? <div className="empty-session" role="status" aria-live="polite" aria-busy="true"><h1>Loading your conversations…</h1></div> : <div className="empty-session"><h1>Start a conversation</h1><p>Open a recent session or create a new chat.</p>{snapshot.phase === 'connected' && <button type="button" onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>New chat</button>}</div>)}</main>
    </section>
    {browserOpen && <div className="browser-resize-handle" role="separator" tabIndex={0} aria-label="Resize preview sidebar" aria-orientation="vertical" aria-valuemin={MIN_BROWSER_WIDTH} aria-valuemax={browserMaximum(browserAvailable)} aria-valuenow={browserWidth}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind: 'browser', pointerId: event.pointerId, startX: event.clientX, startWidth: browserWidth }; setDragging('browser');
      }}
      onLostPointerCapture={() => { if (drag.current?.kind === 'browser') { drag.current = null; setDragging(null); persistBrowserWidth(latestBrowserWidth.current); } }}
      onDoubleClick={() => { setPreferredBrowserWidth(null); persistBrowserWidth(null); }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? browserWidth + 10 : event.key === 'ArrowRight' ? browserWidth - 10 : event.key === 'Home' ? MIN_BROWSER_WIDTH : event.key === 'End' ? browserMaximum(browserAvailable) : undefined;
        if (next === undefined) return; event.preventDefault(); setBrowserWidth(next);
      }} />}
    {browserOpen && snapshot.browser && <BrowserSidebar key={snapshot.activeTabId} state={snapshot.browser} visible={!overlayOpen && snapshot.phase === 'connected'} />}
    {error && <div className="native-tab-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss tab error">×</button></div>}
    {children}
  </div>;
}
