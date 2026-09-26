import { ProtocolError } from '../../../packages/client/src/index';
import type { Message, Receipt } from '../../../packages/client/src/index';

/** Only identities in the rendered history window are eligible; SDK owns the cache. */
export interface ReceiptSource {
  receipts: ReadonlyMap<string, Receipt>;
  getReceipt(id: string, signal?: AbortSignal): Promise<Receipt>;
}

type Identity = { id: string; clientId: string; key: string };
export class VisibleReceiptHydrator {
  private controller = new AbortController();
  private source: ReceiptSource | null = null;
  private threadId = '';
  private epoch = -1;
  private window = '';
  private attempted = new Map<string, 'missing' | 'transient' | 'invalid' | 'done'>();
  private inFlight = new Set<string>();
  private queue: Identity[] = [];
  private generation = 0;

  // At most 30 visible identities in a window, three outstanding reads.
  update(source: ReceiptSource, threadId: string, messages: readonly Message[], reconnectEpoch: number): void {
    const visible = messages.filter(m => m.role === 'user' && !!m.receipt_id && !!m.client_message_id)
      .slice(-30).map(m => ({ id: m.receipt_id!, clientId: m.client_message_id!, key: JSON.stringify([threadId, m.receipt_id, m.client_message_id]) }));
    const signature = JSON.stringify(visible.map(v => v.key));
    if (this.source !== source) {
      this.cancel(); this.source = source; this.attempted.clear(); this.epoch = reconnectEpoch;
    } else if (this.epoch !== reconnectEpoch) {
      // A reconnect is a fresh chance for transport failures, not permanent 404s.
      this.cancel(); this.epoch = reconnectEpoch;
      for (const [key, outcome] of this.attempted) if (outcome === 'transient') this.attempted.delete(key);
    } else if (this.threadId !== threadId || this.window !== signature) this.cancel();
    this.threadId = threadId; this.window = signature;
    const unique = new Map(visible.map(v => [v.key, v]));
    this.queue = [...unique.values()].filter(v => !source.receipts.has(v.id) && !this.attempted.has(v.key) && !this.inFlight.has(v.key));
    this.pump();
  }

  private pump(): void {
    const source = this.source, generation = this.generation, controller = this.controller, threadId = this.threadId;
    if (!source) return;
    while (this.inFlight.size < 3 && this.queue.length && !controller.signal.aborted) {
      const { id, clientId, key } = this.queue.shift()!;
      this.inFlight.add(key); // Claim before SDK onChange can re-render.
      void source.getReceipt(id, controller.signal).then(receipt => {
        if (generation !== this.generation) return;
        this.attempted.set(key, receipt.id === id && receipt.thread_id === threadId && receipt.client_message_id === clientId ? 'done' : 'invalid');
      }, error => {
        if (generation !== this.generation) return;
        this.attempted.set(key, error && typeof error === 'object' && 'status' in error && error.status === 404 ? 'missing'
          : error instanceof ProtocolError && error.message === 'receipt identity mismatch' ? 'invalid' : 'transient');
      }).finally(() => {
        if (generation !== this.generation) return;
        this.inFlight.delete(key); this.pump();
      });
    }
  }

  cancel(): void {
    this.controller.abort(); this.controller = new AbortController();
    this.generation++; this.queue = []; this.inFlight.clear();
  }
}
