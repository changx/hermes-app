import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [new URL('../src/main/mac-control.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, mod, mod.exports);
const { MacDriver, macRequest, cleanOutput } = mod.exports;

// A stand-in for the cua-driver CLI: records argv, needs a "running daemon" marker, writes a screenshot file.
const FAKE = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$1" in
  list-tools) echo "click - Click an element"; exit 0;;
  describe) echo "schema for $2"; exit 0;;
  status) [ -f "$FAKE_STATE/up" ] && exit 0; exit 1;;
  call)
    shot="$3"; tool="$4"; json="$5"
    if [ ! -f "$FAKE_STATE/up" ]; then echo "no daemon" >&2; exit 2; fi
    case "$tool" in
      fail) echo "stale element_token" >&2; exit 3;;
      slow) exec sleep 10;;
      get_window_state) printf 'PNG' > "$shot"; echo "[1] AXButton OK $json";;
      big) head -c 5000 /dev/zero | tr '\\0' 'A'; echo " tail";;
      *) echo "ok $tool $json";;
    esac;;
esac
`;

function setup({ up = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mac-control-'));
  const exe = join(dir, 'cua-driver');
  writeFileSync(exe, FAKE); chmodSync(exe, 0o755);
  process.env.FAKE_LOG = join(dir, 'log'); process.env.FAKE_STATE = dir;
  if (up) writeFileSync(join(dir, 'up'), '');
  const scratch = join(dir, 'scratch'); require('node:fs').mkdirSync(scratch);
  let starts = 0;
  const driver = new MacDriver({
    candidates: [join(dir, 'missing'), exe], platform: 'darwin', scratch,
    encodeImage: path => readFileSync(path, 'utf8') === 'PNG' ? { jpegBase64: 'SlBFRw==', width: 640, height: 480 } : undefined,
    startDaemon: async () => { starts++; writeFileSync(join(dir, 'up'), ''); },
  });
  const log = () => existsSync(process.env.FAKE_LOG) ? readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n') : [];
  return { dir, exe, scratch, driver, log, starts: () => starts };
}
const signal = () => new AbortController().signal;

test('availability: only on macOS and only when a driver executable exists', () => {
  const h = setup();
  assert.equal(h.driver.available(), true);
  assert.equal(h.driver.executable(), h.exe);
  assert.equal(new MacDriver({ candidates: [h.exe], platform: 'linux' }).available(), false);
  assert.equal(new MacDriver({ candidates: [join(h.dir, 'nothing')], platform: 'darwin' }).available(), false);
});

test('requests are validated before anything runs', () => {
  assert.deepEqual(macRequest({ tool: 'click', arguments: { pid: 1 } }), { tool: 'click', input: { pid: 1 } });
  assert.deepEqual(macRequest({ tool: 'list_apps' }), { tool: 'list_apps', input: {} });
  for (const bad of [{}, { tool: 'Click' }, { tool: 'rm -rf' }, { tool: 'click', arguments: [1] }, { tool: 'type_text', arguments: { text: 'x'.repeat(100_001) } }]) {
    assert.throws(() => macRequest(bad), /tool|arguments/);
  }
});

test('a call runs one driver tool with JSON arguments and returns its output and screenshot', async () => {
  const h = setup();
  const result = await h.driver.run({ tool: 'get_window_state', arguments: { pid: 42, window_id: 7 } }, signal(), 5000);
  assert.equal(result.output, '[1] AXButton OK {"pid":42,"window_id":7}');
  assert.deepEqual([result.jpeg_base64, result.image_width, result.image_height], ['SlBFRw==', 640, 480]);
  const [line] = h.log();
  assert.match(line, /^call --screenshot-out-file \S+hermes-mac-[\w-]+\.png get_window_state \{"pid":42,"window_id":7\}$/);
  assert.deepEqual(readdirSync(h.scratch), [], 'the screenshot file is removed');
  const plain = await h.driver.run({ tool: 'list_apps' }, signal(), 5000);
  assert.deepEqual(plain, { output: 'ok list_apps {}' }, 'no screenshot, no image fields');
});

test('list_tools and describe use the driver CLI help commands', async () => {
  const h = setup();
  assert.deepEqual(await h.driver.run({ tool: 'list_tools' }, signal(), 5000), { output: 'click - Click an element' });
  assert.deepEqual(await h.driver.run({ tool: 'describe', arguments: { tool: 'click' } }, signal(), 5000), { output: 'schema for click' });
  await assert.rejects(h.driver.run({ tool: 'describe', arguments: {} }, signal(), 5000), { code: 'invalid' });
  assert.deepEqual(h.log(), ['list-tools', 'describe click']);
});

test('driver errors reach the Agent; long binary output is removed', async () => {
  const h = setup();
  await assert.rejects(h.driver.run({ tool: 'fail' }, signal(), 5000), error => error.code === 'driver_error' && error.message === 'stale element_token');
  assert.equal(h.starts(), 0, 'a running daemon is not restarted after a tool error');
  assert.equal((await h.driver.run({ tool: 'big' }, signal(), 5000)).output, '[binary data omitted] tail');
  assert.equal(cleanOutput('x'.repeat(130_000).replace(/x/g, 'x ')).endsWith('[output truncated]'), true);
});

test('a stopped daemon is started once and the call runs again', async () => {
  const h = setup({ up: false });
  assert.deepEqual(await h.driver.run({ tool: 'list_apps' }, signal(), 5000), { output: 'ok list_apps {}' });
  assert.equal(h.starts(), 1);
  assert.deepEqual(h.log().map(line => line.split(' ')[0]), ['call', 'status', 'call']);
});

test('cancel and timeout stop the driver process', async () => {
  const h = setup();
  const abort = new AbortController();
  const running = h.driver.run({ tool: 'slow' }, abort.signal, 5000);
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(running, { code: 'cancelled' });
  const started = Date.now();
  await assert.rejects(h.driver.run({ tool: 'slow' }, signal(), 300), { code: 'unknown' });
  assert.ok(Date.now() - started < 3000);
});

test('no driver installed is reported plainly', async () => {
  const driver = new MacDriver({ candidates: ['/nonexistent/cua-driver'], platform: 'darwin' });
  await assert.rejects(driver.run({ tool: 'list_apps' }, signal(), 1000), { code: 'no_driver' });
});
