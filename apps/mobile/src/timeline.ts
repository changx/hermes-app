import type { Interaction, Message, Receipt } from '../../../packages/client/src/index';
import type { SendRecord } from './send';

export interface Reaction { emoji: string; label: string; source: 'local' | 'agent' }
export interface TimelineRow { key: string; role: string; text: string; refSeq?: number; optimistic?: boolean; status?: SendRecord['status']; attachments?: Message['attachments']; reaction?: Reaction; receipt?: Receipt }

const agentState: Record<Receipt['state'], Reaction> = {
  queued: { emoji: '⏳', label: '排队中', source: 'agent' },
  running: { emoji: '⚙️', label: '处理中', source: 'agent' },
  completed: { emoji: '✅', label: '已完成', source: 'agent' },
  failed: { emoji: '⚠️', label: '执行失败', source: 'agent' },
  interrupted: { emoji: '⏹', label: '已停止', source: 'agent' },
  unknown: { emoji: '⚠️', label: '结果待确认', source: 'agent' }
};
const localState: Record<Exclude<SendRecord['status'], 'accepted'>, Reaction> = {
  queued: { emoji: '📱', label: '本机待发', source: 'local' },
  sending: { emoji: '📱', label: '提交中', source: 'local' },
  ambiguous: { emoji: '📱', label: '接收待核对', source: 'local' },
  blocked: { emoji: '📱', label: '发送受阻', source: 'local' }
};
const received: Reaction = { emoji: '👀', label: '已接收', source: 'agent' };
const terminal = (state: Receipt['state']) => !['queued', 'running'].includes(state);
const matching = (receipt: Receipt | undefined, threadId: string, receiptId: string, clientMessageId: string): receipt is Receipt =>
  !!receipt && receipt.id === receiptId && receipt.thread_id === threadId && receipt.client_message_id === clientMessageId;

function statusFor(receipt: Receipt | undefined, interactions: readonly Interaction[]): Reaction {
  if (!receipt) return received;
  if (!terminal(receipt.state)) {
    const pending = interactions.find(i => i.state === 'pending' && i.thread_id === receipt.thread_id && i.receipt_id === receipt.id);
    if (pending) return { emoji: '⚠️', label: pending.kind === 'approval' ? '等待审批' : '等待回答', source: 'agent' };
  }
  return agentState[receipt.state];
}

// Only explicit server identity can reconcile a send; never match equal text.
// Legacy servers have no such identity and retain the conservative fallback.
export function projectTimeline(messages: readonly Message[], record: SendRecord | null, threadId: string, draft?: string, supportsIdentity = false, pending: readonly SendRecord[] = [], receipts: ReadonlyMap<string, Receipt> = new Map(), interactions: readonly Interaction[] = []): TimelineRow[] {
  const rows: TimelineRow[] = messages.map(m => {
    const known = m.role === 'user' && !!m.receipt_id && !!m.client_message_id;
    const candidate = known ? receipts.get(m.receipt_id!) : undefined;
    const valid = known && (!candidate || matching(candidate, threadId, m.receipt_id!, m.client_message_id!));
    return { key: known && valid ? `local:${m.client_message_id}` : `ref:${m.ref_seq}`, role: m.role, text: m.text, refSeq: m.ref_seq, attachments: m.attachments,
      ...(valid ? { reaction: statusFor(candidate, interactions), ...(candidate ? { receipt: candidate } : {}) } : {}) };
  });
  const local = new Map(pending.map(r => [r.clientMessageId, r]));
  if (record) local.set(record.clientMessageId, record);
  for (const item of local.values()) {
    if (item.threadId !== threadId || messages.some(m => m.role === 'user' && m.client_message_id === item.clientMessageId &&
      !!m.receipt_id && (!item.receiptId || item.receiptId === m.receipt_id) &&
      (!receipts.has(m.receipt_id) || matching(receipts.get(m.receipt_id), threadId, m.receipt_id, item.clientMessageId)))) continue;
    if (item.status === 'accepted' && (!supportsIdentity || item.receiptState === 'completed')) continue;
    const candidate = item.receiptId ? receipts.get(item.receiptId) : undefined;
    const valid = item.receiptId && (!candidate || matching(candidate, threadId, item.receiptId, item.clientMessageId));
    const fallback = item.status === 'accepted' && item.receiptId && item.receiptState ? { id: item.receiptId, thread_id: item.threadId, client_message_id: item.clientMessageId, state: item.receiptState, durable: true as const } : undefined;
    const receipt = valid ? candidate ?? fallback : undefined;
    rows.push({ key: `local:${item.clientMessageId}`, role: 'user', text: item.text, optimistic: true, status: item.status,
      ...(item.status === 'accepted' ? valid ? { reaction: statusFor(receipt, interactions), ...(receipt ? { receipt } : {}) } : {} : { reaction: localState[item.status] }) });
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
