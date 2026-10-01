import type { TimelineRow } from './timeline';

// Public FlashList drawDistance is a render-ahead buffer, not a permanent
// keep-alive switch. Keep it viewport-relative instead of rendering the entire log.
export function historyDrawDistance(viewportHeight: number): number {
  return Number.isFinite(viewportHeight) && viewportHeight > 0 ? Math.max(250, Math.round(viewportHeight * 2)) : 250;
}

// FlashList v2 computes separate size averages by item type. This classifier is
// intentionally O(1): no Markdown parse or full-text scan in a frequent callback.
export function historyItemType(row: TimelineRow): string {
  if (row.displayKind === 'system_notice') return 'notice';
  if (row.attachments?.length) return row.role === 'user' ? 'user-attachments' : 'attachments';
  if (row.role === 'user') return row.text.length > 1200 ? 'user-long' : 'user';
  if (row.role === 'assistant') {
    if (row.text.length === 0 && row.toolCalls?.length) return 'tools';
    return row.text.length > 1200 ? 'assistant-long' : 'assistant';
  }
  return 'other';
}
