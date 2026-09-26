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

export interface NativeScrollEnd { scrollToEnd(options: { animated: boolean }): void }
export interface ExactScrollList {
  getScrollResponder(): unknown;
  scrollToOffset(options: { offset: number; animated: boolean }): void;
}

export const latestOffset = (contentHeight: number, viewportHeight: number, inset = 0): number =>
  Math.max(0, contentHeight + inset - viewportHeight);

// FlatList.scrollToEnd uses an estimated last-cell frame on heterogeneous rows.
// The underlying ScrollView dispatches the native scrollToEnd command against its
// actual content extent (including its keyboard-controlled native contentInset).
// Fallback only to measured content geometry, never to last-cell estimates.
export function scrollToExactEnd(list: ExactScrollList | null, contentHeight: number, viewportHeight: number, animated: boolean, inset = 0): boolean {
  if (!list) return false;
  const scroll = list.getScrollResponder() as NativeScrollEnd | null | undefined;
  if (scroll?.scrollToEnd) { scroll.scrollToEnd({ animated }); return true; }
  if (!contentHeight || !viewportHeight) return false;
  list.scrollToOffset({ offset: latestOffset(contentHeight, viewportHeight, inset), animated });
  return true;
}

export const shouldFollowContentChange = (following: boolean, dragging: boolean, previous: number, next: number): boolean =>
  following && !dragging && next > 0 && previous !== next;

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
