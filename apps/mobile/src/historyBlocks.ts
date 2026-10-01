import type { Message } from '../../../packages/client/src/index';

export const HISTORY_BLOCK_COUNT = 5;
const FETCH_SIZE = 100;
const MAX_FETCH_PAGES = 20;

// A reading block starts at each visible user message. Follow-ups are separate
// blocks; do not infer model execution ownership or regroup the chronological log.
export function historyBlockStart(messages: readonly Message[], beforeRef: number | null = null, count = HISTORY_BLOCK_COUNT): { startRef: number | null; enough: boolean } {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid history block count');
  const end = beforeRef === null ? messages.length : messages.findIndex(message => message.ref_seq === beforeRef);
  if (end < 0) throw new Error('History reading boundary is unavailable');
  let remaining = count, firstUser: number | null = null;
  for (let index = end - 1; index >= 0; index--) {
    if (messages[index].role !== 'user') continue;
    firstUser = messages[index].ref_seq;
    if (--remaining === 0) return { startRef: firstUser, enough: true };
  }
  // At the true beginning return fewer blocks; retain legacy orphan outputs if
  // no user anchor exists anywhere. Never silently lose an assistant-only log.
  return { startRef: firstUser ?? (end > 0 ? messages[0].ref_seq : beforeRef), enough: false };
}

interface HistorySource {
  messages: ReadonlyMap<string, readonly Message[]>;
  historyWindow(threadId: string, before?: string, limit?: number): Promise<{ older_cursor: string | null }>;
}

// Wire pages remain count-limited. Accumulate enough complete user-started
// blocks in the authoritative cache, then publish ONE visible startRef change.
export async function loadHistoryBlocks(source: HistorySource, threadId: string, beforeRef: number | null, olderCursor: string | null,
  options: { current?: () => boolean; onCursor?: (cursor: string | null) => void; maxPages?: number } = {}): Promise<{ startRef: number | null; olderCursor: string | null } | null> {
  const current = options.current ?? (() => true);
  const maxPages = options.maxPages ?? MAX_FETCH_PAGES;
  let cursor = olderCursor, fetched = 0;
  const seen = new Set<string>();
  while (current()) {
    const window = historyBlockStart(source.messages.get(threadId) ?? [], beforeRef);
    if (window.enough || cursor === null) return { startRef: window.startRef, olderCursor: cursor };
    if (fetched >= maxPages || seen.has(cursor)) throw new Error('History block pagination did not finish');
    seen.add(cursor); fetched++;
    const page = await source.historyWindow(threadId, cursor, FETCH_SIZE);
    if (!current()) return null;
    if (page.older_cursor !== null && seen.has(page.older_cursor)) throw new Error('History cursor did not advance');
    cursor = page.older_cursor;
    // Remember successful progress even if a later request fails: retry starts
    // from the cache/cursor without exposing a half-loaded block to the reader.
    options.onCursor?.(cursor);
  }
  return null;
}
