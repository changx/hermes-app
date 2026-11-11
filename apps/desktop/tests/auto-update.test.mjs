// Automatic updates: the update state machine (fake Squirrel.Mac and timers), the menu item and the dialogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);

const load = async entry => {
  const folder = await mkdtemp(join(tmpdir(), 'hermes-update-'));
  const out = await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
  const file = join(folder, 'module.cjs'); await writeFile(file, out.outputFiles[0].text);
  try { return require(file); } finally { await rm(folder, { recursive: true, force: true }); }
};
const { DesktopUpdater, feedUrl, FIRST_CHECK_MS, CHECK_INTERVAL_MS, RESUME_CHECK_AFTER_MS } = await load('../src/main/updater.ts');
const { updateMenuItem, updateCheckDialog } = await load('../src/main/app-menu.ts');

/** Squirrel.Mac stand-in: records calls; the test emits its events. */
class FakeSquirrel extends EventEmitter {
  feeds = []; checks = 0; installs = 0;
  setFeedURL(options) { this.feeds.push(options.url); }
  checkForUpdates() { this.checks++; }
  quitAndInstall() { this.installs++; }
}
const harness = (overrides = {}) => {
  const squirrel = new FakeSquirrel();
  let clock = 1_000_000;
  const timers = [];
  const updater = new DesktopUpdater({
    updater: squirrel, version: '0.1.133', platform: 'darwin', arch: 'arm64', isPackaged: true, inApplications: true,
    feedBase: 'https://updates.example.test/desktop-updates/', now: () => clock,
    setTimer: (run, ms) => { const timer = { run, ms, at: clock + ms, live: true }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.live = false; }, ...overrides,
  });
  const pending = () => timers.filter(timer => timer.live);
  const fire = () => { const [timer] = pending(); assert.ok(timer, 'a planned check'); timer.live = false; clock = timer.at; timer.run(); return timer.ms; };
  return { squirrel, updater, pending, fire, advance: ms => { clock += ms; } };
};

test('feed URL names the platform, architecture and running version', () => {
  assert.equal(feedUrl('https://h.example/desktop-updates/', 'arm64', '0.1.133'), 'https://h.example/desktop-updates/darwin-arm64/0.1.133');
});

test('no feed and no check outside an installed macOS app', () => {
  for (const [options, reason] of [[{ isPackaged: false }, 'not-packaged'], [{ platform: 'linux' }, 'not-packaged'], [{ inApplications: false }, 'not-in-applications']]) {
    const { squirrel, updater, pending } = harness(options);
    updater.start();
    assert.equal(updater.state.phase, 'unsupported');
    assert.equal(updater.state.reason, reason);
    assert.deepEqual(squirrel.feeds, []); assert.equal(pending().length, 0);
  }
});

test('first check one minute after start, then every 4 hours; a found update downloads and stops further checks', async () => {
  const { squirrel, updater, pending, fire } = harness();
  const seen = []; updater.onChange(state => seen.push(state.phase));
  updater.start();
  assert.deepEqual(squirrel.feeds, ['https://updates.example.test/desktop-updates/darwin-arm64/0.1.133']);
  assert.equal(fire(), FIRST_CHECK_MS); assert.equal(squirrel.checks, 1);
  squirrel.emit('checking-for-update'); squirrel.emit('update-not-available');
  assert.equal(updater.state.phase, 'idle');
  assert.equal(fire(), CHECK_INTERVAL_MS); assert.equal(squirrel.checks, 2);
  squirrel.emit('update-available');
  assert.equal(updater.state.phase, 'downloading');
  squirrel.emit('update-downloaded', {}, 'notes', 'Hermes 0.1.134', new Date(), 'https://x');
  assert.deepEqual(updater.state, { phase: 'ready', version: '0.1.133', available: '0.1.134' });
  assert.equal(pending().length, 0, 'no check after the download');
  assert.deepEqual(seen, ['checking', 'idle', 'checking', 'downloading', 'ready']);
  assert.equal(updater.quitAndInstall(), true); assert.equal(squirrel.installs, 1);
});

