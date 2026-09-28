import type { Receipt } from '../../../packages/client/src/index';

/**
 * A receipt can retain its lifecycle `running` state after the authoritative
 * processing callback has already reached a terminal outcome. Keep legacy
 * receipts (no processing field) working, but never expose active-run controls
 * for a terminal or unknown processing result.
 */
export function isReceiptRunning(receipt: Receipt): boolean {
  return receipt.state === 'running' && (receipt.processing == null || receipt.processing === 'running');
}

export function hasRunningReceipt(threadId: string, receipts: readonly Receipt[]): boolean {
  return receipts.some(receipt => receipt.thread_id === threadId && isReceiptRunning(receipt));
}
