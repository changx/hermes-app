import type { Message, Receipt } from '../../../packages/client/src/index';

/** Only identities in the rendered history window are eligible; SDK owns the cache. */
export interface ReceiptSource {
  receipts: ReadonlyMap<string, Receipt>;
  getReceipt(id: string, signal?: AbortSignal): Promise<Receipt>;
}

export class VisibleReceiptHydrator {
  private controller = new AbortController();
  private source: ReceiptSource | null = null;
  private threadId = '';
  private epoch = -1;
  private window = '';
  private attempted = new Map<string, 'missing' | 'transient' | 'invalid' | 'done'>();
  private queue: { id: string; clientId: string }[] = [];
  private active = 0;
  private generation = 0;

  // At most 30 visible identities in a window, three outstanding reads.
  update(source: ReceiptSource, threadId: string, messages: readonly Message[], reconnectEpoch: number): void {
    const visible = messages.filter(m => m.role === 'user' && !!m.receipt_id && !!m.client_message_id)
      .slice(-30).map(m => ({ id: m.receipt_id!, clientId: m.client_message_id! }));
    const signature = JSON.stringify(visible);
    if (this.source !== source || this.threadId !== threadId) {
      this.cancel(); this.source = source; this.threadId = threadId; this.attempted.clear(); this.epoch = reconnectEpoch;
    } else if (this.epoch !== reconnectEpoch) {
      // A reconnect is a fresh chance for transport failures, not permanent 404s.
      this.epoch = reconnectEpoch;
      for (const [id, outcome] of this.attempted) if (outcome === 'transient') this.attempted.delete(id);
      this.cancel();
    } else if (this.window !== signature) this.cancel();
    this.window = signature;
    const unique = new Map(visible.map(v => [v.id, v]));
    this.queue = [...unique.values()].filter(v => !source.receipts.has(v.id) && !this.attempted.has(v.id));
    this.pump();
  }

  private pump(): void {
    const source = this.source, generation = this.generation, controller = this.controller, threadId = this.threadId;
    if (!source) return;
    while (this.active < 3 && this.queue.length && !controller.signal.aborted) {
      const { id, clientId } = this.queue.shift()!;
      this.attempted.set(id, 'done'); // Claim before SDK onChange can re-render.
      this.active++;
      void source.getReceipt(id, controller.signal).then(receipt => {
        if (generation !== this.generation) return;
        this.attempted.set(id, receipt.id === id && receipt.thread_id === threadId && receipt.client_message_id === clientId ? 'done' : 'invalid');
      }, error => {
        if (generation !== this.generation) return;
        // Missing identities never re-request on renders or reconnect; temporary
        // transport faults get one new chance on a subsequent reconnect.
        this.attempted.set(id, error && typeof error === 'object' && 'status' in error && error.status === 404 ? 'missing' : 'transient');
      }).finally(() => {
        if (generation !== this.generation) return;
        this.active--; this.pump();
      });
    }
  }

  cancel(): void {
    this.controller.abort(); this.controller = new AbortController();
    this.generation++; this.queue = []; this.active = 0;
    // Aborted work is eligible when the window is revisited.
    for (const [id, outcome] of this.attempted) if (outcome === 'done' && !this.source?.receipts.has(id)) this.attempted.delete(id);
  }
}
