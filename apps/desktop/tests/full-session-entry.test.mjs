import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { build } from 'esbuild';
const root = new URL('..', import.meta.url).pathname;
const bundle = await build({ stdin: { resolveDir: root, contents: `export {DesktopConnectionService} from './src/main/connection-service'; export {mainTransport} from './src/main/transport'; export {LivePageClient} from '../../packages/client/src/livePages';` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { DesktopConnectionService, mainTransport, LivePageClient } = mod.exports;
const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('desktop service and real HTTP/WS transport open complete history above 64 KiB without pagination', { timeout: 15000 }, async () => {
  const paths = [], watches = new Map();
  const records = Array.from({ length: 250 }, (_, i) => ({ id: 'm' + i, ref_seq: i * 2 + 1, role: 'assistant', text: 'Controlled synthetic history '.repeat(20) + i }));
  const server = createServer((req, res) => {
    paths.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer synthetic-only');
    const send = body => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/v1/capabilities') return send({ protocol: 1, durable_sync: true, history_full: true, history_latest: true, open_session_live: true, multi_session_live: true });
    if (req.url.startsWith('/v1/catalogue')) return send({ items: [{ kind: 'channel', value: { id: 'p', name: 'Fixture' } }, { kind: 'session', value: { id: 'A', project_id: 'p', title: 'A', archived: false, running: false } }], next_after: null });
    if (req.url === '/v1/threads/A/messages?full=true') return send({ messages: records, receipts: [], complete: true, older_cursor: null, next_cursor: null, incomplete_turns: [], turn_outcomes: [] });
    if (req.url === '/v1/threads/A/live-state') return send({ thread_id: 'A', active_receipts: [], pending_interactions: [] });
    res.writeHead(404); res.end();
  });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'hello', protocol: 1, open_session_live: true, multi_session_live: true }));
    socket.on('message', bytes => {
      const value = bytes.toString();
      if (value === 'ping') { socket.send('pong'); return; }
      const command = JSON.parse(value);
      if (!command.thread_id || command.mode === 'remove') return;
      watches.set(command.thread_id, { socket, request_id: command.request_id });
      socket.send(JSON.stringify({ ...command, type: 'watching' }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const service = new DesktopConnectionService(() => {});
  const base = 'http://127.0.0.1:' + server.address().port;
  const client = new LivePageClient({ ...mainTransport(base, true), token: () => 'synthetic-only', livenessMs: 1000, onChange: () => service.changed() });
  service.client = client; service.phase = 'connected'; service.connectionState = 'online'; service.connection = { id: 'a'.repeat(24), baseUrl: base };
  try {
    await client.connect(); await until(() => client.isCatalogueReady);
    await service.selectThread('A');
    let snapshot = service.snapshot();
    assert.equal(snapshot.messages.length, 250); assert.equal(snapshot.messages[0].refSeq, 1);
    assert.equal(snapshot.loadingMessages, false); assert.equal(snapshot.canLoadOlder, false);
    assert.equal(paths.filter(path => path.includes('/messages')).length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(records)) > 65536);
    const count = paths.length; await service.selectThread('A'); await service.loadOlder(); assert.equal(paths.length, count);
    records.push({ id: 'last', ref_seq: 501, role: 'assistant', text: 'Live result' });
    const watch = watches.get('A'); watch.socket.send(JSON.stringify({ type: 'conversation_changed', thread_id: 'A', request_id: watch.request_id }));
    await until(() => service.snapshot().messages.length === 251);
    assert.ok(paths.filter(path => path.includes('/messages')).every(path => path.endsWith('?full=true')));
    service.closeSessionPage('A'); assert.equal(client.messages.size, 0);
    await service.selectThread('A'); snapshot = service.snapshot(); assert.equal(snapshot.messages.length, 251); assert.equal(snapshot.canLoadOlder, false);
  } finally {
    service.close(); for (const socket of ws.clients) socket.terminate();
    await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => server.close(resolve));
  }
});
