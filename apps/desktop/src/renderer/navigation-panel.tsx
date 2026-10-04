import { memo, useEffect, useState } from "react";
import type { DesktopSnapshot, DesktopThread } from "../shared/desktop-api";
import { threadWindow } from "./thread-navigation";
import { emptyLabelFilter, labelFilterActive, matchesLabels } from '../../../../packages/client/src/sessionLabels';
import { LabelPills, LabelsFilter } from './session-labels';

const ThreadRow = memo(({thread,selected,draft,onMenu,showLabels}: {thread:DesktopThread;selected:boolean;draft:boolean;showLabels?:boolean;onMenu?:(thread:DesktopThread,x:number,y:number)=>void}) => <button type="button" className={`tree-thread${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => void window.hermesDesktop.selectThread(thread.id).catch(() => {})}
  onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(thread, event.clientX, event.clientY); } : undefined}
  onKeyDown={onMenu ? event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); onMenu(thread, box.left, box.bottom); } } : undefined}>
  <span className="thread-row-main">
  <span className="thread-title">{thread.title}</span>{draft ? <span className="thread-draft" aria-label="Draft">draft</span> : null}{thread.running ? <span className="thread-status">Running</span> : null}{thread.completedUnread ? <span className="thread-result-unread" role="img" aria-label="Completed, unread" /> : null}
  </span>{showLabels && <LabelPills markers={thread.markers} />}
</button>);

export const NavigationPanel = memo(({ snapshot, onNewSession, draftThreads, onEditLabels }: { snapshot: DesktopSnapshot; onNewSession: (channelId: string) => void; draftThreads?: ReadonlySet<string>; onEditLabels?: (thread: DesktopThread) => void }) => {
  const [expanded, setExpanded] = useState(() => new Set(snapshot.selectedChannelId ? [snapshot.selectedChannelId] : []));
  const [batches, setBatches] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState(emptyLabelFilter);
  const [menu, setMenu] = useState<{ thread: DesktopThread; x: number; y: number } | null>(null);
  const filtering = snapshot.supportsSessionLabels === true && labelFilterActive(filter);
  const available = snapshot.threads.filter(thread => snapshot.channels.some(channel => channel.id === thread.channelId));
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
    {snapshot.supportsSessionLabels === true && <LabelsFilter rows={available} value={filter} onChange={value => { setFilter(value); setBatches({}); }} />}
    <p className="tree-caption">{filtering ? 'Matching sessions · All time' : 'Active in the last 24 hours'}</p>
    {snapshot.channels.map((channel) => {
      const open = filtering || expanded.has(channel.id);
      const page = threadWindow(available, channel.id, now, batches[channel.id] ?? 0, filtering ? filter : emptyLabelFilter());
      if (filtering && !page.rows.length) return null;
      return <section className="channel-branch" key={channel.id}>
        <div className="channel-toolbar"><button type="button" className={`channel-toggle${channel.id === snapshot.selectedChannelId ? " current-channel" : ""}`} aria-expanded={open} aria-controls={`branch-${channel.id}`} onClick={() => setExpanded((old) => { const next = new Set(old); if (open) next.delete(channel.id); else next.add(channel.id); return next; })}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span><strong>{channel.name}</strong>
        </button><button type="button" className="channel-new-session" aria-label={`New session in ${channel.name}`} title="New session" onClick={() => onNewSession(channel.id)}>＋</button></div>
        {open ? <div id={`branch-${channel.id}`} className="thread-children">
          {page.rows.map((thread) => <ThreadRow key={thread.id} thread={thread} selected={thread.id === snapshot.selectedThreadId} draft={draftThreads?.has(thread.id) ?? false} showLabels={snapshot.supportsSessionLabels === true} onMenu={snapshot.supportsSessionLabels === true && onEditLabels ? (thread, x, y) => setMenu({ thread, x, y }) : undefined} />)}
          {!page.rows.length ? <p className="tree-empty">No recent activity</p> : null}
          {page.hasMore ? <button className="tree-more" type="button" onClick={() => setBatches((old) => ({ ...old, [channel.id]: (old[channel.id] ?? 0) + 1 }))}>Load more threads</button> : null}

        </div> : null}
      </section>;
    })}
    {!snapshot.channels.length && !snapshot.loadingConversations ? <p className="empty-state">No channels yet.</p> : null}
    {filtering && !available.some(thread => matchesLabels(thread.markers, filter)) && <p className="empty-state">No matching sessions.</p>}
    {menu && <div className="session-context-menu" role="menu" aria-label="Session options" style={{ left: Math.max(0, Math.min(menu.x, window.innerWidth - 180)), top: Math.max(0, Math.min(menu.y, window.innerHeight - 60)) }}><button autoFocus type="button" role="menuitem" disabled={snapshot.connectionState !== 'online' || !available.some(thread => thread.id === menu.thread.id)} onClick={() => { const thread = available.find(thread => thread.id === menu.thread.id); if (thread) onEditLabels?.(thread); setMenu(null); }}>Edit labels</button></div>}
  </div>;
}, (before,after) => before.draftThreads === after.draftThreads && before.onNewSession === after.onNewSession && before.onEditLabels === after.onEditLabels && before.snapshot.channels === after.snapshot.channels && before.snapshot.threads === after.snapshot.threads && before.snapshot.selectedChannelId === after.snapshot.selectedChannelId && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.loadingConversations === after.snapshot.loadingConversations && before.snapshot.connectionKey === after.snapshot.connectionKey && before.snapshot.supportsSessionLabels === after.snapshot.supportsSessionLabels && before.snapshot.connectionState === after.snapshot.connectionState);
