import { memo, useEffect, useRef, useState } from "react";
import type { DesktopSnapshot, DesktopThread } from "../shared/desktop-api";
import { threadWindow } from "./thread-navigation";
import { emptyLabelFilter, labelFilterActive, matchesLabels } from '../../../../packages/client/src/sessionLabels';
import { LabelPills, LabelsFilter } from './session-labels';
import { orderProjects, projectUnreadCounts, unreadCountDescription, unreadCountLabel } from '../../../../packages/client/src/projectDirectory';

// Only states that need the user's attention are shown in the tree.
const connectionHint: Partial<Record<string, string>> = { retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention' };
// Snapshot deltas rebuild the connection array; compare only what the tree shows.
const connectionStates = (snapshot: DesktopSnapshot) => (snapshot.connections ?? []).map(row => `${row.connectionKey ?? ''}=${row.state}`).join('|');

const ThreadRow = memo(({thread,selected,draft,onMenu,showLabels}: {thread:DesktopThread;selected:boolean;draft:boolean;showLabels?:boolean;onMenu?:(thread:DesktopThread,x:number,y:number)=>void}) => <button type="button" className={`tree-thread${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => void window.hermesDesktop.selectThread(thread.id).catch(() => {})}
  onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(thread, event.clientX, event.clientY); } : undefined}
  onKeyDown={onMenu ? event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); onMenu(thread, box.left, box.bottom); } } : undefined}>
  <span className="thread-row-main">
  <span className="thread-title">{thread.title}</span>{draft ? <span className="thread-draft" aria-label="Draft">draft</span> : null}{thread.running ? <span className="thread-status">Running</span> : null}{thread.completedUnread ? <span className="thread-result-unread" role="img" aria-label="Completed, unread" /> : null}
  </span>{showLabels && <LabelPills markers={thread.markers} />}
</button>);

export const NavigationPanel = memo(({ snapshot, onNewSession, draftThreads, onEditLabels, onChannelOptions }: { snapshot: DesktopSnapshot; onNewSession: (channelId: string) => void; draftThreads?: ReadonlySet<string>; onEditLabels?: (thread: DesktopThread) => void; onChannelOptions?: (id: string) => void }) => {
  const [expanded, setExpanded] = useState(() => new Set(snapshot.channels.map(channel => channel.id)));
  const knownProjects = useRef(new Set(snapshot.channels.map(channel => channel.id)));
  useEffect(() => {
    const incoming = snapshot.channels.filter(channel => !knownProjects.current.has(channel.id)).map(channel => channel.id);
    knownProjects.current = new Set(snapshot.channels.map(channel => channel.id));
    if (incoming.length) setExpanded(old => new Set([...old, ...incoming]));
  }, [snapshot.channels]);
  const [batches, setBatches] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState(emptyLabelFilter);
  const [menu, setMenu] = useState<{ thread: DesktopThread; x: number; y: number } | null>(null);
  const filtering = snapshot.supportsSessionLabels === true && labelFilterActive(filter);
  const available = snapshot.threads.filter(thread => snapshot.channels.some(channel => channel.id === thread.channelId));
  // Counts use every listed session, independent of the label filter and the
  // recent-activity window. Directory metadata only; no conversation bodies.
  const unread = projectUnreadCounts(available.map(thread => ({ projectId: thread.channelId, completedUnread: thread.completedUnread })));
  const projects = orderProjects(snapshot.channels);
  const multiple = (snapshot.connections?.length ?? 0) > 1;
  const stateFor = (key?: string) => key ? snapshot.connections?.find(row => row.connectionKey === key)?.state : undefined;
  useEffect(() => { setFilter(emptyLabelFilter()); setBatches({}); setMenu(null); }, [snapshot.connectionKey]);
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
  return <div className="item-list channel-tree" aria-label="Channels and threads">
    {snapshot.supportsSessionLabels === true ? <LabelsFilter rows={available} value={filter} onNewChat={() => onNewSession(snapshot.selectedChannelId ?? snapshot.channels[0]?.id ?? '')} onChange={value => { setFilter(value); setBatches({}); }} /> : <button type="button" className="sidebar-new-chat" onClick={() => onNewSession(snapshot.selectedChannelId ?? snapshot.channels[0]?.id ?? '')}>✎ New chat</button>}
    {projects.map((channel) => {
      const open = filtering || expanded.has(channel.id);
      const page = threadWindow(available, channel.id, now, batches[channel.id] ?? 0, filtering ? filter : emptyLabelFilter());
      if (filtering && !page.rows.length) return null;
      const count = unread.get(channel.id) ?? 0, hint = connectionHint[stateFor(channel.connectionKey) ?? ''];
      const source = [multiple ? channel.connectionName : undefined, hint].filter(Boolean).join(' · ');
      return <section className="channel-branch" key={channel.id}>
        <div className="channel-toolbar"><button type="button" className={`channel-toggle${channel.id === snapshot.selectedChannelId ? " current-channel" : ""}`} aria-expanded={open} aria-controls={`branch-${channel.id}`}
          aria-label={[channel.name, multiple ? channel.connectionName : undefined, hint, unreadCountDescription(count)].filter(Boolean).join(', ')}
          onClick={() => setExpanded((old) => { const next = new Set(old); if (open) next.delete(channel.id); else next.add(channel.id); return next; })}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span><span className="channel-name"><strong>{channel.name}</strong>{source && <small className={`channel-connection-name${hint ? ' channel-connection-issue' : ''}`}>{source}</small>}</span>
          {count > 0 && <span className="project-unread-count" aria-hidden="true">{unreadCountLabel(count)}</span>}
        </button>{onChannelOptions && <button type="button" className="channel-options" aria-label={`Options for ${channel.name}`} onClick={() => onChannelOptions(channel.id)}>⋯</button>}<button type="button" className="channel-new-session" aria-label={`New session in ${channel.name}`} title="New session" onClick={() => onNewSession(channel.id)}>✎</button></div>
        {open ? <div id={`branch-${channel.id}`} className="thread-children">
          {page.rows.map((thread) => <ThreadRow key={thread.id} thread={thread} selected={thread.id === snapshot.selectedThreadId} draft={draftThreads?.has(thread.id) ?? false} showLabels={thread.supportsSessionLabels ?? snapshot.supportsSessionLabels === true} onMenu={(thread.supportsSessionLabels ?? snapshot.supportsSessionLabels === true) && onEditLabels ? (thread, x, y) => setMenu({ thread, x, y }) : undefined} />)}
          {!page.rows.length ? <p className="tree-empty">No recent activity</p> : null}
          {page.hasMore ? <button className="tree-more" type="button" onClick={() => setBatches((old) => ({ ...old, [channel.id]: (old[channel.id] ?? 0) + 1 }))}>Show more</button> : null}

        </div> : null}
      </section>;
    })}
    {!snapshot.channels.length && !snapshot.loadingConversations ? <p className="empty-state">No channels yet.</p> : null}
    {filtering && !available.some(thread => matchesLabels(thread.markers, filter)) && <p className="empty-state">No matching sessions.</p>}
    {menu && <div className="session-context-menu" role="menu" aria-label="Session options" style={{ left: Math.max(0, Math.min(menu.x, window.innerWidth - 180)), top: Math.max(0, Math.min(menu.y, window.innerHeight - 60)) }}><button autoFocus type="button" role="menuitem" disabled={(snapshot.connections ? snapshot.connections.find(row => row.connectionKey === snapshot.channels.find(c => c.id === menu.thread.channelId)?.connectionKey)?.state : snapshot.connectionState) !== 'online' || !available.some(thread => thread.id === menu.thread.id)} onClick={() => { const thread = available.find(thread => thread.id === menu.thread.id); if (thread) onEditLabels?.(thread); setMenu(null); }}>Edit labels</button></div>}
  </div>;
}, (before,after) => before.draftThreads === after.draftThreads && before.onNewSession === after.onNewSession && before.onEditLabels === after.onEditLabels && before.snapshot.channels === after.snapshot.channels && before.snapshot.threads === after.snapshot.threads && before.snapshot.selectedChannelId === after.snapshot.selectedChannelId && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.loadingConversations === after.snapshot.loadingConversations && before.snapshot.connectionKey === after.snapshot.connectionKey && before.snapshot.supportsSessionLabels === after.snapshot.supportsSessionLabels && before.snapshot.connectionState === after.snapshot.connectionState && connectionStates(before.snapshot) === connectionStates(after.snapshot));
