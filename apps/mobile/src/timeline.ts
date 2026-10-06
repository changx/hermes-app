import type { Interaction, Message, Receipt } from '../../../packages/client/src/index';
import type { SendRecord } from './send';
import { validTimestampSeconds } from './messageTime.ts';

export interface Reaction { emoji: string; label: string; source: 'agent' }
export interface TimelineRow { key: string; role: string; text: string; displayKind?: Message['display_kind']; timestamp?: number; toolCalls?: Message['tool_calls']; continuation?: boolean; refSeq?: number; optimistic?: boolean; status?: SendRecord['status']; attachments?: Message['attachments']; reactionSlot?: boolean; reaction?: Reaction; feedback?: string; sendError?: string; receipt?: Receipt }

const agentState: Record<NonNullable<Receipt['processing']>, Reaction | undefined> = {
  running: { emoji: '👀', label: 'Working', source: 'agent' },
  completed: { emoji: '✅', label: 'Completed', source: 'agent' },
  failed: { emoji: '❌', label: 'Failed', source: 'agent' },
  interrupted: undefined,
  unknown: { emoji: '⚠️', label: 'Outcome unknown', source: 'agent' }
};
const terminal = (state: Receipt['state']) => !['queued', 'running'].includes(state);
const matching = (receipt: Receipt | undefined, threadId: string, receiptId: string, clientMessageId: string): receipt is Receipt =>
  !!receipt && receipt.id === receiptId && receipt.thread_id === threadId && receipt.client_message_id === clientMessageId;
const localReceipt = (item: SendRecord | undefined): Receipt | undefined => item?.status === 'accepted' && item.receiptId && item.receiptState ? {
  id: item.receiptId, thread_id: item.threadId, client_message_id: item.clientMessageId, state: item.receiptState, durable: true,
  ...(item.receiptRefSeq !== undefined ? { ref_seq: item.receiptRefSeq } : {}),
  ...(item.receiptAdmission ? { admission: item.receiptAdmission } : {}), ...(item.receiptHandedOff ? { handed_off: item.receiptHandedOff } : {}),
  ...(item.receiptProcessing !== undefined ? { processing: item.receiptProcessing } : {}), ...(item.receiptFeedback ? { feedback: item.receiptFeedback } : {})
} : undefined;
const displayReceipt = (candidate: Receipt | undefined, fallback: Receipt | undefined): Receipt | undefined =>
  candidate && fallback ? { ...candidate, ...(candidate.processing === undefined && fallback.processing !== undefined ? { processing: fallback.processing } : {}),
    ...(candidate.feedback === undefined && fallback.feedback ? { feedback: fallback.feedback } : {}) } : candidate ?? fallback;

function statusFor(receipt: Receipt | undefined, interactions: readonly Interaction[]): Reaction | undefined {
  if (!receipt) return undefined;
  if (!terminal(receipt.state) && !['completed', 'failed', 'interrupted'].includes(receipt.processing ?? '')) {
    const pending = interactions.find(i => i.state === 'pending' && i.thread_id === receipt.thread_id && i.receipt_id === receipt.id);
    if (pending) return { emoji: '⚠️', label: pending.kind === 'approval' ? 'Awaiting approval' : 'Awaiting your answer', source: 'agent' };
  }
  // Processing callbacks remain authoritative when they exist. Native busy
  // follow-ups do not receive those callbacks, so their received state means
  // Hermes accepted the handoff, not that the whole model run completed.
  if (receipt.processing != null) return agentState[receipt.processing];
  if (receipt.admission === 'followup' && (receipt.state === 'received' || receipt.state === 'completed')) {
    return { emoji: '✅', label: 'Handled', source: 'agent' };
  }
  return undefined;
}

