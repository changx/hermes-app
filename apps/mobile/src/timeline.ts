import type { Message } from '../../../packages/client/src/index';
import type { SendRecord } from './send';

export interface TimelineRow { key: string; role: string; text: string; refSeq?: number; optimistic?: boolean; status?: SendRecord['status']; receiptState?: SendRecord['receiptState']; attachments?: Message['attachments'] }

// Only explicit server identity can reconcile a send; never match equal text.
// Legacy servers have no such identity and retain the conservative fallback.
export function projectTimeline(messages: readonly Message[], record: SendRecord | null, threadId: string, draft?: string, supportsIdentity = false, pending: readonly SendRecord[] = []): TimelineRow[] {
  const rows: TimelineRow[] = messages.map(m => ({ key: m.role === 'user' && m.client_message_id ? `local:${m.client_message_id}` : `ref:${m.ref_seq}`, role: m.role, text: m.text, refSeq: m.ref_seq, attachments: m.attachments }));
  const published = new Set(messages.filter(m => m.role === 'user').map(m => m.client_message_id).filter(Boolean));
  const local = new Map(pending.map(r => [r.clientMessageId, r]));
  if (record) local.set(record.clientMessageId, record);
  for (const item of local.values()) {
    if (item.threadId !== threadId || published.has(item.clientMessageId)) continue;
    if (item.status === 'accepted' && (!supportsIdentity || item.receiptState === 'completed')) continue;
    rows.push({ key: `local:${item.clientMessageId}`, role: 'user', text: item.text, optimistic: true, status: item.status, receiptState: item.receiptState });
  }
  // Only actual ephemeral client state can supply a draft. Durable events are
  // invalidations, not token frames; do not simulate a streaming response.
  if (draft) rows.push({ key: `draft:${threadId}`, role: 'assistant', text: draft });
  return rows;
}

export function windowStart(messages: readonly Message[], startRef: number | null, count = 30): number {
  if (!messages.length) return 0;
  if (startRef !== null) {
    const index = messages.findIndex(m => m.ref_seq === startRef);
    if (index >= 0) return index;
  }
  return Math.max(0, messages.length - count);
}

export function olderStart(messages: readonly Message[], startRef: number | null, count = 30): number | null {
  const index = windowStart(messages, startRef);
  return messages[Math.max(0, index - count)]?.ref_seq ?? null;
}

export interface TimelinePosition { offset: number; following: boolean; startRef: number | null }
export const nearLatest = (offset: number, contentHeight: number, viewportHeight: number): boolean =>
  contentHeight - viewportHeight - offset <= 80;

export function followAfterUserScroll(previous: number, next: number, height: number, viewport: number): boolean {
  return next >= previous && nearLatest(next, height, viewport);
}

// Keyboard resizing can generate scroll events without a reader gesture moving
// away from the bottom. Keep the current mode until geometry settles.
export function followDuringDrag(following: boolean, previous: number, next: number, previousHeight: number, height: number, previousViewport: number, viewport: number): boolean {
  if (previousHeight !== height || previousViewport !== viewport) return following;
  return followAfterUserScroll(previous, next, height, viewport);
}

export function appendedAtEnd(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length > 0 && next.length > previous.length && previous.every((key, index) => next[index] === key);
}

// Forward-only API: never fetch until exhaustion without a fixed bound.
// The caller must explicitly request each additional page after this budget.
export async function locateLatest(
  fetchPage: (cursor?: string) => Promise<{ next_cursor: string | null }>,
  pageBudget = 3,
  stillCurrent: () => boolean = () => true
): Promise<string | null> {
  let cursor: string | null = null;
  for (let index = 0; index < pageBudget; index++) {
    const page = await fetchPage(cursor ?? undefined);
    if (!stillCurrent()) return cursor;
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return cursor;
}
