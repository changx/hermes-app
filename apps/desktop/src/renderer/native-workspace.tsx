import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { NavigationPanel, type ProjectReveal } from './navigation-panel';
import { BrowserSidebar } from './browser-sidebar';
import { Icon } from './icons';
import { ErrorBanner } from './error-banner';
import { UpdateReadyButton } from './update-ready';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MIN_SIDEBAR_WIDTH, saveSidebarWidth, sidebarMaximum } from './sidebar-width';
import { automaticBrowserWidth, browserMaximum, clampBrowserWidth, loadBrowserWidth, MIN_BROWSER_WIDTH, saveBrowserWidth } from './browser-width';

export function NativeWorkspace({ snapshot, draftThreads, onEditLabels, onRename, onCreateProject, onSearch, onProjectOptions, onSettings, overlayOpen, children }: {
  snapshot: DesktopSnapshot; draftThreads: ReadonlySet<string>; onEditLabels: (thread: DesktopThread) => void; onRename?: (thread: DesktopThread) => void;
  onCreateProject: () => void; onSearch?: () => void; onProjectOptions: (id: string) => void; onSettings: () => void; overlayOpen: boolean; children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false), [error, setError] = useState('');
  // A Session page's Project name: show that Project in the tree.
  const [reveal, setReveal] = useState<ProjectReveal>();
  useEffect(() => window.hermesDesktop.onRevealProject?.(channelId => { setCollapsed(false); setReveal({ channelId }); }), []);
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
  // Sidebar drag: the width goes straight to the CSS variable once per frame, with no React render per pointer move.
  // State (and storage) take the final width when the drag ends.
  const dragWidth = useRef<number | null>(null), dragFrame = useRef(0), handle = useRef<HTMLDivElement>(null);
  const endSidebarDrag = useRef(() => {});
  endSidebarDrag.current = () => {
    if (dragFrame.current) { cancelAnimationFrame(dragFrame.current); dragFrame.current = 0; }
    const width = dragWidth.current ?? latestWidth.current; dragWidth.current = null;
    // Write the final width here too: React skips the style when the final width equals the width before the drag.
    shell.current?.style.setProperty('--sidebar-width', `${width}px`); handle.current?.setAttribute('aria-valuenow', String(width));
    drag.current = null; setDragging(null); setPreferredWidth(width); persistWidth(width);
  };
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
      if (kind === 'sidebar') { endSidebarDrag.current(); return; }
      drag.current = null; setDragging(null); persistBrowserWidth(latestBrowserWidth.current);
    };
    const move = (event: PointerEvent) => {
      const start = drag.current; if (!start || start.pointerId !== event.pointerId) return;
      if (start.kind === 'browser') {
        // The preview edge is on its left: moving left makes it wider.
        const width = clampBrowserWidth(start.startWidth - (event.clientX - start.startX), latestBrowserAvailable.current);
        latestBrowserWidth.current = width; setPreferredBrowserWidth(width); return;
      }
      dragWidth.current = clampSidebarWidth(start.startWidth + event.clientX - start.startX, latestAvailable.current);
      if (dragFrame.current) return;
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = 0; const width = dragWidth.current; if (width === null) return;
        shell.current?.style.setProperty('--sidebar-width', `${width}px`);
        handle.current?.setAttribute('aria-valuenow', String(width));
      });
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
  // The edge button and Cmd+B: a narrow window with an open preview closes the preview to make room for the sidebar.
  const toggleSidebar = () => { if (sidebarHidden && browserOpen && availableWidth < 1100) invoke(window.hermesDesktop.browserAction('close')); setCollapsed(!sidebarHidden); };
  const latestToggleSidebar = useRef(toggleSidebar); latestToggleSidebar.current = toggleSidebar;
  useEffect(() => window.hermesDesktop.onToggleSidebar?.(() => { if (!document.querySelector('dialog[open]')) latestToggleSidebar.current(); }), []);
  // One IPC per real change: the effect re-runs and the ResizeObserver often report the same rectangle.
  const sentBounds = useRef('');
  useEffect(() => {
    const element = content.current; if (!element) return;
    let disposed = false;
    const update = () => {
      const r = element.getBoundingClientRect();
      const bounds = { x: r.left, y: r.top, width: r.width, height: r.height, visible: !overlayOpen && snapshot.phase === 'connected' && !!snapshot.activeTabId };
      const key = JSON.stringify(bounds);
      if (disposed || key === sentBounds.current) return;
      sentBounds.current = key;
      void window.hermesDesktop.setContentBounds(bounds).catch(() => { if (!disposed) { sentBounds.current = ''; setError('The conversation view could not be positioned.'); } });
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
    <button type="button" className="sidebar-edge-toggle sidebar-icon-button" aria-label={sidebarHidden ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarHidden} title={`${sidebarHidden ? 'Expand' : 'Collapse'} sidebar (⌘B)`} onClick={toggleSidebar}><Icon name={sidebarHidden ? 'chevronRight' : 'chevronLeft'} /></button>
    {!sidebarHidden && <aside className="sidebar native-sidebar">
      <NavigationPanel snapshot={snapshot} draftThreads={draftThreads} onNewSession={id => invoke(window.hermesDesktop.newTab(id || undefined))} onEditLabels={onEditLabels} onRename={onRename} onChannelOptions={onProjectOptions} onCreateProject={onCreateProject} onSearch={onSearch} reveal={reveal} />
    </aside>}
    {!sidebarHidden && <div ref={handle} className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={sidebarMaximum(availableWidth - browserWidth)} aria-valuenow={sidebarWidth}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind: 'sidebar', pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }; setDragging('sidebar');
      }}
      onLostPointerCapture={() => { if (drag.current?.kind === 'sidebar') endSidebarDrag.current(); }}
      onDoubleClick={() => { const width = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, availableWidth - browserWidth); setPreferredWidth(width); persistWidth(width); }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? sidebarWidth - 10 : event.key === 'ArrowRight' ? sidebarWidth + 10 : event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? sidebarMaximum(availableWidth - browserWidth) : undefined;
        if (next === undefined) return; event.preventDefault(); const width = clampSidebarWidth(next, availableWidth - browserWidth); setPreferredWidth(width); persistWidth(width);
      }} />}
    <section className="native-workspace-main">
      {/* Tabs scroll under the opaque action panel; the panel never scrolls. */}
      <div className={`desktop-tabbar${snapshot.updateReady !== undefined ? ' update-ready' : ''}`}>
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
        <UpdateReadyButton version={snapshot.updateReady} onRestart={() => invoke(window.hermesDesktop.restartToUpdate())} />
        <button type="button" className="desktop-tab-add desktop-tab-action" aria-label="New chat tab" title="New tab (⌘T)" disabled={snapshot.phase !== 'connected'} onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}><Icon name="plus" /></button>
        {/* Settings stays usable while unpaired or offline, so the button is never disabled. */}
        <button type="button" className="desktop-tab-settings desktop-tab-action" aria-label="Settings" title="Settings (⌘,)" onClick={onSettings}><Icon name="gear" /></button>
        <button type="button" className="desktop-browser-toggle desktop-tab-action" aria-label={snapshot.browserMode === 'window' ? 'Toggle browser window' : 'Toggle preview sidebar'} title={snapshot.browserMode === 'window' ? 'Browser window' : 'Preview sidebar'} aria-expanded={browserActive} disabled={!snapshot.activeTabId} onClick={() => invoke(browserActive ? window.hermesDesktop.browserAction('close') : window.hermesDesktop.openBrowser())}><Icon name="panelRight" /></button>
      </div>
      </div>
      <main ref={content} className="native-view-slot"><ErrorBanner snapshot={snapshot} />{!snapshot.activeTabId && (snapshot.loadingConversations && !snapshot.errorMessage ? <div className="empty-session" role="status" aria-live="polite" aria-busy="true"><h1>Loading your conversations…</h1></div> : <div className="empty-session"><h1>Start a conversation</h1><p>Open a recent session or create a new chat.</p>{snapshot.phase === 'connected' && <button type="button" onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>New chat</button>}</div>)}</main>
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
