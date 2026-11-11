/**
 * Automatic updates for the packaged macOS app (docs/desktop-auto-update.md).
 *
 * Steps: ask the feed for a newer version → download the zip with progress (update-io.ts) →
 * check size and SHA-256 → hand the file to Squirrel.Mac, which checks the Developer ID signature
 * and stages the update → "ready". The update installs when Hermes quits, or at once with
 * "Restart to Update". A failed step is retried later; a partial download resumes.
 */
import type { FeedEntry, UpdateError, UpdateFailure } from './update-io';

export const UPDATE_FEED_BASE = 'https://hermes-app-api.tuly.space/desktop-updates';
/** The first check waits until the app has settled after launch. */
export const FIRST_CHECK_MS = 60_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** After a failed check or download. A partial download resumes. */
export const RETRY_MS = 15 * 60_000;
/** After sleep or a network change, check again only if the last check is this old. */
export const RESUME_CHECK_AFTER_MS = 60 * 60_000;

export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'downloading' | 'preparing' | 'ready' | 'error';
export type UpdateState = {
  phase: UpdatePhase; version: string;
  /** The newer version, from the moment the feed names it. */
  available?: string;
  /** Download progress in bytes. */
  received?: number; total?: number;
  failure?: UpdateFailure;
  reason?: 'not-packaged' | 'not-in-applications';
};

/** The input and output steps: update-io.ts and Electron in the app, fakes in tests. */
export interface UpdateSteps {
  fetchFeed(url: string): Promise<FeedEntry | null>;
  download(entry: FeedEntry, onProgress: (received: number, total: number) => void): Promise<string>;
  stage(file: string, entry: FeedEntry): Promise<void>;
  quitAndInstall(): void;
}

export type UpdaterOptions = {
  steps: UpdateSteps;
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  inApplications: boolean;
  feedBase?: string;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Developer log (update.log in userData). No user content. */
  log?: (line: string) => void;
};

export const feedUrl = (base: string, arch: string, version: string): string =>
  `${base.replace(/\/+$/, '')}/darwin-${encodeURIComponent(arch)}/${encodeURIComponent(version)}`;

/** Progress changes the state at most once per whole percent. */
const percent = (received: number, total: number): number => total > 0 ? Math.floor(received * 100 / total) : 0;

export class DesktopUpdater {
  private current: UpdateState;
  private lastCheck = 0;
  private timer: unknown;
  private running?: Promise<void>;
  private waiters: Array<(state: UpdateState) => void> = [];
  private listeners = new Set<(state: UpdateState) => void>();
  private started = false;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly log: (line: string) => void;

  constructor(private readonly options: UpdaterOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((run, ms) => { const t = setTimeout(run, ms); (t as { unref?: () => void }).unref?.(); return t; });
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.log = options.log ?? (() => {});
    const supported = options.platform === 'darwin' && options.isPackaged && options.inApplications;
    this.current = supported ? { phase: 'idle', version: options.version }
      : { phase: 'unsupported', version: options.version, reason: options.isPackaged && options.platform === 'darwin' ? 'not-in-applications' : 'not-packaged' };
  }

  get state(): UpdateState { return { ...this.current }; }
  onChange(listener: (state: UpdateState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Plans the first check. Does nothing when updates are not supported. */
  start(): void {
    if (this.started || this.current.phase === 'unsupported') return;
    this.started = true;
    this.log(`start ${this.options.version}, feed ${this.url}`);
    this.plan(FIRST_CHECK_MS);
  }

  /** Called after wake from sleep: a check if the last one is old. */
  resumed(): void {
    if (!this.started || this.running || this.current.phase === 'ready') return;
    if (this.now() - this.lastCheck >= RESUME_CHECK_AFTER_MS) this.plan(10_000);
  }

  /**
   * "Check for Updates…": resolves when the answer is known (no update; a newer version found, while
   * its download goes on; ready; failed). A check or download in progress is not started again.
   */
  check(): Promise<UpdateState> {
    if (!this.started || this.current.phase === 'ready' || this.current.phase === 'downloading' || this.current.phase === 'preparing') {
      return Promise.resolve(this.state);
    }
    const answer = new Promise<UpdateState>(resolve => this.waiters.push(resolve));
    if (!this.running) void this.run();
    return answer;
  }

  /** Installs the staged update and opens the new version. Only after "ready". */
  quitAndInstall(): boolean {
    if (this.current.phase !== 'ready') return false;
    this.log(`install ${this.current.available}`);
    this.options.steps.quitAndInstall();
    return true;
  }

  dispose(): void { if (this.timer !== undefined) this.clearTimer(this.timer); this.timer = undefined; }

  private get url(): string { return feedUrl(this.options.feedBase ?? UPDATE_FEED_BASE, this.options.arch, this.options.version); }

  private plan(ms: number): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = undefined; if (!this.running && this.current.phase !== 'ready') void this.run(); }, ms);
  }

  private run(): Promise<void> {
    this.running = this.cycle().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async cycle(): Promise<void> {
    const { steps } = this.options;
    this.lastCheck = this.now();
    this.set({ phase: 'checking', failure: undefined, received: undefined, total: undefined });
    let entry: FeedEntry | null;
    try { entry = await steps.fetchFeed(this.url); } catch (error) { return this.fail(error); }
    if (!entry) {
      this.log('no update');
      this.set({ phase: 'idle', available: undefined });
      this.answer(); this.plan(CHECK_INTERVAL_MS); return;
    }
    this.log(`found ${entry.version} (${entry.size} bytes)`);
    this.set({ phase: 'downloading', available: entry.version, received: 0, total: entry.size });
    this.answer();
    let file: string;
    try {
      let shown = -1;
      file = await steps.download(entry, (received, total) => {
        const value = percent(received, total);
        if (value === shown) return;
        shown = value;
        this.set({ received, total });
      });
    } catch (error) { return this.fail(error); }
    this.log(`downloaded ${entry.version}, SHA-256 checked`);
    this.set({ phase: 'preparing', received: entry.size, total: entry.size });
    try { await steps.stage(file, entry); } catch (error) { return this.fail(error); }
    this.log(`ready ${entry.version}`);
    this.set({ phase: 'ready' });
    this.dispose();
    this.answer();
  }

  private fail(error: unknown): void {
    // By its kind field: an UpdateError from update-io.ts, any other error counts as a network failure.
    const kind = (error as Partial<UpdateError> | undefined)?.kind;
    const failure: UpdateFailure = kind === 'damaged' || kind === 'verify' ? kind : 'network';
    this.log(`failed (${failure}) while ${this.current.phase}: ${error instanceof Error ? error.message : String(error)}`);
    this.set({ phase: 'error', failure });
    this.answer();
    this.plan(RETRY_MS);
  }

  private answer(): void {
    const waiters = this.waiters; this.waiters = [];
    for (const resolve of waiters) resolve(this.state);
  }

  private set(change: Partial<UpdateState>): void {
    const next = { ...this.current, ...change };
    const keys = new Set([...Object.keys(next), ...Object.keys(this.current)]) as Set<keyof UpdateState>;
    if ([...keys].every(key => next[key] === this.current[key])) return;
    this.current = next;
    for (const listener of this.listeners) listener(this.state);
  }
}
