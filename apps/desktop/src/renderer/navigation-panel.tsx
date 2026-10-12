import { memo, useEffect, useRef, useState } from "react";
import type { DesktopSnapshot, DesktopThread } from "../shared/desktop-api";
import { recentWindow, threadWindow } from "./thread-navigation";
import { addQueryLabel, emptySessionQuery, frequentSessionLabels, removeQueryLabel, sessionLabelSuggestions, sessionQueryActive, type SessionQuery } from '../../../../packages/client/src/sessionSearch';
import { LabelPills } from './session-labels';
import { SearchIcon, searchSessions, SessionQueryInput } from './session-search';
import { orderProjects, projectUnreadCounts, unreadCountDescription, unreadCountLabel } from '../../../../packages/client/src/projectDirectory';
import { Icon } from './icons';
import { AutomationsSection } from './automations';

// Only states that need the user's attention are shown in the tree.
const connectionHint: Partial<Record<string, string>> = { retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention' };
// Snapshot deltas rebuild the connection array; compare only what the tree shows.
const connectionStates = (snapshot: DesktopSnapshot) => (snapshot.connections ?? []).map(row => `${row.connectionKey ?? ''}=${row.state}`).join('|');
// The job whose tab is in front; its sidebar row is selected.
const activeAutomation = (snapshot: DesktopSnapshot) => snapshot.tabs?.find(tab => tab.id === snapshot.activeTabId)?.automationId;

const ThreadRow = memo(({thread,selected,draft,onMenu,showLabels,hint,source}: {thread:DesktopThread;selected:boolean;draft:boolean;showLabels?:boolean;hint?:string;source?:string;onMenu?:(thread:DesktopThread,x:number,y:number)=>void}) => <button type="button" className={`tree-thread${selected ? " selected" : ""}`} title={hint} aria-current={selected ? "page" : undefined} onClick={() => void window.hermesDesktop.selectThread(thread.id).catch(() => {})}
  onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(thread, event.clientX, event.clientY); } : undefined}
  onKeyDown={onMenu ? event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); onMenu(thread, box.left, box.bottom); } } : undefined}>
  <span className="thread-row-main">
  <span className="thread-title">{thread.title}</span>{source ? <span className="thread-connection-name">{source}</span> : null}{draft ? <span className="thread-draft" aria-label="Draft">draft</span> : null}{thread.running ? <span className="thread-status">Running</span> : null}{thread.completedUnread ? <span className="thread-result-unread" role="img" aria-label="Completed, unread" /> : null}
  </span>{showLabels && <LabelPills markers={thread.markers} />}
</button>);

const RECENTS_KEY = 'hermes.sidebar.recents-collapsed';
const loadRecentsCollapsed = () => { try { return window.localStorage.getItem(RECENTS_KEY) === '1'; } catch { return false; } };

/**
 * Sidebar content, top to bottom: New chat, the session search box,
 * Automations (scheduled jobs; hidden when no connection offers them), Recents
 * (Sessions active in the last 24 hours across every Project), then one flat
 * Project tree across every connection. A Project shows its Hermes name only
 * when several exist. While a search is active, one flat result list replaces
 * Automations, Recents and the Project tree. The search matches like Cmd+K: a keyword
 * (title or label text) plus exact labels, all required.
 */
