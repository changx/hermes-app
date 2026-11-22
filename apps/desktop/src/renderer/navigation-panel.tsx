import { memo, useEffect, useRef, useState } from "react";
import { SessionHoverCard, type SessionCardInfo } from "./session-hover-card";
import type { DesktopSnapshot, DesktopThread } from "../shared/desktop-api";
import { recentWindow, threadWindow, todoWindow } from "./thread-navigation";
import { hasTodo, withoutTodo } from '../../../../packages/client/src/todo';
import { setSessionTodo } from './todo-toggle';
import { orderProjects, projectUnreadCounts, unreadCountDescription, unreadCountLabel } from '../../../../packages/client/src/projectDirectory';
import { Icon } from './icons';
import { SearchIcon } from './session-search';
import { ScreenIcon } from './remote-screen-page';
import { AutomationsSection } from './automations';
import { isSessionMenuAction, sessionMenuItems } from './session-menu';
import { activeGroupName, otherGroupUnread } from '../../../../packages/client/src/connectionGroups';
import { sideChatsBySource, sideWindow } from '../../../../packages/client/src/sideChats';
import { SideIcon } from './side-chats';

// Only states that need the user's attention are shown in the tree.
export const connectionHint: Partial<Record<string, string>> = { retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention' };
// Snapshot deltas rebuild the connection array; compare only what the tree shows.
const connectionStates = (snapshot: DesktopSnapshot) => (snapshot.connections ?? []).map(row => `${row.connectionKey ?? ''}=${row.state}`).join('|');
// The job whose tab is in front; its sidebar row is selected.
const activeAutomation = (snapshot: DesktopSnapshot) => snapshot.tabs?.find(tab => tab.id === snapshot.activeTabId)?.automationId;

// Row order: title, draft, Running, connection name, unread dot, todo flag. The title shrinks first.
// Rows show the todo flag only; other labels stay on the Session page and in search.
// `menuOpen` marks the row whose native menu is showing, like a Finder row.
// No native `title`: SessionHoverCard shows the full title and details (found by `data-thread-id`).
// A side chat row (docs/side-chat.md) opens its source Session with the side chat in the right column.
const ThreadRow = memo(({thread,selected,draft,onMenu,source,menuOpen,side=false}: {thread:DesktopThread;selected:boolean;draft:boolean;source?:string;menuOpen?:boolean;side?:boolean;onMenu?:(thread:DesktopThread,x:number,y:number)=>void}) => <button type="button" className={`tree-thread${side ? " tree-side" : ""}${selected ? " selected" : ""}${menuOpen ? " menu-open" : ""}`} data-thread-id={thread.id} aria-current={selected ? "page" : undefined} aria-haspopup={onMenu ? "menu" : undefined} onClick={() => void (side ? window.hermesDesktop.openSideChat(thread.id) : window.hermesDesktop.selectThread(thread.id)).catch(() => {})}
  onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(thread, event.clientX, event.clientY); } : undefined}
  onKeyDown={onMenu ? event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); onMenu(thread, box.left, box.bottom); } } : undefined}>
  <span className="thread-row-main">
  {side ? <span className="tree-side-icon" aria-hidden="true"><SideIcon /></span> : null}<span className="thread-title">{thread.title}</span>{draft ? <span className="thread-draft" aria-label="Draft">draft</span> : null}{thread.running ? <span className="thread-status">Running</span> : null}{source ? <span className="thread-connection-name">{source}</span> : null}{thread.completedUnread ? <span className="thread-result-unread" role="img" aria-label="Completed, unread" /> : null}{hasTodo(thread.markers) ? <span className="thread-todo" role="img" aria-label="Todo"><Icon name="flag" /></span> : null}
  </span>
</button>);

