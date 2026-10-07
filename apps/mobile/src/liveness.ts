import type { Receipt } from '../../../packages/client/src/index';
import type { SendRecord } from './send';
import { isReceiptRunning } from './receiptState';

/** Connection timing for the phone. Active keeps the 10 s detection budget from
 * docs/m1-network-time.md; idle matches the server's own 30 s heartbeat. */
export const LIVENESS_MS = 10_000;
export const IDLE_LIVENESS_MS = 30_000;
export const LIVE_BACKOFF_MS = [200, 500, 1000, 2000, 5000, 10_000, 20_000];
export const LIVE_BACKOFF_JITTER = 0.2;
/** A touch or a return to the foreground keeps the fast interval this long. */
export const ACTIVITY_WINDOW_MS = 120_000;

type LivenessInputs = {
  records: readonly Pick<SendRecord, 'status'>[];
  threads: Iterable<{ running?: boolean }>;
  receipts: Iterable<Receipt>;
};

/** Fast liveness while something can still change for the user: an unconfirmed
 * send, a running Agent, or recent use. Failed (blocked) sends wait for the user. */
export function needsFastLiveness({ records, threads, receipts }: LivenessInputs, recentActivity: boolean): boolean {
  if (recentActivity) return true;
  if (records.some(record => record.status !== 'blocked')) return true;
  for (const thread of threads) if (thread.running) return true;
  for (const receipt of receipts) if (isReceiptRunning(receipt)) return true;
  return false;
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const defaultTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) };

/** Tracks recent use with at most one pending timer. `onChange` runs only when
 * the window opens or closes, never on every touch. */
export class ActivityWindow {
  private last = -Infinity;
  private timer: unknown = null;
  private readonly onChange: () => void;
  private readonly clock: () => number;
  private readonly windowMs: number;
  private readonly timers: Timers;
  constructor(onChange: () => void, clock: () => number = Date.now, windowMs = ACTIVITY_WINDOW_MS, timers: Timers = defaultTimers) {
    this.onChange = onChange; this.clock = clock; this.windowMs = windowMs; this.timers = timers;
  }
  get active(): boolean { return this.clock() - this.last < this.windowMs; }
  note(): void {
    const was = this.active;
    this.last = this.clock();
    if (this.timer === null) this.arm();
    if (!was) this.onChange();
  }
  stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
  private arm(): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.active) this.arm(); else this.onChange();
    }, Math.max(0, this.last + this.windowMs - this.clock()));
  }
}
