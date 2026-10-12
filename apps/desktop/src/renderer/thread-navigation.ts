import type { DesktopThread } from "../shared/desktop-api";
import { inRecents } from '../../../../packages/client/src/recents';
import { runningFirst, todoSessions } from '../../../../packages/client/src/todo';
import { emptyLabelFilter, labelFilterActive, matchesLabels, type LabelFilter } from '../../../../packages/client/src/sessionLabels';

export const THREAD_BATCH = 24;
const DAY = 24 * 60 * 60;

export const orderedThreads = (threads: readonly DesktopThread[], channelId?: string): DesktopThread[] =>
  threads.filter((thread) => !channelId || thread.channelId === channelId)
    .sort(runningFirst);

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

/**
 * Sidebar Recents: Sessions from every Project and connection with activity in
 * the trailing 72 hours, plus running Sessions, that the user owns (see
 * packages/client/src/recents.ts). Running first, then newest activity.
 */
export const recentWindow = (threads: readonly DesktopThread[], now: number, batches = 0) => {
  const rows = threads.filter(thread => inRecents(thread, now / 1000)).sort(runningFirst);
  const count = (Math.max(0, batches) + 1) * THREAD_BATCH;
  return { rows: rows.slice(0, count), hasMore: rows.length > count };
};

/** Sidebar Todo: every flagged Session of any age, running first, then newest activity. */
export const todoWindow = (threads: readonly DesktopThread[], batches = 0) => {
  const rows = todoSessions(threads), count = (Math.max(0, batches) + 1) * THREAD_BATCH;
  return { rows: rows.slice(0, count), hasMore: rows.length > count };
};