const RECENTS_KEY = 'hermes.sidebar.recents-collapsed', TODO_KEY = 'hermes.sidebar.todo-collapsed';
// Source Sessions whose side chats are folded on this device; every other source starts expanded.
const SIDES_KEY = 'hermes.sidebar.side-chats-collapsed';
const loadFolded = (): Set<string> => { try { const value = JSON.parse(window.localStorage.getItem(SIDES_KEY) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 2000) : []); } catch { return new Set(); } };
const saveFolded = (ids: ReadonlySet<string>) => { try { window.localStorage.setItem(SIDES_KEY, JSON.stringify([...ids].slice(-2000))); } catch { /* Device preference only. */ } };
// The side chat shown in front of the active tab's right column; its sidebar row is selected.
const frontSide = (snapshot: DesktopSnapshot) => snapshot.sidePanels?.find(panel => panel.id === snapshot.rightTab)?.threadId;
const loadCollapsed = (key: string) => () => { try { return window.localStorage.getItem(key) === '1'; } catch { return false; } };
const saveCollapsed = (key: string, value: boolean) => { try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* Device preference only. */ } };

/**
 * Sidebar content, top to bottom: New chat, Automations (scheduled jobs; hidden
 * when no connection offers them), Todo (every flagged Session; hidden when
 * none), Recents (Sessions active in the last 72 hours across every Project;
 * running first), then one flat Project tree across every connection. A Project
 * shows its Hermes name only when several exist. Search is the Cmd+K dialog
 * (Sessions, files and labels); the sidebar has no search box (docs/session-files.md).
 */
/** One request to show a Project in the sidebar; a new object is a new request. */
export type ProjectReveal = Readonly<{ channelId: string }>;

