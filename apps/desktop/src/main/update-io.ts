/**
 * Download and install handoff for desktop updates (docs/desktop-auto-update.md).
 *
 * The app downloads the update zip itself, so it can show progress, stop a stalled download and
 * resume it. Squirrel.Mac then receives the verified file from a feed on 127.0.0.1 only for its
 * own work: the code signature check against the running app, unpacking, and the install at quit.
 * electron-updater uses the same handoff on macOS.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/** One entry of the update feed (services/mobile-updates/desktop.mjs). */
export type FeedEntry = { version: string; url: string; name: string; notes: string; pub_date: string; sha256: string; size: number };

/** Why a step failed, in the terms the menu, dialogs and notifications use. */
export type UpdateFailure = 'network' | 'damaged' | 'verify';
export class UpdateError extends Error {
  constructor(readonly kind: UpdateFailure, message: string) { super(message); }
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null; json(): Promise<unknown>;
}>;

const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export const FEED_TIMEOUT_MS = 30_000;
/** A download that receives no bytes for this long is stopped and resumed later. */
export const STALL_MS = 60_000;

const withTimeout = (ms: number, outer?: AbortSignal): { signal: AbortSignal; clear: () => void; touch: () => void; timedOut: () => boolean } => {
  const controller = new AbortController();
  let fired = false;
  let timer = setTimeout(() => { fired = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    clear: () => { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); },
    touch: () => { clearTimeout(timer); timer = setTimeout(() => { fired = true; controller.abort(); }, ms); },
    timedOut: () => fired,
  };
};

/** Asks the feed for a version newer than `running`. Returns null when there is none. */
export const fetchFeed = async (fetchImpl: FetchLike, url: string, running: string): Promise<FeedEntry | null> => {
  const timer = withTimeout(FEED_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: timer.signal });
    if (response.status === 204) return null;
    if (response.status !== 200) throw new UpdateError('network', `feed answered ${response.status}`);
    const value = await response.json() as Record<string, unknown>;
    const version = /(\d+\.\d+\.\d+)/.exec(String(value.name ?? ''))?.[1] ?? '';
    if (!VERSION.test(version) || typeof value.url !== 'string' || !/^https?:\/\//.test(value.url)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)
        || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) {
      throw new UpdateError('network', 'feed entry is incomplete');
    }
    if (compareVersions(version, running) <= 0) return null;
    return { version, url: value.url, name: String(value.name), notes: String(value.notes ?? ''), pub_date: String(value.pub_date ?? ''), sha256: value.sha256, size: value.size };
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError('network', timer.timedOut() ? 'feed timed out' : `feed failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally { timer.clear(); }
};

export const compareVersions = (a: string, b: string): number => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (left[i] ?? 0) < (right[i] ?? 0) ? -1 : 1;
  return 0;
};

const sha256File = (file: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});
const sizeOf = async (file: string): Promise<number | undefined> => { try { return (await fs.stat(file)).size; } catch { return undefined; } };

export const updateFile = (dir: string, entry: Pick<FeedEntry, 'version'>): string => join(dir, `Hermes-${entry.version}-update.zip`);

/**
 * Downloads `entry` into `dir` and returns the verified file. A partial file from an earlier try is
 * resumed with a Range request. Files of other versions in `dir` are deleted.
 */
export const downloadUpdate = async ({ fetchImpl, entry, dir, onProgress, signal, stallMs = STALL_MS }: {
  fetchImpl: FetchLike; entry: FeedEntry; dir: string; onProgress: (received: number, total: number) => void; signal?: AbortSignal; stallMs?: number;
}): Promise<string> => {
  await fs.mkdir(dir, { recursive: true });
  const file = updateFile(dir, entry), part = `${file}.part`;
  for (const name of await fs.readdir(dir)) {
    const path = join(dir, name);
    if (path !== file && path !== part) await fs.rm(path, { force: true, recursive: true });
  }
  if (await sizeOf(file) === entry.size && await sha256File(file) === entry.sha256) { onProgress(entry.size, entry.size); return file; }
  await fs.rm(file, { force: true });

  let start = await sizeOf(part) ?? 0;
  if (start >= entry.size) { await fs.rm(part, { force: true }); start = 0; }
  const timer = withTimeout(stallMs, signal);
  try {
    const response = await fetchImpl(entry.url, { headers: start > 0 ? { range: `bytes=${start}-` } : {}, signal: timer.signal });
    if (response.status === 200) start = 0;
    else if (response.status !== 206 || !String(response.headers.get('content-range') ?? '').startsWith(`bytes ${start}-`)) {
      throw new UpdateError('network', `download answered ${response.status}`);
    }
    if (!response.body) throw new UpdateError('network', 'download has no body');
    const out = createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
    const closed = new Promise<void>((resolve, reject) => { out.on('close', resolve); out.on('error', reject); });
    let received = start;
    onProgress(received, entry.size);
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        timer.touch();
        received += value.byteLength;
        if (received > entry.size) { await fs.rm(part, { force: true }).catch(() => {}); throw new UpdateError('damaged', 'download is larger than announced'); }
        if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', resolve));
        onProgress(received, entry.size);
      }
    } finally { out.end(); await closed; }
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError('network', timer.timedOut() ? 'download stalled' : `download failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally { timer.clear(); }

  const size = await sizeOf(part);
  if (size !== entry.size) throw new UpdateError('network', `download ended at ${size} of ${entry.size} bytes`);
  if (await sha256File(part) !== entry.sha256) {
    await fs.rm(part, { force: true });
    throw new UpdateError('damaged', 'SHA-256 of the download does not match the feed');
  }
  await fs.rename(part, file);
  return file;
};

/** The part of Electron's autoUpdater that the handoff uses. */
export interface SquirrelLike {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

export const STAGE_TIMEOUT_MS = 5 * 60_000;

/**
 * Gives the verified file to Squirrel.Mac through a feed on 127.0.0.1 and waits until Squirrel has
 * checked the signature and staged the update (`update-downloaded`).
 */
export const stageWithSquirrel = async (squirrel: SquirrelLike, file: string, entry: FeedEntry, timeoutMs = STAGE_TIMEOUT_MS): Promise<void> => {
  const size = await sizeOf(file);
  if (size === undefined) throw new UpdateError('damaged', 'update file is missing');
  let port = 0;
  const server: Server = createServer((req, res) => {
    if (req.url === '/feed') {
      const body = JSON.stringify({ url: `http://127.0.0.1:${port}/update.zip`, name: `Hermes ${entry.version}`, notes: entry.notes, pub_date: entry.pub_date, sha256: entry.sha256, size: entry.size });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }); res.end(body); return;
    }
    if (req.url === '/update.zip') {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': size });
      createReadStream(file).on('error', () => res.destroy()).pipe(res); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  port = (server.address() as AddressInfo).port;
  const listeners: Array<[string, (...args: any[]) => void]> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new UpdateError('verify', 'install preparation timed out')), timeoutMs);
      const on = (event: string, listener: (...args: any[]) => void) => { listeners.push([event, listener]); squirrel.on(event, listener); };
      on('update-downloaded', () => { clearTimeout(timer); resolve(); });
      on('update-not-available', () => { clearTimeout(timer); reject(new UpdateError('verify', 'local feed was not accepted')); });
      on('error', (error: Error) => { clearTimeout(timer); reject(new UpdateError('verify', error?.message ?? String(error))); });
      squirrel.setFeedURL({ url: `http://127.0.0.1:${port}/feed` });
      squirrel.checkForUpdates();
    });
  } finally {
    for (const [event, listener] of listeners) squirrel.removeListener(event, listener);
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};
