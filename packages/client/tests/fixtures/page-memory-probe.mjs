// Controlled V8 probe with production SDK and synthetic HTTP/WS data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../../src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LivePageClient } = module.exports;
assert.equal(typeof globalThis.gc, 'function', 'run with --expose-gc');
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async fn => { const deadline = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < deadline); await tick(); } };
const heap = async () => { await tick(); globalThis.gc(); await tick(); globalThis.gc(); return process.memoryUsage().heapUsed; };
function fixture(total = 100) {
 const sockets = new Set(); let opened = 0, closed = 0;
 const client = new LivePageClient({ token: () => 'synthetic', onChange() {}, livenessMs: 10000,
  http: { async request(_method, path) {
   if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, history_latest: true, message_send_identity: true, open_session_live: true, multi_session_live: true } };
   if (path.startsWith('/v1/catalogue')) return { status: 200, body: { items: [{ kind: 'channel', value: { id: 'p', name: 'Synthetic' } }, ...['A', 'B'].map(id => ({ kind: 'session', value: { id, project_id: 'p', title: id, archived: false, running: false } }))], next_after: null } };
   const id = path.split('/')[3];
   if (path.endsWith('/live-state')) return { status: 200, body: { thread_id: id, active_receipts: [], pending_interactions: [] } };
   if (path.includes('/messages')) {
    const query = new URL('https://fixture.test' + path).searchParams, limit = Number(query.get('limit') ?? 100);
    let start = 1, end = total;
    if (query.has('latest')) start = Math.max(1, total - limit + 1);
    else if (query.has('before')) { end = Number(query.get('before')) - 1; start = Math.max(1, end - limit + 1); }
    else if (query.has('ref_seq')) start = end = Number(query.get('ref_seq'));
    else { start = Number(query.get('after') ?? (Number(query.get('after_ref_seq') ?? 0) + 1)); end = Math.min(total, start + limit - 1); }
    const rows = Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => ({ id: id + ':' + (start + i), ref_seq: start + i, role: 'assistant', text: id + ':' + (start + i) + ':' + 'x'.repeat(1024) }));
    return { status: 200, body: JSON.parse(JSON.stringify({ messages: rows, older_cursor: start > 1 ? String(start) : null, next_cursor: query.has('latest') || query.has('before') || query.has('ref_seq') || end === total ? null : String(end + 1), incomplete_turns: [], turn_outcomes: [] })) };
   }
   throw Error('unexpected ' + path);
  } }, socket: { async connect() {
   opened++; let listener, closeListener, dead = false; const pending = [];
   const socket = {
    emit(data) { if (dead) return; if (typeof data !== 'string') data = JSON.stringify(data); if (listener) listener(data); else pending.push(data); },
    onMessage(fn) { listener = fn; pending.splice(0).forEach(fn); }, onClose(fn) { closeListener = fn; },
    send(data) { queueMicrotask(() => socket.emit(data === 'ping' ? 'pong' : { ...JSON.parse(data), type: 'watching' })); },
    close() { if (dead) return; dead = true; closed++; sockets.delete(socket); const fn = closeListener; listener = null; closeListener = null; pending.length = 0; fn?.(); }
   };
   sockets.add(socket); queueMicrotask(() => socket.emit({ type: 'hello', protocol: 1, open_session_live: true, multi_session_live: true })); return socket;
  } } });
 return { client, sockets, get counts() { return { opened, closed, active: sockets.size }; } };
}
const f = fixture(), weak = []; await f.client.connect(); await until(() => f.client.isCatalogueReady);
const baseline = await heap(), samples = [];
for (let cycle = 1; cycle <= 50; cycle++) {
 let a = f.client.acquirePage('A'), b = f.client.acquirePage('B'); await Promise.all([a.openConversation('A'), b.openConversation('B')]);
 weak.push(new WeakRef(a), new WeakRef(b)); f.client.releasePage('B', b); f.client.releasePage('A', a); a = b = null;
 assert.equal(f.client.openedPageIds.length, 0); assert.equal(f.client.messages.size, 0); await until(() => f.sockets.size === 1);
 if (cycle === 10 || cycle === 25 || cycle === 50) samples.push({ cycles: cycle, heap_bytes: await heap() });
}
await heap(); const retained = weak.filter(ref => ref.deref()).length; assert.equal(retained, 0);
f.client.close(); assert.equal(f.sockets.size, 0); assert.equal(f.counts.opened, f.counts.closed);
const g = fixture(2000); await g.client.connect(); await until(() => g.client.isCatalogueReady); const historyBaseline = await heap();
let a = g.client.acquirePage('A'), b = g.client.acquirePage('B'); await Promise.all([a.openConversation('A'), b.openConversation('B')]);
await Promise.all([a.loadFullHistory('A'), b.loadFullHistory('B')]); assert.equal(a.messages.get('A').length, 2000); assert.equal(b.messages.get('B').length, 2000);
const loadedHeap = await heap(); g.client.releasePage('A', a); g.client.releasePage('B', b); a = b = null; const releasedHeap = await heap();
assert.equal(g.client.messages.size, 0); assert.ok(releasedHeap - historyBaseline < 2 * 1024 * 1024, 'released synthetic histories must not remain retained');
g.client.close();
console.log(JSON.stringify({ synthetic_data: true, cycles: 50, page_instances: 100, retained_page_weakrefs: retained, baseline_heap_bytes: baseline, samples, sockets: f.counts, full_history: { rows: 4000, baseline_heap_bytes: historyBaseline, loaded_heap_bytes: loadedHeap, released_heap_bytes: releasedHeap } }, null, 2));