export const NavigationPanel = memo(({ snapshot, onNewSession, draftThreads, onEditLabels, onChannelOptions, onCreateProject, search: controlledSearch, onSearch }: { snapshot: DesktopSnapshot; onNewSession: (channelId: string) => void; draftThreads?: ReadonlySet<string>; onEditLabels?: (thread: DesktopThread) => void; onChannelOptions?: (id: string) => void; onCreateProject?: () => void; search?: SessionQuery; onSearch?: (query: SessionQuery) => void }) => {
  // The workspace owns the query so a Session page's label click and a collapsed sidebar keep it; standalone use keeps it here.
  const [localSearch, setLocalSearch] = useState(emptySessionQuery);
  const search = controlledSearch ?? localSearch, setSearch = onSearch ?? setLocalSearch;
  const [searchBatches, setSearchBatches] = useState(0);
  useEffect(() => setSearchBatches(0), [search]);
  const [expanded, setExpanded] = useState(() => new Set(snapshot.channels.map(channel => channel.id)));
  const knownProjects = useRef(new Set(snapshot.channels.map(channel => channel.id)));
  useEffect(() => {
    const incoming = snapshot.channels.filter(channel => !knownProjects.current.has(channel.id)).map(channel => channel.id);
    knownProjects.current = new Set(snapshot.channels.map(channel => channel.id));
    if (incoming.length) setExpanded(old => new Set([...old, ...incoming]));
  }, [snapshot.channels]);
  const [batches, setBatches] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<{ thread: DesktopThread; x: number; y: number } | null>(null);
  const [recentsCollapsed, setRecentsCollapsed] = useState(loadRecentsCollapsed);
  const [recentBatches, setRecentBatches] = useState(0);
  const searching = sessionQueryActive(search);
  const available = snapshot.threads.filter(thread => snapshot.channels.some(channel => channel.id === thread.channelId));
  // Counts use every listed session, independent of the label filter and the
  // recent-activity window. Directory metadata only; no conversation bodies.
  const unread = projectUnreadCounts(available.map(thread => ({ projectId: thread.channelId, completedUnread: thread.completedUnread })));
  const projects = orderProjects(snapshot.channels);
  const multiple = (snapshot.connections?.length ?? 0) > 1;
  const stateFor = (key?: string) => key ? snapshot.connections?.find(row => row.connectionKey === key)?.state : undefined;
  const anyOnline = snapshot.connections ? snapshot.connections.some(row => row.state === 'online') : snapshot.phase === 'connected';
  useEffect(() => { setBatches({}); setRecentBatches(0); setMenu(null); }, [snapshot.connectionKey]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null), key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('click', dismiss); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('keydown', key); };
  }, [menu]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snapshot.selectedChannelId) setExpanded((old) => new Set([...old, snapshot.selectedChannelId!]));
  }, [snapshot.selectedChannelId]);
  const projectName = new Map(snapshot.channels.map(channel => [channel.id, channel.name]));
  const connectionName = new Map(snapshot.channels.map(channel => [channel.id, channel.connectionName]));
  const recents = recentWindow(available, now, recentBatches);
  const labelsFor = (thread: DesktopThread) => thread.supportsSessionLabels ?? snapshot.supportsSessionLabels === true;
  // Top labels across every listed session that supports labels; a click toggles the label in the search.
  const frequent = frequentSessionLabels(available.filter(labelsFor));
  const row = (thread: DesktopThread, hint?: string, source?: string) => <ThreadRow key={thread.id} thread={thread} hint={hint} source={source} selected={thread.id === snapshot.selectedThreadId} draft={draftThreads?.has(thread.id) ?? false} showLabels={labelsFor(thread)} onMenu={labelsFor(thread) && onEditLabels ? (thread, x, y) => setMenu({ thread, x, y }) : undefined} />;
  // Recents mixes every connection; with several, each row names its connection.
  const recentRow = (thread: DesktopThread) => {
    const source = multiple ? connectionName.get(thread.channelId) : undefined;
    return row(thread, [projectName.get(thread.channelId), source].filter(Boolean).join(' · ') || undefined, source);
  };
  return <div className="sidebar-scroll">
    <nav className="sidebar-actions" aria-label="Create">
      <button type="button" className="sidebar-action" onClick={() => onNewSession(snapshot.selectedChannelId ?? projects[0]?.id ?? '')}><Icon name="compose" /><span>New chat</span></button>
    </nav>
    <div className="sidebar-search" role="search">
      <SearchIcon />
      <SessionQueryInput query={search} onChange={setSearch} inputProps={{ 'aria-label': 'Search sessions', placeholder: 'Search',
        onKeyDown: event => { if (event.key === 'Escape' && searching) { event.preventDefault(); event.stopPropagation(); setSearch(emptySessionQuery()); } } }} />
      {searching && <button type="button" className="sidebar-search-clear sidebar-icon-button" aria-label="Clear search" title="Clear search" onClick={() => setSearch(emptySessionQuery())}>×</button>}
    </div>
    {frequent.length > 0 && <div className="sidebar-frequent-labels" role="group" aria-label="Frequent labels">
      {frequent.map(label => { const on = search.labels.includes(label);
        return <button key={label} type="button" className="label-pill frequent-label" title={label} aria-pressed={on} aria-label={on ? `Remove label ${label} from search` : `Search label ${label}`}
          onClick={() => setSearch(on ? removeQueryLabel(search, label) : addQueryLabel(search, label))}>{label}</button>; })}
    </div>}
    {searching ? (() => {
      const suggestions = snapshot.supportsSessionLabels === true ? sessionLabelSuggestions(available, search) : [];
      const results = searchSessions(snapshot, available, search), shown = results.slice(0, (searchBatches + 1) * 24);
      return <section className="sidebar-search-results" aria-label="Search results">
        {suggestions.length > 0 && <div className="sidebar-search-labels" role="group" aria-label="Matching labels">
          {suggestions.map(label => <button key={label} type="button" className="label-pill search-label-suggestion" title={label} aria-label={`Search label ${label}`} onClick={() => setSearch({ ...addQueryLabel(search, label), text: '' })}>{label}</button>)}
        </div>}
        <div className="item-list search-result-list">
          {shown.map(thread => row(thread, projectName.get(thread.channelId)))}
          {!results.length && <p className="tree-empty">No matching sessions</p>}
          {results.length > shown.length && <button className="tree-more" type="button" onClick={() => setSearchBatches(value => value + 1)}>Show more</button>}
        </div>
      </section>;
    })() : <>
    <AutomationsSection connectionStates={connectionStates(snapshot)} threads={snapshot.threads} activeAutomationId={activeAutomation(snapshot)} multiple={multiple} />
    <section className="sidebar-recents" aria-labelledby="sidebar-recents-title">
      <div className="sidebar-section-header">
        <h2 className="sidebar-section-title"><button type="button" className="sidebar-section-toggle" id="sidebar-recents-title" aria-expanded={!recentsCollapsed} aria-controls="sidebar-recents-list"
          onClick={() => setRecentsCollapsed(old => { const next = !old; try { window.localStorage.setItem(RECENTS_KEY, next ? '1' : '0'); } catch { /* Device preference only. */ } return next; })}>
          <span>Recents</span><Icon name={recentsCollapsed ? 'chevronRight' : 'chevronDown'} className="sidebar-section-chevron" /></button></h2>
      </div>
      {!recentsCollapsed && <div className="item-list recent-list" id="sidebar-recents-list">
        {recents.rows.map(recentRow)}
        {!recents.rows.length && <p className="tree-empty">No sessions in the last 24 hours</p>}
        {recents.hasMore && <button className="tree-more" type="button" onClick={() => setRecentBatches(value => value + 1)}>Show more</button>}
      </div>}
    </section>
    <div className="sidebar-section-header">
      <h2 className="sidebar-section-title" id="sidebar-projects-title">Projects</h2>
      {onCreateProject && <button type="button" className="sidebar-icon-button sidebar-new-project" aria-label="New project" title="New project" disabled={!anyOnline} onClick={onCreateProject}><Icon name="plus" /></button>}
    </div>
    <div className="item-list channel-tree" aria-labelledby="sidebar-projects-title">
    {projects.map((channel) => {
      const open = expanded.has(channel.id);
      const page = threadWindow(available, channel.id, now, batches[channel.id] ?? 0);
      const count = unread.get(channel.id) ?? 0, hint = connectionHint[stateFor(channel.connectionKey) ?? ''];
      const source = [multiple ? channel.connectionName : undefined, hint].filter(Boolean).join(' · ');
      return <section className="channel-branch" key={channel.id}>
        <div className="channel-toolbar"><button type="button" className={`channel-toggle${channel.id === snapshot.selectedChannelId ? " current-channel" : ""}`} aria-expanded={open} aria-controls={`branch-${channel.id}`}
          aria-label={[channel.name, multiple ? channel.connectionName : undefined, hint, unreadCountDescription(count)].filter(Boolean).join(', ')}
          onClick={() => setExpanded((old) => { const next = new Set(old); if (open) next.delete(channel.id); else next.add(channel.id); return next; })}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} className="channel-chevron" /><span className="channel-name"><strong>{channel.name}</strong>{source && <small className={`channel-connection-name${hint ? ' channel-connection-issue' : ''}`}>{source}</small>}</span>
          {count > 0 && <span className="project-unread-count" aria-hidden="true">{unreadCountLabel(count)}</span>}
        </button>{onChannelOptions && <button type="button" className="channel-options sidebar-icon-button" aria-label={`Options for ${channel.name}`} title="Project options" onClick={() => onChannelOptions(channel.id)}><Icon name="more" /></button>}<button type="button" className="channel-new-session sidebar-icon-button" aria-label={`New session in ${channel.name}`} title="New session" onClick={() => onNewSession(channel.id)}><Icon name="compose" /></button></div>
        {open ? <div id={`branch-${channel.id}`} className="thread-children">
          {page.rows.map(thread => row(thread))}
          {!page.rows.length ? <p className="tree-empty">No recent activity</p> : null}
          {page.hasMore ? <button className="tree-more" type="button" onClick={() => setBatches((old) => ({ ...old, [channel.id]: (old[channel.id] ?? 0) + 1 }))}>Show more</button> : null}
        </div> : null}
      </section>;
    })}
    {!snapshot.channels.length && !snapshot.loadingConversations ? <p className="empty-state">No projects yet.</p> : null}
    </div>
    </>}
    {menu && <div className="session-context-menu" role="menu" aria-label="Session options" style={{ left: Math.max(0, Math.min(menu.x, window.innerWidth - 180)), top: Math.max(0, Math.min(menu.y, window.innerHeight - 60)) }}><button autoFocus type="button" role="menuitem" disabled={(snapshot.connections ? snapshot.connections.find(row => row.connectionKey === snapshot.channels.find(c => c.id === menu.thread.channelId)?.connectionKey)?.state : snapshot.connectionState) !== 'online' || !available.some(thread => thread.id === menu.thread.id)} onClick={() => { const thread = available.find(thread => thread.id === menu.thread.id); if (thread) onEditLabels?.(thread); setMenu(null); }}>Edit labels</button></div>}
  </div>;
}, (before,after) => before.draftThreads === after.draftThreads && before.search === after.search && before.onSearch === after.onSearch && before.onNewSession === after.onNewSession && before.onEditLabels === after.onEditLabels && before.onCreateProject === after.onCreateProject && before.snapshot.channels === after.snapshot.channels && before.snapshot.threads === after.snapshot.threads && before.snapshot.selectedChannelId === after.snapshot.selectedChannelId && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.loadingConversations === after.snapshot.loadingConversations && before.snapshot.connectionKey === after.snapshot.connectionKey && before.snapshot.supportsSessionLabels === after.snapshot.supportsSessionLabels && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.phase === after.snapshot.phase && connectionStates(before.snapshot) === connectionStates(after.snapshot) && activeAutomation(before.snapshot) === activeAutomation(after.snapshot));
