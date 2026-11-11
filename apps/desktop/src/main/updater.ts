/**
 * Automatic updates for the packaged macOS app (docs/desktop-auto-update.md).
 *
 * Electron's built-in autoUpdater (Squirrel.Mac) asks the feed for a newer version, downloads the
 * zip in the background and checks that the new app has the same Developer ID signature before it
 * installs anything. A downloaded update is installed when Hermes quits, or at once with
 * "Restart to Update" in the app menu. Normal checks never show a dialog.
 */

export const UPDATE_FEED_BASE = 'https://hermes-app-api.tuly.space/desktop-updates';
/** The first check waits until the app has settled after launch. */
export const FIRST_CHECK_MS = 60_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** After sleep or a network change, check again only if the last check is this old. */
export const RESUME_CHECK_AFTER_MS = 60 * 60_000;

export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
export type UpdateState = { phase: UpdatePhase; version: string; available?: string; reason?: 'not-packaged' | 'not-in-applications' };

/** The part of Electron's autoUpdater that this module uses. */
export interface AutoUpdaterLike {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'checking-for-update' | 'update-available' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-downloaded', listener: (event: unknown, notes: string, name: string) => void): unknown;
}

export type UpdaterOptions = {
  updater: AutoUpdaterLike;
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  inApplications: boolean;
  feedBase?: string;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Developer log only (main-process stdout). */
  log?: (line: string) => void;
};

export type CheckResult = UpdateState;

export const feedUrl = (base: string, arch: string, version: string): string =>
  `${base.replace(/\/+$/, '')}/darwin-${encodeURIComponent(arch)}/${encodeURIComponent(version)}`;

/** "Hermes 0.1.134" → "0.1.134". */
const versionFromName = (name: string | undefined): string | undefined => /(\d+\.\d+\.\d+)/.exec(name ?? '')?.[1];

export class DesktopUpdater {
  private current: UpdateState;
  private lastCheck = 0;
  private timer: unknown;
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

  /** Sets the feed and plans the first check. Does nothing when updates are not supported. */
  start(): void {
    if (this.started || this.current.phase === 'unsupported') return;
    this.started = true;
    const { updater } = this.options;
    updater.on('checking-for-update', () => this.set({ phase: 'checking' }));
    // A manual check reports a found update at once; the download goes on in the background.
    updater.on('update-available', () => { this.set({ phase: 'downloading' }); this.answer(); });
    updater.on('update-not-available', () => this.finish({ phase: 'idle', available: undefined }));
    updater.on('update-downloaded', (_event, _notes, name) => this.finish({ phase: 'ready', available: versionFromName(name) }));
    updater.on('error', error => {
      this.log(`[update] ${error?.message ?? String(error)}`);
      // A failed check or download is retried at the next planned check.
      this.finish({ phase: 'error' });
    });
    updater.setFeedURL({ url: feedUrl(this.options.feedBase ?? UPDATE_FEED_BASE, this.options.arch, this.options.version) });
    this.plan(FIRST_CHECK_MS);
  }

  /** Called after wake from sleep: a check if the last one is old. */
  resumed(): void {
    if (!this.started || this.busy || this.current.phase === 'ready') return;
    if (this.now() - this.lastCheck >= RESUME_CHECK_AFTER_MS) this.plan(10_000);
  }

  /** Checks now and resolves with the state after the check (for "Check for Updates…"). */
  check(): Promise<CheckResult> {
    if (!this.started || this.current.phase === 'ready' || this.current.phase === 'downloading') return Promise.resolve(this.state);
    const result = new Promise<CheckResult>(resolve => this.waiters.push(resolve));
    // A running check or download is not started a second time: Squirrel.Mac would download twice.
    if (!this.busy) this.run();
    return result;
  }

  /** Installs the downloaded update and opens the new version. Only after "ready". */
  quitAndInstall(): boolean {
    if (this.current.phase !== 'ready') return false;
    this.options.updater.quitAndInstall();
    return true;
  }

  dispose(): void { if (this.timer !== undefined) this.clearTimer(this.timer); this.timer = undefined; }

  private get busy(): boolean { return this.current.phase === 'checking' || this.current.phase === 'downloading'; }

  private plan(ms: number): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = undefined; if (!this.busy && this.current.phase !== 'ready') this.run(); else if (this.current.phase !== 'ready') this.plan(CHECK_INTERVAL_MS); }, ms);
  }

  private run(): void {
    this.lastCheck = this.now();
    this.set({ phase: 'checking' });
    try { this.options.updater.checkForUpdates(); }
    catch (error) { this.log(`[update] ${error instanceof Error ? error.message : String(error)}`); this.finish({ phase: 'error' }); }
  }

  private finish(change: Partial<UpdateState>): void {
    this.set(change);
    if (this.current.phase !== 'ready') this.plan(CHECK_INTERVAL_MS);
    else this.dispose();
    this.answer();
  }

  private answer(): void {
    const waiters = this.waiters; this.waiters = [];
    for (const resolve of waiters) resolve(this.state);
  }

  private set(change: Partial<UpdateState>): void {
    const next = { ...this.current, ...change };
    if (next.phase === this.current.phase && next.available === this.current.available) return;
    this.current = next;
    for (const listener of this.listeners) listener(this.state);
  }
}
