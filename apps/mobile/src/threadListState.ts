import type { Receipt } from '../../../packages/client/src/index';

export function isThreadRunning(threadId: string, receipts: Iterable<Receipt>): boolean {
  for (const receipt of receipts) {
    if (receipt.thread_id === threadId && receipt.state === 'running'
      && (receipt.processing == null || receipt.processing === 'running')) return true;
  }
  return false;
}