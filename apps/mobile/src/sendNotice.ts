import type { SendRecord } from './send';

const rejectionNotices = new Set([
  'Sending could not be confirmed. Check your connection permissions or message.',
  'This conversation is unavailable. Your unsent message is still saved.'
]);

/** Clear only resolved send-rejection banners, not storage, auth or action errors. */
export function reconciledSendNotice(previous: string, records: readonly SendRecord[], notice?: string): string {
  if (notice) return notice;
  return rejectionNotices.has(previous) && !records.some(record => record.status === 'blocked') ? '' : previous;
}
