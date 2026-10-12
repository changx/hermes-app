/**
 * Recents membership, shared by the desktop sidebar and the mobile Recents tab.
 *
 * A Thread is in Recents when it had activity in the trailing 72 hours (or is
 * running) AND the user owns it: the user started it, or the user sent at
 * least one message in it. Threads that an automation started stay out of
 * Recents until the user replies in them. A server that sends no origin is
 * older than automation origins; all of its Threads count as the user's.
 */
export const RECENT_WINDOW_SECONDS = 72 * 60 * 60;

export type RecentCandidate = Readonly<{
  origin?: 'user' | 'automation';
  participated?: boolean;
  running?: boolean;
  lastMessageAt?: number;
}>;

export const ownedByUser = (thread: RecentCandidate): boolean =>
  thread.origin !== 'automation' || thread.participated === true;

export const inRecents = (thread: RecentCandidate, nowSeconds: number): boolean =>
  ownedByUser(thread) && (thread.running === true ||
    (thread.lastMessageAt !== undefined && thread.lastMessageAt >= nowSeconds - RECENT_WINDOW_SECONDS));