test('a manual check reports the result; it never starts a second check while one runs', async () => {
  const { squirrel, updater } = harness();
  updater.start();
  const first = updater.check(), second = updater.check();
  assert.equal(squirrel.checks, 1, 'one request to Squirrel.Mac');
  squirrel.emit('update-not-available');
  assert.equal((await first).phase, 'idle'); assert.equal((await second).phase, 'idle');

  const found = updater.check();
  squirrel.emit('update-available');
  assert.equal((await found).phase, 'downloading', 'answered when the update is found, not after the download');
  assert.equal((await updater.check()).phase, 'downloading'); assert.equal(squirrel.checks, 2);

  squirrel.emit('error', new Error('network'));
  assert.equal(updater.state.phase, 'error');
  assert.equal(updater.quitAndInstall(), false, 'nothing to install');
  const retry = updater.check(); assert.equal(squirrel.checks, 3);
  squirrel.emit('error', new Error('offline'));
  assert.equal((await retry).phase, 'error');
});

test('after an error the next planned check runs; wake from sleep checks only when the last check is old', () => {
  const { squirrel, updater, pending, fire, advance } = harness();
  updater.start(); fire();
  squirrel.emit('error', new Error('offline'));
  assert.equal(pending()[0].ms, CHECK_INTERVAL_MS);
  updater.resumed();
  assert.equal(pending()[0].ms, CHECK_INTERVAL_MS, 'recent check: no extra check on wake');
  advance(RESUME_CHECK_AFTER_MS);
  updater.resumed();
  assert.equal(pending().length, 1); assert.equal(pending()[0].ms, 10_000);
  fire(); assert.equal(squirrel.checks, 2);
});

test('a throwing checkForUpdates becomes an error state, not an exception', async () => {
  const { squirrel, updater } = harness();
  squirrel.checkForUpdates = () => { throw new Error('Could not get code signature for running application'); };
  updater.start();
  assert.equal((await updater.check()).phase, 'error');
});

test('menu item and dialogs for each state', () => {
  const v = '0.1.133';
  assert.deepEqual(updateMenuItem({ phase: 'idle', version: v }), { label: 'Check for Updates…', enabled: true, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'checking', version: v }), { label: 'Checking for Updates…', enabled: false, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'downloading', version: v }), { label: 'Downloading Update…', enabled: false, action: 'check' });
  assert.deepEqual(updateMenuItem({ phase: 'ready', version: v, available: '0.1.134' }), { label: 'Restart to Update to 0.1.134', enabled: true, action: 'restart' });
  assert.equal(updateMenuItem({ phase: 'unsupported', version: v }).action, 'check');
  assert.equal(updateCheckDialog({ phase: 'idle', version: v }).message, 'Hermes is up to date.');
  const ready = updateCheckDialog({ phase: 'ready', version: v, available: '0.1.134' });
  assert.equal(ready.message, 'Hermes 0.1.134 is ready to install.'); assert.equal(ready.buttons[ready.restartButton], 'Restart Now');
  assert.match(updateCheckDialog({ phase: 'unsupported', version: v, reason: 'not-in-applications' }).message, /Applications folder/);
  assert.match(updateCheckDialog({ phase: 'error', version: v }).message, /could not check/);
  for (const phase of ['idle', 'checking', 'downloading', 'ready', 'error', 'unsupported']) {
    const text = JSON.stringify([updateMenuItem({ phase, version: v }), updateCheckDialog({ phase, version: v })]);
    assert.doesNotMatch(text, /squirrel|feed|http|sha|zip/i, 'no technical words in the menu or dialogs');
  }
});

test('main process: app menu keeps the default menus, the update runs after the quit sequence', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  for (const role of ['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']) {
    assert.ok(source.includes(`role: "${role}"`), role);
  }
  const quitEnd = source.slice(source.indexOf('app.on("before-quit"'));
  assert.ok(quitEnd.indexOf('shutdownPhase = "done"') < quitEnd.indexOf('updater.quitAndInstall()'), 'install only after the quit sequence');
  assert.match(source, /updater\.resumed\(\)/);
});
