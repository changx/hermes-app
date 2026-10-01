import { useEffect, useState } from "react";
import type { DesktopSnapshot } from "../shared/desktop-api";
import { threadWindow } from "./thread-navigation";

export const NavigationPanel = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
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
        <button type="button" className={`channel-toggle${channel.id === snapshot.selectedChannelId ? " current-channel" : ""}`} aria-expanded={open} aria-controls={`branch-${channel.id}`} onClick={() => setExpanded((old) => { const next = new Set(old); if (open) next.delete(channel.id); else next.add(channel.id); return next; })}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span><strong>{channel.name}</strong>
        </button>
        {open ? <div id={`branch-${channel.id}`} className="thread-children">
          {page.rows.map((thread) => <button type="button" key={thread.id} className={`tree-thread${thread.id === snapshot.selectedThreadId ? " selected" : ""}`} aria-current={thread.id === snapshot.selectedThreadId ? "page" : undefined} onClick={() => void window.hermesDesktop.selectThread(thread.id).catch(() => {})}>
            <span className="thread-title">{thread.title}</span>{thread.running ? <span className="thread-status">Running</span> : thread.unreadCount ? <span className="unread-count">{thread.unreadCount}</span> : null}
          </button>)}
          {!page.rows.length ? <p className="tree-empty">No recent activity</p> : null}
          {page.hasMore ? <button className="tree-more" type="button" onClick={() => setBatches((old) => ({ ...old, [channel.id]: (old[channel.id] ?? 0) + 1 }))}>Load more threads</button> : null}
          <button className="tree-new" type="button" onClick={() => void window.hermesDesktop.selectChannel(channel.id).catch(() => {})}>Select channel</button>
        </div> : null}
      </section>;
    })}
    {!snapshot.channels.length ? <p className="empty-state">No channels yet.</p> : null}
  </div>;
};
