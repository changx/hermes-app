import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LivePageClient } = module.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => { const end = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < end, 'condition timed out'); await tick(); } };

// One account, one Thread A. `changedRefs` is the server capability; `failRefs` makes a refs read fail.
function fixture({ changedRefs = true } = {}) {
  const sockets = [], reads = [], rows = { A: [1, 2, 3].map(n => ({ id: 'a' + n, ref_seq: n, role: 'assistant', text: 'row ' + n })) };
  let failRefs = false;
  const sdk = new LivePageClient({ token: () => 'synthetic', livenessMs: 50, backoffMs: [5],
    http: { async request(method, path) {
      if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, history_latest: true, history_full: true, open_session_live: true, ...(changedRefs ? { changed_refs: true } : {}) } };
      if (path.startsWith('/v1/catalogue')) return { status: 200, body: { items: [{ kind: 'channel', value: { id: 'p', name: 'P' } }, { kind: 'session', value: { id: 'A', project_id: 'p', title: 'A', archived: false, running: true } }], next_after: null } };
      if (path.endsWith('/live-state')) return { status: 200, body: { thread_id: 'A', active_receipts: [], pending_interactions: [] } };
      if (path.includes('/messages')) {
        const query = new URL('https://fixture.test' + path).searchParams;
        if (query.has('refs')) {
          reads.push('refs:' + query.get('refs'));
          if (failRefs) return { status: 500, body: {} };
          const wanted = new Set(query.get('refs').split(',').map(Number));
          return { status: 200, body: { messages: rows.A.filter(row => wanted.has(row.ref_seq)), next_cursor: null, older_cursor: null, incomplete_turns: [], turn_outcomes: [] } };
        }
        assert.equal(query.get('full'), 'true');
        reads.push('full');
        return { status: 200, body: { messages: rows.A, complete: true, older_cursor: null, next_cursor: null, incomplete_turns: [], turn_outcomes: [] } };
      }
      throw new Error('unexpected ' + method + ' ' + path);
    } },
    socket: { async connect() {
      let listener, closeListener, closed = false; const pending = [], watches = new Map();
      const socket = { watches, get closed() { return closed; },
        emit(frame) { const data = typeof frame === 'string' ? frame : JSON.stringify(frame); if (listener) listener(data); else pending.push(data); },
        onMessage(fn) { listener = fn; pending.splice(0).forEach(fn); }, onClose(fn) { closeListener = fn; },
        send(data) { if (data === 'ping') { queueMicrotask(() => this.emit('pong')); return; } const command = JSON.parse(data); if (command.mode === 'remove') { watches.delete(command.thread_id); return; } if (!command.mode) watches.clear(); if (command.thread_id) watches.set(command.thread_id, command.request_id); queueMicrotask(() => this.emit({ ...command, type: 'watching' })); },
        close() { if (!closed) { closed = true; closeListener?.(); } } };
      sockets.push(socket); queueMicrotask(() => socket.emit({ type: 'hello', protocol: 1, open_session_live: true, multi_session_live: true })); return socket;
    } } });
  const live = () => sockets.find(s => !s.closed && s.watches.has('A'));
  const changed = refs => live().emit({ type: 'conversation_changed', thread_id: 'A', request_id: live().watches.get('A'), ...(refs ? { refs } : {}) });
  const stopped = () => live().emit({ type: 'session_state', thread_id: 'A', running: false });
  return { sdk, rows, reads, changed, stopped, failRefs: value => { failRefs = value; } };
}
async function open(f) {
  await f.sdk.connect(); await until(() => f.sdk.isCatalogueReady);
  const page = f.sdk.acquirePage('A'); await page.openConversation('A');
  await until(() => f.reads.length === 1);
  return page;
}

test('battery: a named change reads only those rows; other rows keep their objects', async () => {
  const f = fixture();
  try {
    const page = await open(f);
    assert.deepEqual(f.reads, ['full']);
    const [first, second] = page.messages.get('A');
    f.rows.A = [...f.rows.A.slice(0, 2), { ...f.rows.A[2], text: 'row 3 updated' }, { id: 'a4', ref_seq: 4, role: 'assistant', text: 'row 4' }];
    f.changed([4, 3]);
    await until(() => page.messages.get('A').length === 4);
    assert.deepEqual(f.reads, ['full', 'refs:3,4']);
    const now = page.messages.get('A');
    assert.deepEqual(now.map(m => m.text), ['row 1', 'row 2', 'row 3 updated', 'row 4']);
    assert.equal(now[0], first); assert.equal(now[1], second);
  } finally { f.sdk.close(); }
});

test('battery: a stopped turn, an unnamed change and a reconnect read the whole history', async () => {
  const f = fixture();
  try {
    const page = await open(f);
    f.stopped();
    await until(() => f.reads.length === 2);
    f.changed();
    await until(() => f.reads.length === 3);
    f.sdk.suspendConnection(); await f.sdk.connect();
    await until(() => f.reads.length === 4);
    assert.deepEqual(f.reads, ['full', 'full', 'full', 'full']);
    assert.equal(page.messages.get('A').length, 3);
  } finally { f.sdk.close(); }
});

test('battery: a failed named read falls back to the whole history', async () => {
  const f = fixture();
  try {
    const page = await open(f);
    f.rows.A = [...f.rows.A, { id: 'a4', ref_seq: 4, role: 'assistant', text: 'row 4' }];
    f.failRefs(true); f.changed([4]);
    await until(() => page.messages.get('A').length === 4);
    assert.deepEqual(f.reads, ['full', 'refs:4', 'full']);
    assert.equal(f.sdk.connectionState, 'online');
  } finally { f.sdk.close(); }
});

test('battery: without the changed_refs capability named changes still read the whole history', async () => {
  const f = fixture({ changedRefs: false });
  try {
    const page = await open(f);
    f.rows.A = [...f.rows.A, { id: 'a4', ref_seq: 4, role: 'assistant', text: 'row 4' }];
    f.changed([4]);
    await until(() => page.messages.get('A').length === 4);
    assert.deepEqual(f.reads, ['full', 'full']);
  } finally { f.sdk.close(); }
});

test('battery: invalid refs in a frame are a protocol error', async () => {
  const { parseLiveFrame } = await import('data:text/javascript,' + encodeURIComponent((await build({ entryPoints: [new URL('../src/liveProtocol.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false })).outputFiles[0].text));
  const base = { type: 'conversation_changed', thread_id: 'A', request_id: '1' };
  assert.deepEqual(parseLiveFrame({ ...base, refs: [2, 5] }), { ...base, refs: [2, 5] });
  assert.deepEqual(parseLiveFrame(base), base);
  for (const refs of [[0], ['1'], [1.5], 'x', Array.from({ length: 201 }, (_, i) => i + 1)]) assert.throws(() => parseLiveFrame({ ...base, refs }));
});