export const NavigationPanel = memo(({ snapshot, onNewSession, draftThreads, onEditLabels, onRename, onChannelOptions, onCreateProject, onSearch, reveal }: { snapshot: DesktopSnapshot; onNewSession: (channelId: string) => void; draftThreads?: ReadonlySet<string>; onEditLabels?: (thread: DesktopThread) => void; onRename?: (thread: DesktopThread) => void; onChannelOptions?: (id: string) => void; onCreateProject?: () => void; onSearch?: () => void; reveal?: ProjectReveal }) => {
  const [expanded, setExpanded] = useState(() => new Set(snapshot.channels.map(channel => channel.id)));
  const knownProjects = useRef(new Set(snapshot.channels.map(channel => channel.id)));
  useEffect(() => {
    const incoming = snapshot.channels.filter(channel => !knownProjects.current.has(channel.id)).map(channel => channel.id);
    knownProjects.current = new Set(snapshot.channels.map(channel => channel.id));
    if (incoming.length) setExpanded(old => new Set([...old, ...incoming]));
  }, [snapshot.channels]);
  // A Session page's status bar asks to show its Project: open the branch, scroll to it and mark it briefly.
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!reveal) return;
    setExpanded(old => old.has(reveal.channelId) ? old : new Set([...old, reveal.channelId])); setRevealed(reveal.channelId);
    const frame = requestAnimationFrame(() => document.querySelector(`.channel-branch[data-channel-id="${CSS.escape(reveal.channelId)}"]`)?.scrollIntoView({ block: 'nearest' }));
    const timer = setTimeout(() => setRevealed(null), 1600);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [reveal]);
  const [batches, setBatches] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [menuThread, setMenuThread] = useState<string | null>(null);
  const [recentsCollapsed, setRecentsCollapsed] = useState(loadCollapsed(RECENTS_KEY));
  const [recentBatches, setRecentBatches] = useState(0);
  const [todoCollapsed, setTodoCollapsed] = useState(loadCollapsed(TODO_KEY));
  const [todoBatches, setTodoBatches] = useState(0);
  const reachable = snapshot.threads.filter(thread => snapshot.channels.some(channel => channel.id === thread.channelId));
  // Side chats never are first-level rows: they show under their source Session, and hide with it.
  const reachableIds = new Set(reachable.map(thread => thread.id));
  const listed = reachable.filter(thread => !thread.sideOf || reachableIds.has(thread.sideOf.threadId));
  const available = listed.filter(thread => !thread.sideOf);
  const sideGroups = sideChatsBySource(listed, thread => thread.sideOf?.threadId);
  const [folded, setFolded] = useState(loadFolded), [sideBatches, setSideBatches] = useState<Record<string, number>>({});
  const front = frontSide(snapshot);
  // Counts use every listed session, independent of the label filter and the
  // recent-activity window. Directory metadata only; no conversation bodies.
  const unread = projectUnreadCounts(listed.map(thread => ({ projectId: thread.channelId, completedUnread: thread.completedUnread })));
  const projects = orderProjects(snapshot.channels);
  const multiple = (snapshot.connections?.length ?? 0) > 1;
  const stateFor = (key?: string) => key ? snapshot.connections?.find(row => row.connectionKey === key)?.state : undefined;
  const anyOnline = snapshot.connections ? snapshot.connections.some(row => row.state === 'online') : snapshot.phase === 'connected';
  useEffect(() => { setBatches({}); setRecentBatches(0); setTodoBatches(0); }, [snapshot.connectionKey]);
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
  const todos = todoWindow(available, todoBatches);
  const labelsFor = (thread: DesktopThread) => thread.supportsSessionLabels ?? snapshot.supportsSessionLabels === true;
  const connectionOf = (thread: DesktopThread) => snapshot.channels.find(c => c.id === thread.channelId)?.connectionKey ?? snapshot.connectionKey;
  const menuOnline = (thread: DesktopThread) => (snapshot.connections ? snapshot.connections.find(row => row.connectionKey === connectionOf(thread))?.state : snapshot.connectionState) === 'online' && listed.some(item => item.id === thread.id);
  // A native menu: the Session page is a separate view over the window, so an HTML menu would be cut off at the sidebar edge.
  const openMenu = (thread: DesktopThread, x: number, y: number) => {
    if (menuThread) return;
    const todo = hasTodo(thread.markers), labels = labelsFor(thread) && !!onEditLabels, online = menuOnline(thread);
    const items = sessionMenuItems({ todo, labels, online }).map(item => 'id' in item && item.id === 'rename' && !onRename ? { ...item, enabled: false } : item);
    setMenuThread(thread.id);
    void window.hermesDesktop.showContextMenu(items, x, y).catch(() => null).then(choice => {
      setMenuThread(null);
      if (!isSessionMenuAction(choice)) return;
      if (choice === 'rename') onRename?.(thread);
      else if (choice === 'labels') onEditLabels?.(thread);
      else if (choice === 'todo') void setSessionTodo(thread, !todo, connectionOf(thread) ?? '').catch((error: Error) => window.alert(error.message));
      else if (choice === 'copy-link') void window.hermesDesktop.copySessionLink(thread.id).catch(() => window.alert('Could not copy the link.'));
      // A failed archive shows the connection's error banner; the row stays.
      else if (window.confirm(`Archive "${thread.title}"?`)) void window.hermesDesktop.archiveThread(thread.id).catch(() => {});
    });
  };
  const plainRow = (thread: DesktopThread, source?: string, side = false) => <ThreadRow key={thread.id} thread={thread} source={source} side={side} selected={side ? thread.id === front : thread.id === snapshot.selectedThreadId} draft={draftThreads?.has(thread.id) ?? false} menuOpen={thread.id === menuThread} onMenu={openMenu} />;
  // A source Session with side chats: its title stays in line with the other rows; the fold control sits at the right end
  // (shown on hover or focus, and always while folded, with the count). Its side chats are one level lower (running and the newest SIDE_BATCH, Show more).
  const row = (thread: DesktopThread, source?: string) => {
    const sides = sideGroups.get(thread.id);
    if (!sides?.length) return plainRow(thread, source);
    const open = !folded.has(thread.id), page = sideWindow(sides, sideBatches[thread.id] ?? 0);
    const fold = () => setFolded(old => { const next = new Set(old); if (open) next.add(thread.id); else next.delete(thread.id); saveFolded(next); return next; });
    return <div className="tree-thread-group" key={thread.id}>
      <div className={`tree-thread-with-sides${open ? "" : " folded"}`}>
        <button type="button" className="tree-side-toggle" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} side chats of ${thread.title}`} onClick={fold}>{open ? <Icon name="chevronDown" /> : <><span className="tree-side-count">{sides.length}</span><Icon name="chevronRight" /></>}</button>
        {plainRow(thread, source)}
      </div>
      {open && <div className="tree-side-children" role="group" aria-label={`Side chats of ${thread.title}`}>
        {page.rows.map(side => plainRow(side, undefined, true))}
        {page.hasMore && <button className="tree-more tree-side-more" type="button" onClick={() => setSideBatches(old => ({ ...old, [thread.id]: (old[thread.id] ?? 0) + 1 }))}>Show more</button>}
      </div>}
    </div>;
  };
  // Recents mixes every connection; with several, each row names its connection.
  const recentRow = (thread: DesktopThread) => {
    const source = multiple ? connectionName.get(thread.channelId) : undefined;
    return row(thread, source);
  };
  const scroll = useRef<HTMLDivElement>(null);
  const describe = (id: string): SessionCardInfo | undefined => {
    const thread = listed.find(item => item.id === id);
    if (!thread) return undefined;
    const statuses = [thread.running && 'Running', draftThreads?.has(id) && 'Draft', thread.completedUnread && 'Completed, unread', hasTodo(thread.markers) && 'Todo'].filter((item): item is string => !!item);
    return { title: thread.title, project: projectName.get(thread.channelId), connection: multiple ? connectionName.get(thread.channelId) : undefined,
      statuses, labels: withoutTodo(thread.markers), lastMessageAt: thread.lastMessageAt };
  };
  return <div className="sidebar-scroll" ref={scroll}>
    <SessionHoverCard root={scroll} describe={describe} />
    <nav className="sidebar-actions" aria-label="Create">
      <button type="button" className="sidebar-action" onClick={() => onNewSession(snapshot.selectedChannelId ?? projects[0]?.id ?? '')}><Icon name="compose" /><span>New chat</span></button>
      {onSearch && <button type="button" className="sidebar-action sidebar-search-action" aria-keyshortcuts="Meta+K" onClick={onSearch}><SearchIcon /><span>Search</span><kbd>⌘K</kbd></button>}
      {/* Remote browser (docs/remote-screen.md): each connection whose server has a remote screen. */}
      {(snapshot.connections ?? []).filter(c => c.remoteScreen && c.connectionKey && c.state === 'online').map(c =>
        <button type="button" key={c.id} className="sidebar-action sidebar-search-action sidebar-remote-screen" onClick={() => void window.hermesDesktop.openRemoteScreen(c.connectionKey!).catch(() => {})}>
          <ScreenIcon /><span>{c.remoteScreen!.name}{multiple ? ` · ${c.name}` : ''}</span></button>)}
    </nav>
    <AutomationsSection connectionStates={connectionStates(snapshot)} threads={snapshot.threads} activeAutomationId={activeAutomation(snapshot)} multiple={multiple} automationsVersion={snapshot.automationsVersion} />
    {todos.rows.length > 0 && <section className="sidebar-todo" aria-labelledby="sidebar-todo-title">
      <div className="sidebar-section-header">
        <h2 className="sidebar-section-title"><button type="button" className="sidebar-section-toggle" id="sidebar-todo-title" aria-expanded={!todoCollapsed} aria-controls="sidebar-todo-list"
          onClick={() => setTodoCollapsed(old => { saveCollapsed(TODO_KEY, !old); return !old; })}>
          <span>Todo</span><Icon name={todoCollapsed ? 'chevronRight' : 'chevronDown'} className="sidebar-section-chevron" /></button></h2>
      </div>
      {!todoCollapsed && <div className="item-list recent-list todo-list" id="sidebar-todo-list">
        {todos.rows.map(recentRow)}
        {todos.hasMore && <button className="tree-more" type="button" onClick={() => setTodoBatches(value => value + 1)}>Show more</button>}
      </div>}
    </section>}
    <section className="sidebar-recents" aria-labelledby="sidebar-recents-title">
      <div className="sidebar-section-header">
        <h2 className="sidebar-section-title"><button type="button" className="sidebar-section-toggle" id="sidebar-recents-title" aria-expanded={!recentsCollapsed} aria-controls="sidebar-recents-list"
          onClick={() => setRecentsCollapsed(old => { saveCollapsed(RECENTS_KEY, !old); return !old; })}>
          <span>Recents</span><Icon name={recentsCollapsed ? 'chevronRight' : 'chevronDown'} className="sidebar-section-chevron" /></button></h2>
      </div>
      {!recentsCollapsed && <div className="item-list recent-list" id="sidebar-recents-list">
        {recents.rows.map(recentRow)}
        {!recents.rows.length && <p className="tree-empty">No sessions in the last 72 hours</p>}
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
      return <section className={`channel-branch${revealed === channel.id ? ' channel-revealed' : ''}`} key={channel.id} data-channel-id={channel.id}>
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
  </div>;
}, (before,after) => before.draftThreads === after.draftThreads && before.onNewSession === after.onNewSession && before.onEditLabels === after.onEditLabels && before.onRename === after.onRename && before.onCreateProject === after.onCreateProject && before.onSearch === after.onSearch && before.snapshot.channels === after.snapshot.channels && before.snapshot.threads === after.snapshot.threads && before.snapshot.selectedChannelId === after.snapshot.selectedChannelId && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.loadingConversations === after.snapshot.loadingConversations && before.snapshot.connectionKey === after.snapshot.connectionKey && before.snapshot.supportsSessionLabels === after.snapshot.supportsSessionLabels && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.phase === after.snapshot.phase && connectionStates(before.snapshot) === connectionStates(after.snapshot) && activeAutomation(before.snapshot) === activeAutomation(after.snapshot) && before.snapshot.automationsVersion === after.snapshot.automationsVersion && before.reveal === after.reveal && frontSide(before.snapshot) === frontSide(after.snapshot));

/**
 * Connection group switcher (docs/connection-groups.md): the footer of the sidebar, below the
 * scrolling lists. Shown only when this device has groups. The sidebar, tabs, search and
 * Automations list only the active group's connections. A dot marks an unread result in another group.
 */
export function GroupSwitch({ snapshot }: { snapshot: DesktopSnapshot }) {
  const state = snapshot.connectionGroups;
  if (!state || !state.groups.length) return null;
  // The main window lists only the active group's connections; other groups' unread marks come from the group state.
  const unread = new Set(state.unread ?? []);
  const name = activeGroupName(state), dot = otherGroupUnread(state, unread);
  return <button type="button" className="sidebar-action sidebar-group-switch" aria-haspopup="menu" aria-label={`Group: ${name}${dot ? ', another group has unread results' : ''}`}
    onClick={event => { const box = event.currentTarget.getBoundingClientRect(); void window.hermesDesktop.showGroupMenu(box.left, box.top).catch(() => {}); }}>
    <span className="sidebar-group-name">{name}</span><Icon name="chevronDown" className="sidebar-group-chevron" />
    {dot && <span className="sidebar-group-unread" role="img" aria-hidden="true" />}
  </button>;
}

/** Sidebar footer: the group switcher (when groups exist) on the left, Settings on the right. */
export function SidebarFooter({ snapshot, onSettings }: { snapshot: DesktopSnapshot; onSettings: () => void }) {
  return <div className="sidebar-group-footer">
    <GroupSwitch snapshot={snapshot} />
    {/* Settings stays usable while unpaired or offline, so the button is never disabled. */}
    <button type="button" className="sidebar-icon-button sidebar-settings" aria-label="Settings" title="Settings (⌘,)" onClick={onSettings}><Icon name="gear" /></button>
  </div>;
}
