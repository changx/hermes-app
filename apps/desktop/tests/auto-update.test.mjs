// Automatic updates: the state machine (fake steps and timers), the real download and Squirrel handoff
// against a local HTTP server, and the menu, dialog and notification texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);

const load = async entry => {
  const folder = await mkdtemp(join(tmpdir(), 'hermes-update-'));
  const out = await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
  const file = join(folder, 'module.cjs'); await writeFile(file, out.outputFiles[0].text);
  try { return require(file); } finally { await rm(folder, { recursive: true, force: true }); }
};
const { DesktopUpdater, feedUrl, FIRST_CHECK_MS, CHECK_INTERVAL_MS, RETRY_MS, RESUME_CHECK_AFTER_MS } = await load('../src/main/updater.ts');
const { fetchFeed, downloadUpdate, stageWithSquirrel, updateFile, UpdateError } = await load('../src/main/update-io.ts');
const { updateMenuItem, updateCheckDialog, updateNotice } = await load('../src/main/app-menu.ts');

const entry = (version = '0.1.140', size = 1000) => ({ version, url: 'https://u.example/x.zip', name: `Hermes ${version}`, notes: '', pub_date: '', sha256: 'a'.repeat(64), size });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Fake steps: each call returns a promise that the test settles. */
const harness = (overrides = {}) => {
  const calls = { feed: [], download: [], stage: [], install: 0 };
  const pendingFeed = [], pendingDownload = [], pendingStage = [];
  const steps = {
    fetchFeed: url => { calls.feed.push(url); const d = deferred(); pendingFeed.push(d); return d.promise; },
    download: (e, onProgress) => { calls.download.push(e.version); const d = deferred(); d.onProgress = onProgress; pendingDownload.push(d); return d.promise; },
    stage: (file, e) => { calls.stage.push([file, e.version]); const d = deferred(); pendingStage.push(d); return d.promise; },
    quitAndInstall: () => { calls.install++; },
  };
  let clock = 1_000_000;
  const timers = [];
  const log = [];
  const updater = new DesktopUpdater({
    steps, version: '0.1.139', platform: 'darwin', arch: 'arm64', isPackaged: true, inApplications: true,
    feedBase: 'https://updates.example.test/desktop-updates/', now: () => clock, log: line => log.push(line),
    setTimer: (run, ms) => { const timer = { run, ms, at: clock + ms, live: true }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.live = false; }, ...overrides,
  });
  const seen = []; updater.onChange(state => seen.push(state));
  const pending = () => timers.filter(timer => timer.live);
  const fire = () => { const [timer] = pending(); assert.ok(timer, 'a planned check'); timer.live = false; clock = timer.at; timer.run(); return timer.ms; };
  return { updater, calls, pendingFeed, pendingDownload, pendingStage, pending, fire, seen, log, advance: ms => { clock += ms; } };
};

test('feed URL names the platform, architecture and running version', () => {
  assert.equal(feedUrl('https://h.example/desktop-updates/', 'arm64', '0.1.133'), 'https://h.example/desktop-updates/darwin-arm64/0.1.133');
});

test('no check outside an installed macOS app', () => {
  for (const [options, reason] of [[{ isPackaged: false }, 'not-packaged'], [{ platform: 'linux' }, 'not-packaged'], [{ inApplications: false }, 'not-in-applications']]) {
    const { updater, pending, calls } = harness(options);
    updater.start();
    assert.equal(updater.state.phase, 'unsupported'); assert.equal(updater.state.reason, reason);
    assert.equal(pending().length, 0); assert.equal(calls.feed.length, 0);
  }
});

test('full cycle: check, download with progress, verify, stage, ready; no checks after ready', async () => {
  const h = harness();
  h.updater.start();
  assert.equal(h.fire(), FIRST_CHECK_MS);
  assert.deepEqual(h.calls.feed, ['https://updates.example.test/desktop-updates/darwin-arm64/0.1.139']);
  h.pendingFeed[0].resolve(entry()); await tick();
  assert.deepEqual(h.updater.state, { phase: 'downloading', version: '0.1.139', available: '0.1.140', received: 0, total: 1000, failure: undefined });
  const progress = h.pendingDownload[0].onProgress;
  const before = h.seen.length;
  for (let received = 0; received <= 1000; received += 1) progress(received, 1000);
  assert.ok(h.seen.length - before <= 101, 'at most one change per whole percent');
  assert.equal(h.updater.state.received, 1000);
  h.pendingDownload[0].resolve('/tmp/u.zip'); await tick();
  assert.equal(h.updater.state.phase, 'preparing');
  assert.deepEqual(h.calls.stage, [['/tmp/u.zip', '0.1.140']]);
  h.pendingStage[0].resolve(); await tick();
  assert.equal(h.updater.state.phase, 'ready');
  assert.equal(h.pending().length, 0, 'no further checks');
  assert.equal(h.updater.quitAndInstall(), true); assert.equal(h.calls.install, 1);
  assert.ok(h.log.some(line => line.startsWith('ready 0.1.140')));
});

