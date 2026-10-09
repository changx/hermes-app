import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [new URL('../src/main/mac-control.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, mod, mod.exports);
const { MacDriver, macRequest, cleanOutput, resultText } = mod.exports;

// A stand-in for `cua-driver mcp`: newline JSON-RPC over stdio, with window snapshots that live
// only inside one session, like the real driver.
const FAKE = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.FAKE_LOG, 'start ' + process.argv.slice(2).join(' ') + '\\n');
let snapshot = null, n = 0, buf = '';
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
const ok = (id, content, structured, isError) => send({ id, result: { content, ...(structured ? { structuredContent: structured } : {}), ...(isError ? { isError: true } : {}) } });
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, (m.method || '') + (m.params && m.params.name ? ' ' + m.params.name : '') + '\\n');
    if (m.id === undefined) continue;
    if (m.method === 'initialize') { if (process.env.FAKE_BROKEN) process.exit(3); send({ id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'cua-driver' }, capabilities: {} } }); continue; }
    if (m.method === 'tools/list') { send({ id: m.id, result: { tools: [{ name: 'click', description: 'Click an element.\\nMore.', inputSchema: { type: 'object' } }, { name: 'list_apps', description: 'List apps.' }] } }); continue; }
    const { name, arguments: a } = m.params;
    if (name === 'get_window_state') { snapshot = 's' + (++n); ok(m.id, [{ type: 'text', text: 'tree' }, { type: 'image', mimeType: 'image/png', data: Buffer.from('PNG').toString('base64') }], { snapshot_id: snapshot, elements: [{ element_token: snapshot + ':1', label: 'OK' }] }); }
    else if (name === 'click') {
      if (!snapshot || a.element_token !== snapshot + ':1') ok(m.id, [{ type: 'text', text: 'stale' }], { status: 'refused', refusal: { code: 'stale_element_token' } }, true);
      else ok(m.id, [{ type: 'text', text: 'Clicked OK' }], { effect: 'pressed' });
    }
    else if (name === 'slow') { /* never answers */ }
    else if (name === 'crash') process.exit(1);
    else if (name === 'big') ok(m.id, [{ type: 'text', text: 'A'.repeat(5000) + ' tail' }]);
    else ok(m.id, [{ type: 'text', text: 'ok ' + name + ' ' + JSON.stringify(a) }]);
  }
});
`;

function setup(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mac-control-'));
  const exe = join(dir, 'cua-driver');
  writeFileSync(exe, FAKE); chmodSync(exe, 0o755);
  process.env.FAKE_LOG = join(dir, 'log');
  delete process.env.FAKE_BROKEN; Object.assign(process.env, env);
  const driver = new MacDriver({
    candidates: [join(dir, 'missing'), exe], platform: 'darwin',
    encodeImage: png => png.toString() === 'PNG' ? { jpegBase64: 'SlBFRw==', width: 640, height: 480 } : undefined,
  });
  const log = () => existsSync(process.env.FAKE_LOG) ? readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n') : [];
  return { dir, exe, driver, log };
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

test('one session: a window read is followed by a click on its element token', async () => {
  const h = setup();
  try {
    const state = await h.driver.run({ tool: 'get_window_state', arguments: { pid: 42, window_id: 7 } }, signal(), 5000);
    assert.deepEqual([state.jpeg_base64, state.image_width, state.image_height], ['SlBFRw==', 640, 480]);
    const structured = JSON.parse(state.output);
    assert.equal(structured.elements[0].element_token, 's1:1', 'the structured result (with tokens) is what the Agent reads');
    const click = await h.driver.run({ tool: 'click', arguments: { pid: 42, element_token: 's1:1' } }, signal(), 5000);
    assert.deepEqual(JSON.parse(click.output), { effect: 'pressed' });
    assert.equal(click.jpeg_base64, undefined, 'no screenshot, no image fields');
    assert.equal(h.log().filter(line => line.startsWith('start')).length, 1, 'one driver process serves every call');
    assert.deepEqual(h.log().filter(line => !line.startsWith('start')), ['initialize', 'notifications/initialized', 'tools/call get_window_state', 'tools/call click']);
  } finally { h.driver.close(); }
});

test('driver refusals reach the Agent; long binary output is removed', async () => {
  const h = setup();
  try {
    await assert.rejects(h.driver.run({ tool: 'click', arguments: { pid: 1, element_token: 'old:1' } }, signal(), 5000),
      error => error.code === 'driver_error' && JSON.parse(error.message).refusal.code === 'stale_element_token');
    assert.equal((await h.driver.run({ tool: 'big' }, signal(), 5000)).output, '[binary data omitted] tail');
    assert.equal(cleanOutput('x '.repeat(130_000)).endsWith('[output truncated]'), true);
    assert.equal(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }), 'a\nb');
  } finally { h.driver.close(); }
});

test('list_tools and describe read the session tool list', async () => {
  const h = setup();
  try {
    assert.deepEqual(await h.driver.run({ tool: 'list_tools' }, signal(), 5000), { output: 'click: Click an element.\nlist_apps: List apps.' });
    assert.match((await h.driver.run({ tool: 'describe', arguments: { tool: 'click' } }, signal(), 5000)).output, /^name: click\n\ndescription:\nClick an element\.\nMore\.\n\ninput schema:\n/);
    await assert.rejects(h.driver.run({ tool: 'describe', arguments: { tool: 'nothing' } }, signal(), 5000), { code: 'invalid' });
  } finally { h.driver.close(); }
});

test('cancel stops waiting; a timeout or a crash replaces the session', async () => {
  const h = setup();
  try {
    const abort = new AbortController();
    const running = h.driver.run({ tool: 'slow' }, abort.signal, 5000);
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(running, { code: 'cancelled' });
    // The fake driver writes its log from another process; under full-suite load that can take more than 200 ms.
    for (const end = Date.now() + 5000; !h.log().includes('notifications/cancelled') && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(h.log().includes('notifications/cancelled'), 'the driver is told about the cancel');
    assert.match((await h.driver.run({ tool: 'list_apps' }, signal(), 5000)).output, /^ok list_apps/, 'the session survives a cancel');
    await assert.rejects(h.driver.run({ tool: 'slow' }, signal(), 300), { code: 'unknown' });
    await assert.rejects(h.driver.run({ tool: 'crash' }, signal(), 5000), { code: 'unknown' });
    assert.match((await h.driver.run({ tool: 'list_apps' }, signal(), 5000)).output, /^ok list_apps/);
    assert.equal(h.log().filter(line => line.startsWith('start')).length, 3, 'a new session after the timeout and after the crash');
  } finally { h.driver.close(); }
});

test('a driver that cannot start, or no driver at all, is reported plainly', async () => {
  const h = setup({ FAKE_BROKEN: '1' });
  try { await assert.rejects(h.driver.run({ tool: 'list_apps' }, signal(), 5000), { code: 'no_driver' }); }
  finally { h.driver.close(); delete process.env.FAKE_BROKEN; }
  const driver = new MacDriver({ candidates: ['/nonexistent/cua-driver'], platform: 'darwin' });
  await assert.rejects(driver.run({ tool: 'list_apps' }, signal(), 1000), { code: 'no_driver' });
});
