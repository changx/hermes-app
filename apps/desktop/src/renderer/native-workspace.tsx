import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { NavigationPanel } from './navigation-panel';

export function NativeWorkspace({ snapshot, draftThreads, onEditLabels, onCreateProject, onProjectOptions, onSettings, overlayOpen, children }: {
  snapshot: DesktopSnapshot; draftThreads: ReadonlySet<string>; onEditLabels: (thread: DesktopThread) => void;
  onCreateProject: () => void; onProjectOptions: (id: string) => void; onSettings: () => void; overlayOpen: boolean; children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false), [error, setError] = useState('');
  const content = useRef<HTMLElement>(null), tabs = snapshot.tabs ?? [];
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
  }, [collapsed, overlayOpen, snapshot.phase, snapshot.activeTabId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 't' && snapshot.phase === 'connected') { event.preventDefault(); invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
      if (event.key.toLowerCase() === 'w' && snapshot.activeTabId) { event.preventDefault(); invoke(window.hermesDesktop.closeTab(snapshot.activeTabId)); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [snapshot.activeTabId, snapshot.phase, snapshot.selectedChannelId]);
  return <div className={`desktop-shell native-workspace ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <button type="button" className="sidebar-edge-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(old => !old)}>{collapsed ? '›' : '‹'}</button>
    {!collapsed && <aside className="sidebar native-sidebar">
      <NavigationPanel snapshot={snapshot} draftThreads={draftThreads} onNewSession={id => invoke(window.hermesDesktop.newTab(id || undefined))} onEditLabels={onEditLabels} onChannelOptions={onProjectOptions} />
      <div className="native-sidebar-footer"><button type="button" onClick={onCreateProject} disabled={snapshot.phase !== 'connected'}>＋ New project</button><div><span title={snapshot.connectionName}>{snapshot.connectionName ?? 'Hermes'}</span><button type="button" aria-label="Settings" onClick={onSettings}>⚙</button></div></div>
    </aside>}
    <section className="native-workspace-main">
      <div className="desktop-tabs" role="tablist" aria-label="Session tabs">{tabs.map(tab => <div className={`desktop-tab ${tab.id === snapshot.activeTabId ? 'active' : ''}`} key={tab.id}>
        <button type="button" role="tab" aria-selected={tab.id === snapshot.activeTabId} title={tab.title} onClick={() => invoke(window.hermesDesktop.activateTab(tab.id))}>{tab.kind === 'new' ? '✎ ' : ''}{tab.title}</button>
        <button type="button" className="desktop-tab-close" aria-label={`Close tab: ${tab.title}`} onClick={() => invoke(window.hermesDesktop.closeTab(tab.id))}>×</button>
      </div>)}<button type="button" className="desktop-tab-add" aria-label="New chat tab" disabled={snapshot.phase !== 'connected'} onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>＋</button></div>
      <main ref={content} className="native-view-slot">{snapshot.errorMessage && <div className="error-banner" role="alert">{snapshot.errorMessage}</div>}{!snapshot.activeTabId && (snapshot.loadingConversations && !snapshot.errorMessage ? <div className="empty-session" role="status" aria-live="polite" aria-busy="true"><h1>Loading your conversations…</h1></div> : <div className="empty-session"><h1>Start a conversation</h1><p>Open a recent session or create a new chat.</p>{snapshot.phase === 'connected' && <button type="button" onClick={() => invoke(window.hermesDesktop.newTab(snapshot.selectedChannelId))}>New chat</button>}</div>)}</main>
    </section>
    {error && <div className="native-tab-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss tab error">×</button></div>}
    {children}
  </div>;
}