test('no update: idle, next check in 4 hours', async () => {
  const h = harness();
  h.updater.start(); h.fire();
  h.pendingFeed[0].resolve(null); await tick();
  assert.equal(h.updater.state.phase, 'idle'); assert.equal(h.pending()[0].ms, CHECK_INTERVAL_MS);
});

test('a failed download is an error state with its kind, retried in 15 minutes; the retry runs the whole cycle again', async () => {
  const h = harness();
  h.updater.start(); h.fire();
  h.pendingFeed[0].resolve(entry()); await tick();
  h.pendingDownload[0].reject(new UpdateError('network', 'download stalled')); await tick();
  assert.equal(h.updater.state.phase, 'error'); assert.equal(h.updater.state.failure, 'network'); assert.equal(h.updater.state.available, '0.1.140');
  assert.equal(h.pending()[0].ms, RETRY_MS);
  assert.ok(h.log.some(line => line.includes('download stalled')));
  h.fire(); h.pendingFeed[1].resolve(entry()); await tick();
  assert.equal(h.updater.state.phase, 'downloading'); assert.equal(h.updater.state.failure, undefined);
  h.pendingDownload[1].resolve('/tmp/u.zip'); await tick();
  h.pendingStage[0].reject(new UpdateError('verify', 'Code signature did not pass validation')); await tick();
  assert.equal(h.updater.state.failure, 'verify');
});

test('"Check for Updates…": answers when the result is known, never runs two cycles, does not wait for the download', async () => {
  const h = harness();
  h.updater.start();
  const first = h.updater.check(), second = h.updater.check();
  assert.equal(h.calls.feed.length, 1, 'one cycle');
  h.pendingFeed[0].resolve(entry()); await tick();
  assert.equal((await first).phase, 'downloading'); assert.equal((await second).phase, 'downloading');
  assert.equal((await h.updater.check()).phase, 'downloading'); assert.equal(h.calls.feed.length, 1, 'no new cycle while downloading');
  h.pendingDownload[0].reject(new Error('socket hang up')); await tick();
  assert.equal(h.updater.state.failure, 'network', 'plain errors count as network');
  const again = h.updater.check(); assert.equal(h.calls.feed.length, 2);
  h.pendingFeed[1].reject(new UpdateError('network', 'feed timed out')); await tick();
  assert.equal((await again).phase, 'error');
});

test('wake from sleep checks only when the last check is old', async () => {
  const h = harness();
  h.updater.start(); h.fire(); h.pendingFeed[0].resolve(null); await tick();
  h.updater.resumed(); assert.equal(h.pending()[0].ms, CHECK_INTERVAL_MS);
  h.advance(RESUME_CHECK_AFTER_MS); h.updater.resumed();
  assert.equal(h.pending().length, 1); assert.equal(h.pending()[0].ms, 10_000);
});

// --- Real download and handoff against a local HTTP server ---

const serve = async (handler) => {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
};
const zipBytes = randomBytes(300_000);
const zipSha = createHash('sha256').update(zipBytes).digest('hex');
/** Serves the zip; `cut` stops the first response after that many bytes and keeps the socket open (a stall). */
const zipServer = ({ cut, corrupt } = {}) => {
  const requests = [];
  let first = true;
  return { requests, handler: (req, res) => {
    requests.push({ url: req.url, range: req.headers.range });
    if (req.url.startsWith('/feed/')) {
      const running = req.url.split('/').pop();
      if (running === '0.1.140') { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: `http://${req.headers.host}/zip`, name: 'Hermes 0.1.140', notes: 'n', pub_date: 'p', sha256: zipSha, size: zipBytes.length }));
      return;
    }
    if (req.url !== '/zip') { res.writeHead(404); res.end(); return; }
    const body = corrupt ? Buffer.from(zipBytes).fill(1, 0, 10) : zipBytes;
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (match) {
      const start = Number(match[1]);
      res.writeHead(206, { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, 'content-length': body.length - start });
      res.end(body.subarray(start)); return;
    }
    res.writeHead(200, { 'content-length': body.length });
    if (cut && first) { first = false; res.write(body.subarray(0, cut)); return; }
    res.end(body);
  } };
};