// Only explicit server identity can reconcile a send; never match equal text.
// Legacy servers have no such identity and retain the conservative fallback.
export function projectTimeline(messages: readonly Message[], record: SendRecord | null, threadId: string, draft?: string, supportsIdentity = false, pending: readonly SendRecord[] = [], receipts: ReadonlyMap<string, Receipt> = new Map(), interactions: readonly Interaction[] = [], knownMessages: readonly Message[] = messages): TimelineRow[] {
  const local = new Map(pending.map(r => [r.clientMessageId, r]));
  if (record) local.set(record.clientMessageId, record);
  const rows: TimelineRow[] = messages.map((m, index) => {
    const known = m.role === 'user' && !!m.receipt_id && !!m.client_message_id;
    const candidate = known ? receipts.get(m.receipt_id!) : undefined;
    const valid = known && (!candidate || matching(candidate, threadId, m.receipt_id!, m.client_message_id!));
    const candidateLocal = m.role === 'user' && m.client_message_id ? local.get(m.client_message_id) : undefined;
    const item = candidateLocal?.threadId === threadId ? candidateLocal : undefined;
    const fallback = item?.receiptId === m.receipt_id && item?.threadId === threadId ? localReceipt(item) : undefined;
    const receipt = valid ? displayReceipt(candidate, fallback) : undefined;
    // Cache hydration cannot change a published row's identity or its position.
    const serverTime = m.created_at;
    const timestamp = validTimestampSeconds(serverTime) ? serverTime : item?.createdAt;
    return { key: m.role === 'user' && m.client_message_id ? `local:${m.client_message_id}` : `ref:${m.ref_seq}`, role: m.role, text: m.text, refSeq: m.ref_seq, attachments: m.attachments,
      ...(m.display_kind ? { displayKind: m.display_kind } : {}),
      ...(validTimestampSeconds(timestamp) ? { timestamp } : {}),
      ...(m.role === 'assistant' ? { toolCalls: m.tool_calls, continuation: !m.display_kind && index > 0 && messages[index - 1].role === 'assistant' && !messages[index - 1].display_kind } : {}),
      ...(m.role === 'user' && !!m.client_message_id ? { reactionSlot: true } : {}),
      ...(valid ? { reaction: statusFor(receipt, interactions), ...(receipt?.feedback ? { feedback: receipt.feedback } : {}), ...(receipt ? { receipt } : {}) } : {}) };
  });
  for (const item of local.values()) {
    if (item.threadId !== threadId || knownMessages.some(m => m.role === 'user' && m.client_message_id === item.clientMessageId)) continue;
    if (item.status === 'accepted' && (!supportsIdentity || !item.receiptId)) continue;
    const candidate = item.receiptId ? receipts.get(item.receiptId) : undefined;
    const valid = !!item.receiptId && (!candidate || matching(candidate, threadId, item.receiptId, item.clientMessageId));
    const receipt = valid ? displayReceipt(candidate, localReceipt(item)) : undefined;
    const refSeq = receipt?.ref_seq ?? (valid ? item.receiptRefSeq : undefined);
    // An accepted input has a server-owned position, irrespective of outcome.
    // Old local records await exact receipt/history hydration, never a tail slot.
    if (item.status === 'accepted' && (refSeq === undefined || messages.length > 0 && refSeq < messages[0].ref_seq)) continue;
    rows.push({ key: `local:${item.clientMessageId}`, role: 'user', text: item.text, attachments: item.attachments, optimistic: true, status: item.status, reactionSlot: true,
      ...(refSeq !== undefined ? { refSeq } : {}),
      ...(validTimestampSeconds(item.createdAt) ? { timestamp: item.createdAt } : {}),
      ...(item.status === 'accepted' ? valid ? { reaction: statusFor(receipt, interactions), ...(receipt?.feedback ? { feedback: receipt.feedback } : {}), ...(receipt ? { receipt } : {}) } : {} : item.status === 'blocked' ? { sendError: 'Not sent. Check your message or contact your administrator.' } : {}) });
  }
  rows.sort((a, b) => (a.refSeq ?? Infinity) - (b.refSeq ?? Infinity));
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].continuation && rows[i - 1]?.role !== 'assistant') rows[i].continuation = false;
  }
  // Only actual ephemeral client state can supply a draft. Durable events are
  // invalidations, not token frames; do not simulate a streaming response.
  if (draft) rows.push({ key: `draft:${threadId}`, role: 'assistant', text: draft });
  return rows;
}

