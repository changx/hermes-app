/**
 * Side chats (docs/side-chat.md): a sub-discussion that starts at one message of a
 * source Thread. The server marks each side chat with `side_of`; clients derive
 * the anchor marks, the sidebar tree and the Session options list from it.
 */

/** The source Thread and the anchor message of a side chat. */
export type SideOf = Readonly<{ thread_id: string; anchor_ref_seq: number }>;

/** Strict `side_of` parser; `undefined` when the field is absent. Throws on a malformed value. */
export function parseSideOf(value: unknown): SideOf | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid side_of');
  const { thread_id, anchor_ref_seq } = value as Record<string, unknown>;
  if (typeof thread_id !== 'string' || !thread_id || thread_id.length > 200
    || typeof anchor_ref_seq !== 'number' || !Number.isSafeInteger(anchor_ref_seq) || anchor_ref_seq <= 0) throw new Error('invalid side_of');
  return { thread_id, anchor_ref_seq };
}

/** Sidebar rule, the same as Recents: every running side chat plus the newest others, this many per batch. */
export const SIDE_BATCH = 10;

type SideRow = Readonly<{ id: string; title: string; running?: boolean; lastMessageAt?: number }>;
/** The Session list order (`todo.ts` runningFirst): running first, then newest activity. No imports: tests load this file directly. */
const runningFirst = (a: SideRow, b: SideRow): number =>
  Number(b.running === true) - Number(a.running === true) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/** Side chats grouped by source Thread, each list running first, then newest activity. */
export function sideChatsBySource<T extends SideRow>(threads: readonly T[], sourceOf: (thread: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const thread of threads) {
    const source = sourceOf(thread);
    if (!source || source === thread.id) continue;
    const list = groups.get(source);
    if (list) list.push(thread); else groups.set(source, [thread]);
  }
  for (const list of groups.values()) list.sort(runningFirst);
  return groups;
}

/** The rows a source Thread shows: all running side chats, then (batches + 1) × SIDE_BATCH others. */
export function sideWindow<T extends SideRow>(sides: readonly T[], batches = 0): { rows: T[]; hasMore: boolean } {
  const ordered = [...sides].sort(runningFirst);
  const running = ordered.filter(thread => thread.running === true), others = ordered.filter(thread => thread.running !== true);
  const count = (Math.max(0, batches) + 1) * SIDE_BATCH;
  return { rows: [...running, ...others.slice(0, count)], hasMore: others.length > count };
}

/** Side chats of one source Thread by anchor message, each list running first, then newest activity. */
export function sideChatsByAnchor<T extends SideRow>(sides: readonly T[], anchorOf: (thread: T) => number | undefined): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const thread of sides) {
    const anchor = anchorOf(thread);
    if (anchor === undefined) continue;
    const list = groups.get(anchor);
    if (list) list.push(thread); else groups.set(anchor, [thread]);
  }
  for (const list of groups.values()) list.sort(runningFirst);
  return groups;
}

/** Anchor mark text: "Side chat", or "Side chat · N" for several. */
export const sideMarkLabel = (count: number): string => count === 1 ? 'Side chat' : `Side chat · ${count}`;

/**
 * "Send to main" composer text: a link back to the side chat, then the reply.
 * The link uses the short form; the App adds the connection's server.
 * The text never starts with `>>` (a tg-userbot direct send).
 */
export function sendToMainText(title: string, threadId: string, reply: string): string {
  const label = title.replace(/[\r\n]+/g, ' ').replace(/[[\]\\]/g, match => '\\' + match).trim() || 'Side chat';
  return `From side chat [${label}](hermesapp://session/${threadId}):\n\n${reply.trim()}`;
}

/** Errors of side chat creation, by the server's reason code. */
export type SideFailure = 'busy' | 'unavailable' | 'failed';
export const sideFailure = (code: string | undefined): SideFailure =>
  code === 'busy' ? 'busy' : code === 'anchor_unavailable' || code === 'anchor_not_final' || code === 'side_unavailable' ? 'unavailable' : 'failed';
export const SIDE_FAILURE_TEXT: Readonly<Record<SideFailure, string>> = {
  busy: 'The session stayed busy for 10 minutes. Try again later.',
  unavailable: 'This message cannot start a side chat.',
  failed: 'Could not create the side chat. Try again.',
};
