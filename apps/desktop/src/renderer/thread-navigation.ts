import type { DesktopThread } from "../shared/desktop-api";
import { emptyLabelFilter, labelFilterActive, matchesLabels, type LabelFilter } from '../../../../packages/client/src/sessionLabels';

export const THREAD_BATCH = 24;
const DAY = 24 * 60 * 60;

export const orderedThreads = (threads: readonly DesktopThread[], channelId?: string): DesktopThread[] =>
  threads.filter((thread) => !channelId || thread.channelId === channelId)
    .sort((a, b) => Number(b.running === true) - Number(a.running === true) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

// Running sessions and sessions with an unread result are always in the
// initial window, so a Project count never points at hidden rows.
const pinned = (thread: DesktopThread) => thread.running === true || thread.completedUnread === true;

export const threadWindow = (threads: readonly DesktopThread[], channelId: string, now: number, olderBatches = 0, filter: LabelFilter = emptyLabelFilter()) => {
  const ordered = orderedThreads(threads.filter(thread => matchesLabels(thread.markers, filter)), channelId);
  const others = ordered.filter(thread => !pinned(thread));
  const recentCount = others.filter(thread => thread.lastMessageAt !== undefined && thread.lastMessageAt >= now / 1000 - DAY).length;
  const count = Math.min(THREAD_BATCH, labelFilterActive(filter) ? others.length : recentCount) + Math.max(0, olderBatches) * THREAD_BATCH;
  const shown = new Set(others.slice(0, count));
  return { rows: ordered.filter(thread => pinned(thread) || shown.has(thread)), hasMore: others.length > count };
};
