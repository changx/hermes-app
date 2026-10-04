import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { NavigationPanel } from './navigation-panel';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MIN_SIDEBAR_WIDTH, saveSidebarWidth, sidebarMaximum } from './sidebar-width';

export function NativeWorkspace({ snapshot, draftThreads, onEditLabels, onCreateProject, onProjectOptions, onSettings, overlayOpen, children }: {
  snapshot: DesktopSnapshot; draftThreads: ReadonlySet<string>; onEditLabels: (thread: DesktopThread) => void;
  onCreateProject: () => void; onProjectOptions: (id: string) => void; onSettings: () => void; overlayOpen: boolean; children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false), [error, setError] = useState('');
  const [preferredWidth, setPreferredWidth] = useState(loadSidebarWidth);
  const [availableWidth, setAvailableWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const sidebarWidth = clampSidebarWidth(preferredWidth, availableWidth);
  const latestWidth = useRef(sidebarWidth); latestWidth.current = sidebarWidth;
  const latestAvailable = useRef(availableWidth); latestAvailable.current = availableWidth;
  const persistWidth = (width: number) => {
    if (!saveSidebarWidth(width)) setError('The sidebar width could not be saved. It will reset when you reopen the app.');
  };
  useEffect(() => {
    const element = shell.current; if (!element) return;
    const update = () => setAvailableWidth(element.getBoundingClientRect().width);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const stop = () => { if (drag.current) { drag.current = null; setDragging(false); persistWidth(latestWidth.current); } };
    const move = (event: PointerEvent) => {
      const start = drag.current; if (!start || start.pointerId !== event.pointerId) return;
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
  const content = useRef<HTMLElement>(null), tabs = snapshot.tabs ?? [];
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
  }, [collapsed, sidebarWidth, overlayOpen, snapshot.phase, snapshot.activeTabId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 't' && snapshot.phase === 'connected') { event.preventDefault(); invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
      if (event.key.toLowerCase() === 'w' && snapshot.activeTabId) { event.preventDefault(); invoke(window.hermesDesktop.closeTab(snapshot.activeTabId)); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [snapshot.activeTabId, snapshot.phase, snapshot.selectedChannelId]);
  return <div ref={shell} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties} className={`desktop-shell native-workspace ${collapsed ? 'sidebar-collapsed' : ''} ${dragging ? 'sidebar-resizing' : ''}`}>
    <button type="button" className="sidebar-edge-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(old => !old)}>{collapsed ? '›' : '‹'}</button>
    {!collapsed && <aside className="sidebar native-sidebar">
      <NavigationPanel snapshot={snapshot} draftThreads={draftThreads} onNewSession={id => invoke(window.hermesDesktop.newTab(id || undefined))} onEditLabels={onEditLabels} onChannelOptions={onProjectOptions} />
      <div className="native-sidebar-footer"><button type="button" onClick={onCreateProject} disabled={snapshot.phase !== 'connected'}>＋ New project</button><div><span title={snapshot.connectionName}>{snapshot.connectionName ?? 'Hermes'}</span><button type="button" aria-label="Settings" onClick={onSettings}>⚙</button></div></div>
    </aside>}
    {!collapsed && <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={sidebarMaximum(availableWidth)} aria-valuenow={sidebarWidth}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }; setDragging(true);
      }}
      onLostPointerCapture={() => { if (drag.current) { drag.current = null; setDragging(false); persistWidth(latestWidth.current); } }}
      onDoubleClick={() => { const width = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, availableWidth); setPreferredWidth(width); persistWidth(width); }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? sidebarWidth - 10 : event.key === 'ArrowRight' ? sidebarWidth + 10 : event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? sidebarMaximum(availableWidth) : undefined;
        if (next === undefined) return; event.preventDefault(); const width = clampSidebarWidth(next, availableWidth); setPreferredWidth(width); persistWidth(width);
      }} />}
    <section className="native-workspace-main">
      <div className="desktop-tabs" role="tablist" aria-label="Session tabs">{tabs.map(tab => {
        const thread = tab.kind === 'session' && tab.threadId ? threadsById.get(tab.threadId) : undefined;
        const running = thread?.running === true;
        const draft = tab.kind === 'session' && !!tab.threadId && draftThreads.has(tab.threadId);
        const unread = thread?.completedUnread === true;
        const statuses = [running && 'Running', draft && 'Draft', unread && 'Completed, unread'].filter(Boolean);
        return <div className={`desktop-tab ${tab.id === snapshot.activeTabId ? 'active' : ''}`} key={tab.id}>
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
      })}<button type="button" className="desktop-tab-add" aria-label="New chat tab" disabled={snapshot.phase !== 'connected'} onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>＋</button></div>
      <main ref={content} className="native-view-slot">{snapshot.errorMessage && <div className="error-banner" role="alert">{snapshot.errorMessage}</div>}{!snapshot.activeTabId && (snapshot.loadingConversations && !snapshot.errorMessage ? <div className="empty-session" role="status" aria-live="polite" aria-busy="true"><h1>Loading your conversations…</h1></div> : <div className="empty-session"><h1>Start a conversation</h1><p>Open a recent session or create a new chat.</p>{snapshot.phase === 'connected' && <button type="button" onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>New chat</button>}</div>)}</main>
    </section>
    {error && <div className="native-tab-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss tab error">×</button></div>}
    {children}
  </div>;
}
