import type { Message } from '../../../packages/client/src/index';
import type { SendRecord } from './send';

export interface TimelineRow { key: string; role: string; text: string; refSeq?: number; optimistic?: boolean; status?: SendRecord['status']; attachments?: Message['attachments'] }

// A receipt proves acceptance of a send, NOT which core row will be published.
// The wire does not expose receipt_id/client_message_id on plain history rows.
// Never associate two rows by equal text, time, or adjacent ref numbers.
export function projectTimeline(messages: readonly Message[], record: SendRecord | null, threadId: string, draft?: string): TimelineRow[] {
  const rows: TimelineRow[] = messages.map(m => ({ key: `ref:${m.ref_seq}`, role: m.role, text: m.text, refSeq: m.ref_seq, attachments: m.attachments }));
  if (record?.threadId === threadId && (record.status === 'sending' || record.status === 'ambiguous')) {
    rows.push({ key: `local:${record.clientMessageId}`, role: 'user', text: record.text, optimistic: true, status: record.status });
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