test('feed: 204 is no update, 200 gives the entry, a broken answer is a network failure', async () => {
  const z = zipServer(); const s = await serve(z.handler);
  try {
    assert.equal(await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.140`, '0.1.140'), null);
    const found = await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.139`, '0.1.139');
    assert.equal(found.version, '0.1.140'); assert.equal(found.size, zipBytes.length);
    assert.equal(await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.139`, '0.1.141'), null, 'never an older version');
    await assert.rejects(fetchFeed(fetch, `${s.url}/nothing`, '0.1.139'), error => error.kind === 'network');
  } finally { await s.close(); }
});

test('download: progress to the end, SHA-256 checked, other versions deleted', async () => {
  const z = zipServer(); const s = await serve(z.handler);
  const dir = await mkdtemp(join(tmpdir(), 'hermes-dl-'));
  try {
    await writeFile(join(dir, 'Hermes-0.1.130-update.zip'), 'old');
    const e = await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.139`, '0.1.139');
    const seen = [];
    const file = await downloadUpdate({ fetchImpl: fetch, entry: e, dir, onProgress: (r, t) => seen.push([r, t]) });
    assert.equal(file, updateFile(dir, e));
    assert.deepEqual(await readFile(file), zipBytes);
    assert.deepEqual(seen.at(-1), [zipBytes.length, zipBytes.length]); assert.ok(seen.length > 1);
    assert.deepEqual(await readdir(dir), ['Hermes-0.1.140-update.zip']);
    await downloadUpdate({ fetchImpl: fetch, entry: e, dir, onProgress: () => {} });
    assert.equal(z.requests.filter(r => r.url === '/zip').length, 1, 'a verified file is not downloaded again');
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('download: a stall stops after the limit; the next try resumes with Range and completes', async () => {
  const z = zipServer({ cut: 100_000 }); const s = await serve(z.handler);
  const dir = await mkdtemp(join(tmpdir(), 'hermes-dl-'));
  try {
    const e = await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.139`, '0.1.139');
    const started = Date.now();
    await assert.rejects(downloadUpdate({ fetchImpl: fetch, entry: e, dir, onProgress: () => {}, stallMs: 300 }),
      error => error.kind === 'network' && /stalled/.test(error.message));
    assert.ok(Date.now() - started < 3000);
    assert.equal((await stat(updateFile(dir, e) + '.part')).size, 100_000, 'partial download kept');
    const file = await downloadUpdate({ fetchImpl: fetch, entry: e, dir, onProgress: () => {} });
    assert.deepEqual(await readFile(file), zipBytes);
    assert.deepEqual(z.requests.filter(r => r.url === '/zip').map(r => r.range ?? null), [null, 'bytes=100000-']);
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('download: a damaged file is deleted and reported as damaged', async () => {
  const z = zipServer({ corrupt: true }); const s = await serve(z.handler);
  const dir = await mkdtemp(join(tmpdir(), 'hermes-dl-'));
  try {
    const e = await fetchFeed(fetch, `${s.url}/feed/darwin-arm64/0.1.139`, '0.1.139');
    await assert.rejects(downloadUpdate({ fetchImpl: fetch, entry: e, dir, onProgress: () => {} }), error => error.kind === 'damaged');
    assert.deepEqual(await readdir(dir), []);
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

/** Squirrel.Mac stand-in that does what Squirrel does over HTTP: read the feed, download the url, then report. */
class FakeSquirrel extends EventEmitter {
  constructor(result) { super(); this.result = result; this.got = undefined; }
  setFeedURL({ url }) { this.feed = url; }
  checkForUpdates() {
    void (async () => {
      const feed = await (await fetch(this.feed)).json();
      this.got = Buffer.from(await (await fetch(feed.url)).arrayBuffer());
      this.feedBody = feed;
      if (this.result === 'ok') this.emit('update-downloaded', {}, feed.notes, feed.name);
      else this.emit('error', new Error('Code signature at URL file:///x did not pass validation'));
    })();
  }
}

test('handoff: Squirrel gets the verified file from 127.0.0.1; its signature error becomes a verify failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hermes-stage-'));
  try {
    const file = join(dir, 'Hermes-0.1.140-update.zip'); await writeFile(file, zipBytes);
    const e = { ...entry(), sha256: zipSha, size: zipBytes.length };
    const ok = new FakeSquirrel('ok');
    await stageWithSquirrel(ok, file, e);
    assert.match(ok.feed, /^http:\/\/127\.0\.0\.1:\d+\/feed$/);
    assert.deepEqual(ok.got, zipBytes); assert.equal(ok.feedBody.sha256, zipSha); assert.equal(ok.feedBody.name, 'Hermes 0.1.140');
    assert.equal(ok.listenerCount('update-downloaded') + ok.listenerCount('error'), 0, 'listeners removed');
    await assert.rejects(fetch(ok.feed), 'local feed closed after the handoff');
    await assert.rejects(stageWithSquirrel(new FakeSquirrel('bad'), file, e), error => error.kind === 'verify' && /did not pass validation/.test(error.message));
    const silent = { setFeedURL() {}, checkForUpdates() {}, on() {}, removeListener() {} };
    await assert.rejects(stageWithSquirrel(silent, file, e, 200), error => error.kind === 'verify' && /timed out/.test(error.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('menu item, dialogs and notifications for each state', () => {
  const v = '0.1.139';
  assert.deepEqual(updateMenuItem({ phase: 'idle', version: v }), { label: 'Check for Updates…', enabled: true, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'downloading', version: v, available: '0.1.140', received: 42, total: 100 }), { label: 'Downloading Update 0.1.140… 42%', enabled: false, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'preparing', version: v }), { label: 'Preparing Update…', enabled: false, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'ready', version: v, available: '0.1.140' }), { label: 'Restart to Update to 0.1.140', enabled: true, action: 'restart' });
  assert.deepEqual(updateMenuItem({ phase: 'error', version: v, failure: 'network' }), { label: 'Update Failed – Try Again', enabled: true, action: 'check' });
  assert.equal(updateCheckDialog({ phase: 'downloading', version: v, available: '0.1.140', received: 30, total: 100 }).message, 'Hermes 0.1.140 is downloading (30%).');
  assert.equal(updateCheckDialog({ phase: 'downloading', version: v }).message, 'A new version of Hermes is downloading.');
  assert.equal(updateCheckDialog({ phase: 'error', version: v, available: '0.1.140', failure: 'network' }).message, 'Hermes 0.1.140 could not be downloaded.');
  assert.equal(updateCheckDialog({ phase: 'error', version: v, failure: 'network' }).message, 'Hermes could not check for updates.');
  assert.equal(updateCheckDialog({ phase: 'error', version: v, available: '0.1.140', failure: 'damaged' }).message, 'The downloaded update was damaged.');
  assert.equal(updateCheckDialog({ phase: 'error', version: v, available: '0.1.140', failure: 'verify' }).message, 'Hermes could not install the update.');
  const ready = updateCheckDialog({ phase: 'ready', version: v, available: '0.1.140' });
  assert.equal(ready.buttons[ready.restartButton], 'Restart Now');
  assert.deepEqual(updateNotice({ phase: 'ready', version: v, available: '0.1.140' }), { key: 'ready:0.1.140', title: 'Hermes update is ready', body: 'Hermes 0.1.140 is downloaded. Click to restart Hermes and update, or it installs when you quit.', restart: true });
  assert.equal(updateNotice({ phase: 'error', version: v, available: '0.1.140', failure: 'network' }).key, 'error:0.1.140:network');
  assert.equal(updateNotice({ phase: 'error', version: v, failure: 'network' }), undefined, 'a failed check without a found version does not notify');
  assert.equal(updateNotice({ phase: 'downloading', version: v }), undefined);
  for (const phase of ['idle', 'checking', 'downloading', 'preparing', 'ready', 'error', 'unsupported']) {
    for (const failure of [undefined, 'network', 'damaged', 'verify']) {
      const state = { phase, version: v, available: '0.1.140', failure, received: 1, total: 2 };
      const text = JSON.stringify([updateMenuItem(state), updateCheckDialog(state), updateNotice(state)]);
      assert.doesNotMatch(text, /squirrel|feed|http|sha|zip|signature|undefined/i, `${phase}/${failure}: plain words only`);
    }
  }
});

test('main process: default menus kept, Dock progress, notices once, install after the quit sequence', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  for (const role of ['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']) {
    assert.ok(source.includes(`role: "${role}"`), role);
  }
  const quitEnd = source.slice(source.indexOf('app.on("before-quit"'));
  assert.ok(quitEnd.indexOf('shutdownPhase = "done"') < quitEnd.indexOf('updater.quitAndInstall()'), 'install only after the quit sequence');
  assert.match(source, /setProgressBar\(/);
  assert.match(source, /shownUpdateNotices/);
  assert.match(source, /"logs", "update\.log"/);
  assert.match(source, /updater\.resumed\(\)/);
});