export interface TimelinePosition { offset: number; following: boolean; startRef: number | null }
export const nearLatest = (offset: number, contentHeight: number, viewportHeight: number, inset = 0): boolean =>
  latestOffset(contentHeight, viewportHeight, inset) - offset <= 80;

// A bottom overscroll and its rebound are still at the end. Only a real drag
// beyond the threshold leaves follow mode; a swipe back down can rejoin it.
export function followAfterUserScroll(previous: number, next: number, height: number, viewport: number, following = true, inset = 0): boolean {
  // UIKit's bottom bounce can return from beyond the maximum offset without
  // being an upward reading gesture. Once inside the content, any upward drag
  // intentionally releases follow (even before crossing the 80pt threshold).
  if (next === previous) return following;
  if (next < previous && previous > latestOffset(height, viewport, inset) && next >= latestOffset(height, viewport, inset)) return following;
  return next > previous && nearLatest(next, height, viewport, inset);
}

// Programmatic scroll/momentum and keyboard/viewport corrections are not reader gestures.
export function followDuringDrag(following: boolean, previous: number, next: number, previousHeight: number, height: number, previousViewport: number, viewport: number, fromGesture = true, previousInset = 0, inset = 0): boolean {
  if (!fromGesture || previousHeight !== height || previousViewport !== viewport || previousInset !== inset) return following;
  return followAfterUserScroll(previous, next, height, viewport, following, inset);
}

export interface ScrollGeometry { height: number; viewport: number; inset: number }

// The same event adapter used by ChatTimeline.onScroll. On Android the controller's
// synthetic inset is absent from native onScroll, so retain its reported value.
export function scrollStateFromEvent(
  following: boolean, previousOffset: number, previousGeometry: ScrollGeometry | null,
  event: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number }; contentInset?: { bottom?: number } },
  fromGesture: boolean, reportedInset = 0
): { offset: number; geometry: ScrollGeometry; following: boolean } {
  const offset = Math.max(0, event.contentOffset.y);
  const geometry = { height: event.contentSize.height, viewport: event.layoutMeasurement.height, inset: event.contentInset?.bottom ?? reportedInset };
  return { offset, geometry, following: previousGeometry
    ? followDuringDrag(following, previousOffset, offset, previousGeometry.height, geometry.height, previousGeometry.viewport, geometry.viewport, fromGesture, previousGeometry.inset, geometry.inset)
    : following };
}

export const latestOffset = (contentHeight: number, viewportHeight: number, inset = 0): number =>
  Math.max(0, contentHeight + inset - viewportHeight);

export const shouldFollowContentChange = (following: boolean, dragging: boolean, previous: number, next: number): boolean =>
  following && !dragging && next > 0 && previous !== next;

export function appendedAtEnd(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length > 0 && next.length > previous.length && previous.every((key, index) => next[index] === key);
}

// A latest-page window can slide while keeping the same length. Compare the
// actual public Agent output, not array length or a new projection's identity.
export function agentOutputAdded(previous: readonly TimelineRow[], next: readonly TimelineRow[]): boolean {
  const oldTail = previous[previous.length - 1];
  const tail = next[next.length - 1];
  if (!oldTail || !tail || tail.role !== 'assistant') return false;
  if (oldTail.key !== tail.key) {
    // A prepend, history replacement or switching to an older window is not
    // new output; a genuine append retains the former tail before the new one.
    return next.slice(0, -1).some(row => row.key === oldTail.key);
  }
  if (oldTail.text !== tail.text) return true;
  const before = oldTail.toolCalls ?? [];
  const after = tail.toolCalls ?? [];
  return before.length !== after.length || after.some((call, index) =>
    call.id !== before[index].id || call.name !== before[index].name ||
    call.label !== before[index].label || call.detail !== before[index].detail);
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
