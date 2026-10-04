import type { DesktopThread } from "../shared/desktop-api";
import { emptyLabelFilter, labelFilterActive, matchesLabels, type LabelFilter } from '../../../../packages/client/src/sessionLabels';

export const THREAD_BATCH = 24;
const DAY = 24 * 60 * 60;

export const orderedThreads = (threads: readonly DesktopThread[], channelId?: string): DesktopThread[] =>
  threads.filter((thread) => !channelId || thread.channelId === channelId)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

export const threadWindow = (threads: readonly DesktopThread[], channelId: string, now: number, olderBatches = 0, filter: LabelFilter = emptyLabelFilter()) => {
  const ordered = orderedThreads(threads.filter(thread => matchesLabels(thread.markers, filter)), channelId);
  const recentCount = ordered.filter((thread) => thread.lastMessageAt !== undefined && thread.lastMessageAt >= now / 1000 - DAY).length;
  const initialCount = Math.min(THREAD_BATCH, labelFilterActive(filter) ? ordered.length : recentCount);
  const count = initialCount + Math.max(0, olderBatches) * THREAD_BATCH;
  return { rows: ordered.slice(0, count), hasMore: ordered.length > count };
};
