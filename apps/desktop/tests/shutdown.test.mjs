// Graceful shutdown building blocks: the step runner and the WebSocket close wait (real local ws server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer, default: WebSocket } = await import('ws');

const load = async (entry, external = []) => {
  const folder = await mkdtemp(join(tmpdir(), 'hermes-shutdown-'));
  const out = await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ws', ...external],
    // The step runner module imports electron only for the window helpers; the runner itself does not use it.
    plugins: [{ name: 'electron-stub', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={}', loader: 'js' })); } }] });
  const file = join(folder, 'module.cjs'); await writeFile(file, out.outputFiles[0].text);
  try { return require(file); } finally { await rm(folder, { recursive: true, force: true }); }
};

test('shutdown steps run in order; a slow step is abandoned at its limit and a failing step does not stop the rest', async () => {
  const { runShutdown } = await load('../src/main/shutdown.ts');
  const order = [];
  const records = await runShutdown([
    { name: 'first', timeoutMs: 500, run: async () => { order.push('first'); return { ok: true }; } },
    { name: 'slow', timeoutMs: 50, run: () => new Promise(resolve => setTimeout(() => { order.push('slow-late'); resolve(); }, 300)) },
    { name: 'fails', timeoutMs: 500, run: () => { order.push('fails'); throw new Error('boom'); } },
    { name: 'last', timeoutMs: 500, run: () => { order.push('last'); } },
  ]);
  assert.deepEqual(records.map(r => [r.name, r.outcome]), [['first', 'done'], ['slow', 'timeout'], ['fails', 'failed'], ['last', 'done']]);
  assert.equal(records[0].detail, '{"ok":true}'); assert.equal(records[2].detail, 'boom');
  assert.ok(records[1].ms >= 45 && records[1].ms < 250, JSON.stringify(records[1]));
  assert.deepEqual(order, ['first', 'fails', 'last']);
});

test('socketsClosed waits for real WebSocket close handshakes and reports a socket that does not finish', async () => {
  const { trackSocket, socketsClosed, openSocketCount } = await load('../src/main/socket-registry.ts');
  assert.equal(await socketsClosed(10), true, 'nothing open');
  const server = new WebSocketServer({ port: 0 });
  server.on('connection', socket => socket.on('close', () => {}));
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port;
  const open = () => new Promise(resolve => { const ws = trackSocket(new WebSocket(url)); ws.once('open', () => resolve(ws)); });
  const a = await open(), b = await open();
  assert.equal(openSocketCount(), 2);
  a.close(); b.close();
  assert.equal(await socketsClosed(2000), true, 'both close handshakes finished');
  assert.equal(openSocketCount(), 0);
  // A socket whose close never finishes (a stand-in that never emits close): the wait ends at its limit and says so.
  const { EventEmitter } = await import('node:events');
  const stuck = trackSocket(new EventEmitter());
  const started = Date.now();
  assert.equal(await socketsClosed(150), false);
  assert.ok(Date.now() - started >= 140);
  stuck.emit('close'); assert.equal(await socketsClosed(100), true);
  for (const client of server.clients) client.terminate();
  await new Promise(resolve => server.close(resolve));
});
