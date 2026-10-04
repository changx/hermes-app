import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({ stdin: { resolveDir: new URL('../../..', import.meta.url).pathname, contents: `export * from './packages/client/src/sessionLabels'; export * from './packages/client/src/liveProtocol'; export * from './packages/client/src/livePages';` }, bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { labelGraphemes, validateLabels, labelTimestamp, parseCatalogue, labelCandidates, matchesLabels, emptyLabelFilter, LivePageClient } = mod.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async fn => { const end = Date.now() + 3000; while (!fn()) { assert.ok(Date.now() < end, 'timed out'); await tick(); } };
const deferred = () => { let resolve; return { promise: new Promise(r => resolve = r), resolve: value => resolve(value) }; };
const session = (id = 'A', labels = [], time = 0) => ({ kind: 'session', value: { id, project_id: 'p', title: id, archived: false, running: false, markers: labels, markers_updated_at: time } });

test('Unicode 17: all 766 official grapheme boundaries and emoji sequence limits', async () => {
  const cases = JSON.parse(await readFile(new URL('./grapheme-cases.json', import.meta.url), 'utf8'));
  assert.equal(cases.length, 766);
  for (const groups of cases) assert.deepEqual(labelGraphemes(groups.join('')), groups);
  for (const emoji of ['👩🏽‍💻', '🇨🇳', '👨‍👩‍👧‍👦', '1️⃣', 'e\u0301', 'क्\u200dष', '🏴\u{e0067}\u{e0062}\u{e007f}']) {
    assert.deepEqual(validateLabels([emoji.repeat(30)]), [emoji.repeat(30)]);
    assert.throws(() => validateLabels([emoji.repeat(31)]));
  }
});
test('label validation preserves exact text, bounds resources, rejects duplicates and invalid times', () => {
  assert.deepEqual(validateLabels([' Foo ', 'Foo', 'foo', 'é', 'e\u0301']), [' Foo ', 'Foo', 'foo', 'é', 'e\u0301']);
  for (const value of [['x', 'x'], [' '], ['\u3000'], ['a\n'], ['x\u202e'], ['\ud800'], ['a' + '\u0301'.repeat(1024)], Array.from({ length: 11 }, (_, i) => String(i)), new Array(1), 'x', [1], null]) assert.throws(() => validateLabels(value));
  for (const value of [true, -1, .5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) assert.throws(() => labelTimestamp(value));
  assert.equal(labelTimestamp(0), 0); assert.equal(labelTimestamp(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});
test('catalogue optional fields default together and invalid presence fails strictly', () => {
  const old = session(); delete old.value.markers; delete old.value.markers_updated_at;
  assert.deepEqual(parseCatalogue({ items: [old], next_after: null }).items[0].value.markers, []);
  assert.equal(parseCatalogue({ items: [old], next_after: null }).items[0].value.markers_updated_at, 0);
  for (const patch of [{ markers: [] }, { markers_updated_at: 1 }, { markers: null, markers_updated_at: 1 }, { markers: ['x', 'x'], markers_updated_at: 1 }, { markers: ['x'], markers_updated_at: -1 }]) assert.throws(() => parseCatalogue({ items: [{ ...old, value: { ...old.value, ...patch } }], next_after: null }));
});
test('filter uses OR and exact text, distinct No labels flag and unique candidates', () => {
  const rows = [{ markers: ['Foo', 'foo', 'é'] }, { markers: ['Foo', 'e\u0301'] }, {}];
  assert.equal(labelCandidates(rows).length, 4);
  assert.equal(matchesLabels(['foo'], { labels: ['Foo'], noLabels: false }), false);
  assert.equal(matchesLabels(['foo'], { labels: ['Foo', 'foo'], noLabels: false }), true);
  assert.equal(matchesLabels([], { labels: ['Foo'], noLabels: true }), true);
  assert.equal(matchesLabels(['No labels'], { labels: [], noLabels: true }), false);
  assert.equal(matchesLabels(['anything'], emptyLabelFilter()), true);
});

function fixture({ capability = true, request: intercept } = {}) {
  const paths = [], sockets = [];
  let items = [{ kind: 'channel', value: { id: 'p', name: 'P' } }, session('A'), session('B')];
  const sdk = new LivePageClient({ token: () => 'synthetic', livenessMs: 10000, backoffMs: [10], http: { async request(method, path, token, body, signal) {
    paths.push({ method, path, body });
    const reply = await intercept?.({ method, path, body, signal }); if (reply) return reply;
    if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, durable_sync: true, open_session_live: true, multi_session_live: true, history_latest: true, session_labels: capability } };
    if (path.startsWith('/v1/catalogue')) return { status: 200, body: { items, next_after: null } };
    const id = decodeURIComponent(path.split('/')[3]), row = items.find(i => i.kind === 'session' && i.value.id === id)?.value;
    if (path.endsWith('/labels')) {
      if (!row) return { status: 404, body: {} };
      if (method === 'PUT' && body.markers_updated_at > row.markers_updated_at) Object.assign(row, body);
      return { status: 200, body: { thread_id: id, project_id: row.project_id, markers: row.markers, markers_updated_at: row.markers_updated_at } };
    }
    if (path.includes('/messages')) return { status: 200, body: { messages: [{ id: 'm1', ref_seq: 1, role: 'assistant', text: 'Synthetic fixture' }], older_cursor: null, next_cursor: null, incomplete_turns: [], turn_outcomes: [] } };
    if (path.endsWith('/live-state')) return { status: 200, body: { thread_id: id, active_receipts: [], pending_interactions: [] } };
    throw Error('Unexpected route');
  } }, socket: { async connect() {
    let message, close;
    const pending = [], socket = { emit(value) { const data = JSON.stringify(value); if (message) message(data); else pending.push(data); }, onMessage(fn) { message = fn; pending.splice(0).forEach(fn); }, onClose(fn) { close = fn; }, close() { close?.(); }, send(data) { if (data === 'ping') return; queueMicrotask(() => socket.emit({ ...JSON.parse(data), type: 'watching' })); } };
    sockets.push(socket); queueMicrotask(() => socket.emit({ type: 'hello', protocol: 1, open_session_live: true, multi_session_live: true })); return socket;
  } } });
  return { sdk, paths, sockets, items, setItems(value) { items = value; } };
}
async function ready(f) { await f.sdk.connect(); await until(() => f.sdk.connectionState === 'online'); }

test('save validates PUT and authoritative readback, then catalogue; no unopened body fetch or optimistic labels', async () => {
  const f = fixture(); try {
    await ready(f); f.paths.length = 0;
    const saved = await f.sdk.saveThreadLabels('A', ['Exact 👩🏽‍💻'], 10);
    assert.deepEqual(saved.markers, ['Exact 👩🏽‍💻']);
    assert.deepEqual(f.paths.map(p => [p.method, p.path]), [['PUT', '/v1/threads/A/labels'], ['GET', '/v1/threads/A/labels'], ['GET', '/v1/catalogue?limit=30']]);
    assert.deepEqual(f.sdk.threads.get('A').markers, saved.markers); assert.equal(f.sdk.messages.size, 0);
    // A smaller catalogue timestamp is adopted directly; clients do not merge times.
    f.setItems([{ kind: 'channel', value: { id: 'p', name: 'P' } }, session('A', ['Authority'], 1)]);
    await f.sdk.snapshot(); assert.deepEqual(f.sdk.threads.get('A').markers, ['Authority']);
  } finally { f.sdk.close(); }
});
test('capability, offline, unavailable, and validation gates reject before transport', async () => {
  const f = fixture({ capability: false }); try {
    await ready(f); const count = f.paths.length;
    await assert.rejects(f.sdk.saveThreadLabels('A', [], 1)); assert.equal(f.paths.length, count);
    f.sdk.supportsSessionLabels = true;
    await assert.rejects(f.sdk.saveThreadLabels('missing', [], 1));
    await assert.rejects(f.sdk.saveThreadLabels('A', ['x', 'x'], 1));
    await assert.rejects(f.sdk.saveThreadLabels('A', [], true));
    f.sdk.suspendConnection(); await assert.rejects(f.sdk.saveThreadLabels('A', [], 1));
    assert.equal(f.paths.length, count);
  } finally { f.sdk.close(); }
});
for (const stage of ['PUT', 'readback', 'catalogue']) test(`failed ${stage} does not replace labels with a local proposal`, async () => {
  let failing = false;
  const f = fixture({ request: ({ method, path }) => failing && (stage === 'PUT' && method === 'PUT' || stage === 'readback' && method === 'GET' && path.endsWith('/labels') || stage === 'catalogue' && path.includes('/catalogue')) ? { status: 500, body: {} } : undefined });
  try { await ready(f); const draft = ['Draft']; failing = true; await assert.rejects(f.sdk.saveThreadLabels('A', draft, 10)); assert.deepEqual(draft, ['Draft']); assert.deepEqual(f.sdk.threads.get('A').markers, []); }
  finally { f.sdk.close(); }
});
for (const stage of ['PUT', 'GET']) test(`exact identity validation on ${stage} rejects a foreign label detail`, async () => {
  const f = fixture({ request: ({ method, path }) => path.endsWith('/labels') && method === stage ? { status: 200, body: { thread_id: 'B', project_id: 'p', markers: ['Foreign'], markers_updated_at: 10 } } : undefined });
  try { await ready(f); await assert.rejects(f.sdk.saveThreadLabels('A', ['Draft'], 10), /target mismatch/); assert.deepEqual(f.sdk.threads.get('A').markers, []); }
  finally { f.sdk.close(); }
});
test('equal/stale writes return authority; duplicate submission and delayed identity changes are fenced', async () => {
  let gate;
  const f = fixture({ request: async ({ method }) => { if (method === 'PUT' && gate) await gate.promise; } });
  try {
    await ready(f); await f.sdk.saveThreadLabels('A', ['First'], 10);
    assert.deepEqual((await f.sdk.saveThreadLabels('A', ['Older'], 9)).markers, ['First']);
    assert.deepEqual((await f.sdk.saveThreadLabels('A', ['Equal'], 10)).markers, ['First']);
    gate = deferred(); const first = f.sdk.saveThreadLabels('A', ['New'], 11); const failed = assert.rejects(first);
    await assert.rejects(f.sdk.saveThreadLabels('A', ['Duplicate'], 11), /in progress/);
    f.sdk.close(); gate.resolve(); await failed;
    assert.deepEqual(f.sdk.threads.get('A').markers, ['First']);
  } finally { f.sdk.close(); }
});
test('living page headers take directory authority without body prefetch or window reset; identities remain separate', async () => {
  const f = fixture(), other = fixture(); try {
    await ready(f); await ready(other);
    const page = f.sdk.acquirePage('A'); await page.openConversation('A');
    const key = page.currentConversationKey, rows = page.messages.get('A'); f.paths.length = 0;
    await f.sdk.saveThreadLabels('A', ['Header'], 10);
    assert.deepEqual(page.threads.get('A').markers, ['Header']);
    assert.equal(page.currentConversationKey, key); assert.equal(page.messages.get('A'), rows);
    assert.ok(f.paths.every(p => !p.path.includes('/messages') && !p.path.endsWith('/live-state')));
    assert.deepEqual(other.sdk.threads.get('A').markers, []);
  } finally { f.sdk.close(); other.sdk.close(); }
});
