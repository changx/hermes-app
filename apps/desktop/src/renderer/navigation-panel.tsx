import { memo, useEffect, useState } from "react";
import type { DesktopSnapshot, DesktopThread } from "../shared/desktop-api";
import { threadWindow } from "./thread-navigation";

const ThreadRow = memo(({thread,selected,draft}: {thread:DesktopThread;selected:boolean;draft:boolean}) => <button type="button" className={`tree-thread${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => void window.hermesDesktop.selectThread(thread.id).catch(() => {})}>
  <span className="thread-title">{thread.title}</span>{draft ? <span className="thread-draft" aria-label="Draft">draft</span> : null}{thread.running ? <span className="thread-status">Running</span> : null}{thread.completedUnread ? <span className="thread-result-unread" role="img" aria-label="Completed, unread" /> : null}
</button>);

export const NavigationPanel = memo(({ snapshot, onNewSession, draftThreads }: { snapshot: DesktopSnapshot; onNewSession: (channelId: string) => void; draftThreads?: ReadonlySet<string> }) => {
  const [expanded, setExpanded] = useState(() => new Set(snapshot.selectedChannelId ? [snapshot.selectedChannelId] : []));
  const [batches, setBatches] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snapshot.selectedChannelId) setExpanded((old) => new Set([...old, snapshot.selectedChannelId!]));
  }, [snapshot.selectedChannelId]);
  return <div className="item-list channel-tree" aria-label="Channels and threads">
    <p className="tree-caption">Active in the last 24 hours</p>
    {snapshot.channels.map((channel) => {
      const open = expanded.has(channel.id);
      const page = threadWindow(snapshot.threads, channel.id, now, batches[channel.id] ?? 0);
      return <section className="channel-branch" key={channel.id}>
        <div className="channel-toolbar"><button type="button" className={`channel-toggle${channel.id === snapshot.selectedChannelId ? " current-channel" : ""}`} aria-expanded={open} aria-controls={`branch-${channel.id}`} onClick={() => setExpanded((old) => { const next = new Set(old); if (open) next.delete(channel.id); else next.add(channel.id); return next; })}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span><strong>{channel.name}</strong>
        </button><button type="button" className="channel-new-session" aria-label={`New session in ${channel.name}`} title="New session" onClick={() => onNewSession(channel.id)}>＋</button></div>
        {open ? <div id={`branch-${channel.id}`} className="thread-children">
          {page.rows.map((thread) => <ThreadRow key={thread.id} thread={thread} selected={thread.id === snapshot.selectedThreadId} draft={draftThreads?.has(thread.id) ?? false} />)}
          {!page.rows.length ? <p className="tree-empty">No recent activity</p> : null}
          {page.hasMore ? <button className="tree-more" type="button" onClick={() => setBatches((old) => ({ ...old, [channel.id]: (old[channel.id] ?? 0) + 1 }))}>Load more threads</button> : null}

        </div> : null}
      </section>;
    })}
    {!snapshot.channels.length && !snapshot.loadingConversations ? <p className="empty-state">No channels yet.</p> : null}
  </div>;
}, (before,after) => before.draftThreads === after.draftThreads && before.onNewSession === after.onNewSession && before.snapshot.channels === after.snapshot.channels && before.snapshot.threads === after.snapshot.threads && before.snapshot.selectedChannelId === after.snapshot.selectedChannelId && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.loadingConversations === after.snapshot.loadingConversations);
