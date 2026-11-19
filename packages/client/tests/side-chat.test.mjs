import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { HermesClient, HttpError, sideChatsBySource, sideChatsByAnchor, sideWindow, sideMarkLabel, sendToMainText, sideFailure, parseSideOf, SIDE_BATCH } from '../dist/index.js';
const bundle = await build({ entryPoints: [new URL('../src/liveProtocol.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { parseCatalogue } = module.exports;

const side = { id: 'th_side0001', project_id: 'p_one', title: 'Side: PROBE', archived: false, side_of: { thread_id: 'th_source00001', anchor_ref_seq: 42 } };
const client = (reply, caps = { protocol: 1, thread_branch: true, thread_side: true }) => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return args[1] === '/v1/capabilities' ? { status: 200, body: caps } : reply(...args); } },
  });
  return { sdk, calls };
};

test('capability thread_side needs thread_branch too', async () => {
  const both = client(() => ({})).sdk; await both.capabilities(); assert.equal(both.supportsThreadSide, true);
  const only = client(() => ({}), { protocol: 1, thread_side: true }).sdk; await only.capabilities(); assert.equal(only.supportsThreadSide, false);
  const none = client(() => ({}), { protocol: 1, thread_branch: true }).sdk; await none.capabilities(); assert.equal(none.supportsThreadSide, false);
});

test('sideThread repeats the same request while the server waits, then returns the side chat', async () => {
  let posts = 0;
  const { sdk, calls } = client((method, path) => {
    if (method === 'POST') { posts++; return posts < 3 ? { status: 202, body: { state: 'running' } } : { status: 200, body: { thread: side } }; }
    return { status: 200, body: { thread: side } };
  });
  await sdk.capabilities();
  assert.deepEqual(await sdk.sideThread('th_source00001', 42, 'sc_req-1', undefined, 1), side);
  const bodies = calls.filter(c => c[0] === 'POST').map(c => c[3]);
  assert.equal(bodies.length, 3);
  for (const body of bodies) assert.deepEqual(body, { anchor_ref_seq: 42, request_id: 'sc_req-1', kind: 'side' });
});

test('sideThread refuses without the capability, on a mismatched identity, and passes reason codes', async () => {
  const off = client(() => ({}), { protocol: 1, thread_branch: true }).sdk; await off.capabilities();
  await assert.rejects(off.sideThread('th_source00001', 42, 'sc_a'), /side chats unavailable/);
  const wrong = client(() => ({ status: 200, body: { thread: { ...side, side_of: { thread_id: 'th_other', anchor_ref_seq: 42 } } } })).sdk; await wrong.capabilities();
  await assert.rejects(wrong.sideThread('th_source00001', 42, 'sc_b'), /identity mismatch/);
  const plain = client(() => ({ status: 200, body: { thread: { ...side, side_of: undefined } } })).sdk; await plain.capabilities();
  await assert.rejects(plain.sideThread('th_source00001', 42, 'sc_c'), /identity mismatch/);
  const busy = client(() => ({ status: 409, body: { error: 'busy' } })).sdk; await busy.capabilities();
  const failure = await busy.sideThread('th_source00001', 42, 'sc_d').catch(e => e);
  assert.ok(failure instanceof HttpError); assert.equal(failure.code, 'busy');
  await assert.rejects(busy.sideThread('th_source00001', 0, 'sc_e'), /invalid side chat/);
});

test('sideThread stops on abort and after its own time limit', async () => {
  const { sdk } = client(() => ({ status: 202, body: { state: 'running' } })); await sdk.capabilities();
  const controller = new AbortController();
  const pending = sdk.sideThread('th_source00001', 42, 'sc_f', controller.signal, 50);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /aborted/);
  const late = await sdk.sideThread('th_source00001', 42, 'sc_g', undefined, 1, 5).catch(e => e);
  assert.ok(late instanceof HttpError); assert.equal(late.code, 'busy');
});

test('catalogue rows and Thread JSON keep side_of; malformed values are refused', async () => {
  const page = parseCatalogue({ items: [{ kind: 'session', value: { ...side, running: false } }, { kind: 'session', value: { id: 'th_plain', project_id: 'p_one', title: 'Plain', archived: false, running: false } }], next_after: null });
  assert.deepEqual(page.items[0].value.side_of, side.side_of);
  assert.equal('side_of' in page.items[1].value, false);
  assert.throws(() => parseCatalogue({ items: [{ kind: 'session', value: { ...side, running: false, side_of: { thread_id: 'x', anchor_ref_seq: 0 } } }], next_after: null }));
  assert.equal(parseSideOf(undefined), undefined);
  assert.equal(parseSideOf(null), undefined);
  assert.throws(() => parseSideOf({ thread_id: '', anchor_ref_seq: 3 }));
  const { sdk } = client(() => ({ status: 200, body: { thread: { ...side, side_of: 'bad' } } }));
  await assert.rejects(sdk.getThread('th_side0001'), /invalid thread/);
});

const row = (id, extra = {}) => ({ id, title: id, running: false, lastMessageAt: 0, ...extra });

test('side chats group under their source, running first, then newest activity', () => {
  const threads = [row('a', { source: 'S', lastMessageAt: 1 }), row('b', { source: 'S', lastMessageAt: 5 }), row('c', { source: 'S', running: true }), row('S'), row('d', { source: 'T' }), row('loop', { source: 'loop' })];
  const groups = sideChatsBySource(threads, t => t.source);
  assert.deepEqual(groups.get('S').map(t => t.id), ['c', 'b', 'a']);
  assert.deepEqual(groups.get('T').map(t => t.id), ['d']);
  assert.equal(groups.has('loop'), false, 'a Thread is never its own side chat');
  const anchors = sideChatsByAnchor(groups.get('S'), t => ({ a: 4, b: 4, c: 9 })[t.id]);
  assert.deepEqual(anchors.get(4).map(t => t.id), ['b', 'a']);
  assert.deepEqual(anchors.get(9).map(t => t.id), ['c']);
});

test('sidebar window: every running side chat plus 10 newest others, 10 more per batch', () => {
  const sides = [row('r1', { running: true }), row('r2', { running: true }), ...Array.from({ length: 25 }, (_, i) => row(`o${i}`, { lastMessageAt: 100 - i }))];
  const first = sideWindow(sides);
  assert.equal(SIDE_BATCH, 10);
  assert.deepEqual(first.rows.map(t => t.id).slice(0, 3), ['r1', 'r2', 'o0']);
  assert.equal(first.rows.length, 12); assert.equal(first.hasMore, true);
  assert.equal(sideWindow(sides, 1).rows.length, 22);
  const last = sideWindow(sides, 2); assert.equal(last.rows.length, 27); assert.equal(last.hasMore, false);
});

test('anchor mark label and Send to main text', () => {
  assert.equal(sideMarkLabel(1), 'Side chat');
  assert.equal(sideMarkLabel(3), 'Side chat · 3');
  assert.equal(sendToMainText('Side: a [b]', 'th_side0001', '  Result.\n'), 'From side chat [Side: a \\[b\\]](hermesapp://session/th_side0001):\n\nResult.');
  const text = sendToMainText('', 'th_side0001', '>> send now');
  assert.ok(!text.startsWith('>>'));
  assert.ok(text.startsWith('From side chat [Side chat]'));
  assert.deepEqual(['busy', 'anchor_not_final', 'anchor_unavailable', 'side_unavailable', 'branch_failed', undefined].map(sideFailure), ['busy', 'unavailable', 'unavailable', 'unavailable', 'failed', 'failed']);
});
