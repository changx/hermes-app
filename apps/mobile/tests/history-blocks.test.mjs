import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { HermesClient } from '../../../packages/client/dist/index.js';
import { historyBlockStart, loadHistoryBlocks, HISTORY_BLOCK_COUNT } from '../src/historyBlocks.ts';

const m = (ref, role = 'assistant', text = `${role} ${ref}`) => ({ id: String(ref), ref_seq: ref, role, text });
const u = ref => m(ref, 'user');
function sdk(initial, pages) {
  const requests = [], cursors = [];
  const client = new HermesClient({ token: () => 'synthetic-only', http: { request: async (_method, path) => {
    const query = new URL(path, 'https://synthetic.invalid').searchParams;
    const before = query.get('before'); requests.push({ before, limit: query.get('limit') });
    const page = typeof pages === 'function' ? await pages(before) : pages[before];
    assert.ok(page, `synthetic page for ${before}`);
    return { status: 200, body: { messages: page.messages, older_cursor: page.cursor } };
  } } });
  client.supportsLatest = true; client.messages.set('t', initial);
  return { client, requests, cursors, options: { onCursor: cursor => cursors.push(cursor) } };
}

test('default is 5 user-started blocks regardless of record count or time span', () => {
  assert.equal(HISTORY_BLOCK_COUNT, 5);
  const rows = [u(1), m(2), u(3), m(4), u(5), m(6), u(7), m(8), u(9), m(10), u(11), m(12), u(13), m(14)];
  assert.deepEqual(historyBlockStart(rows), { startRef: 5, enough: true });
  assert.deepEqual(historyBlockStart(rows, 13), { startRef: 3, enough: true });
  assert.deepEqual(historyBlockStart(rows, 3), { startRef: 1, enough: false });
});

test('very long replies, tool batches, notices and attachments do not count as new blocks', () => {
  const rows = [u(1), ...Array.from({ length: 250 }, (_, i) => m(i + 2)), u(300),
    { ...m(301), tool_calls: [{ id: 'call', name: 'search', label: 'Search' }] },
    { ...m(302, 'system'), display_kind: 'system_notice' }, u(400), m(401), u(450), m(451), u(500), m(501)];
  assert.equal(historyBlockStart(rows).startRef, 1);
  assert.equal(rows.filter(item => item.ref_seq >= historyBlockStart(rows).startRef).length, rows.length);
});

test('follow-up user messages count independently without inference, regrouping or duplication', () => {
  const rows = [u(1), m(2), { ...u(3), receipt_id: 'followup-a' }, m(4), { ...u(5), receipt_id: 'followup-b' }, m(6), u(7), m(8), u(9), m(10)];
  assert.deepEqual(historyBlockStart(rows), { startRef: 1, enough: true });
  assert.deepEqual(historyBlockStart(rows, 5, 1), { startRef: 3, enough: true });
  assert.deepEqual(rows.map(item => item.ref_seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('cached 5-block expansion never requests network and does not add an extra current block', async () => {
  const h = sdk([u(1), m(2), u(3), m(4), u(5), m(6), u(7), m(8), u(9), m(10), u(11), m(12)], {});
  const result = await loadHistoryBlocks(h.client, 't', 11, 'older', h.options);
  assert.deepEqual(result, { startRef: 1, olderCursor: 'older' });
  assert.equal(h.requests.length, 0);
});

test('multiple wire pages are accumulated until the fifth old user boundary, not exposed mid-reply', async () => {
  const h = sdk([u(100), m(101)], {
    c1: { messages: [m(30), u(40), m(41), u(60), m(61)], cursor: 'c2' },
    c2: { messages: [u(1), m(2), u(10), m(11), u(20), m(21)], cursor: null }
  });
  const result = await loadHistoryBlocks(h.client, 't', 100, 'c1', h.options);
  assert.deepEqual(result, { startRef: 1, olderCursor: null });
  assert.deepEqual(h.requests, [{ before: 'c1', limit: '100' }, { before: 'c2', limit: '100' }]);
  assert.deepEqual(h.cursors, ['c2', null]);
  const visible = h.client.messages.get('t').filter(item => item.ref_seq >= result.startRef);
  assert.deepEqual(visible.filter(item => item.role === 'user').map(item => item.ref_seq), [1, 10, 20, 40, 60, 100]);
  assert.ok(visible.some(item => item.ref_seq === 30), 'intervening assistant content remains in chronological order');
});

test('initial window completes 5 blocks even when the latest wire page contains only the middle of one reply', async () => {
  const h = sdk([m(100), m(101)], {
    c1: { messages: [u(80), m(81), m(82)], cursor: 'c2' },
    c2: { messages: [u(1), m(2), u(20), m(21), u(30), m(31), u(50), m(51)], cursor: null }
  });
  const result = await loadHistoryBlocks(h.client, 't', null, 'c1', h.options);
  assert.equal(result.startRef, 1); assert.equal(h.requests.length, 2);
});

test('exhausted history yields fewer blocks, preserves assistant-only legacy history, handles empty threads', async () => {
  assert.deepEqual(historyBlockStart([]), { startRef: null, enough: false });
  assert.deepEqual(historyBlockStart([m(1), m(2)]), { startRef: 1, enough: false });
  const h = sdk([u(20), m(21), u(100), m(101)], { c1: { messages: [u(1), m(2)], cursor: null } });
  assert.deepEqual(await loadHistoryBlocks(h.client, 't', 100, 'c1', h.options), { startRef: 1, olderCursor: null });
  const empty = sdk([], {}); assert.deepEqual(await loadHistoryBlocks(empty.client, 't', null, null), { startRef: null, olderCursor: null });
});

test('empty filtered pages can advance cursors; repeating cursor or exceeding page budget fails safely', async () => {
  const h = sdk([u(100)], {
    c1: { messages: [], cursor: 'c2' }, c2: { messages: [u(1), u(2), u(3)], cursor: null }
  });
  assert.equal((await loadHistoryBlocks(h.client, 't', 100, 'c1')).startRef, 1);
  const repeat = sdk([u(100)], { c1: { messages: [m(30)], cursor: 'c1' } });
  await assert.rejects(loadHistoryBlocks(repeat.client, 't', 100, 'c1'), /cursor did not advance/);
  const budget = sdk([u(100)], { c1: { messages: [m(30)], cursor: 'c2' } });
  await assert.rejects(loadHistoryBlocks(budget.client, 't', 100, 'c1', { ...budget.options, maxPages: 1 }), /did not finish/);
  assert.deepEqual(budget.cursors, ['c2']);
});

test('failure preserves successful cache/cursor progress so retry continues rather than publishing half a block', async () => {
  let fail = true;
  const h = sdk([u(100)], async before => {
    if (before === 'c1') return { messages: [u(40), m(41)], cursor: 'c2' };
    if (fail) throw new Error('synthetic offline');
    return { messages: [u(1), m(2), u(20), m(21)], cursor: null };
  });
  await assert.rejects(loadHistoryBlocks(h.client, 't', 100, 'c1', h.options), /offline/);
  assert.deepEqual(h.cursors, ['c2']);
  fail = false;
  assert.equal((await loadHistoryBlocks(h.client, 't', 100, h.cursors.at(-1), h.options)).startRef, 1);
  assert.deepEqual(h.requests.map(item => item.before), ['c1', 'c2', 'c2']);
});

test('focus loss before/during network stops without committing a visible boundary or subsequent cursor', async () => {
  const h = sdk([u(100)], {});
  assert.equal(await loadHistoryBlocks(h.client, 't', 100, 'c1', { current: () => false }), null);
  assert.equal(h.requests.length, 0);
  let resolve, focused = true;
  const pending = sdk([u(100)], () => new Promise(done => { resolve = done; }));
  const promise = loadHistoryBlocks(pending.client, 't', 100, 'c1', { ...pending.options, current: () => focused });
  await new Promise(done => setImmediate(done));
  focused = false; resolve({ messages: [u(1), u(2), u(3)], cursor: null });
  assert.equal(await promise, null); assert.deepEqual(pending.cursors, []);
});

test('the reference of an existing reading boundary must be found exactly, never repaired by numeric guesses', () => {
  assert.throws(() => historyBlockStart([u(10), m(20)], 11), /boundary is unavailable/);
  assert.throws(() => historyBlockStart([u(10)], null, 0), /Invalid/);
});

const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  context.measurement ??= null;
  let initializer;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(app) === name) initializer = node.initializer.getText(app); ts.forEachChild(node, visit); }
  visit(app); assert.ok(initializer);
  runInNewContext(ts.transpileModule(`globalThis.callback = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.callback;
}

test('production App loadOlder publishes all history once and holds original rows during intermediate fetches', async () => {
  let finish;
  const h = sdk([u(100), m(101)], async before => before === 'c1'
    ? { messages: [u(60), m(61)], cursor: 'c2' }
    : new Promise(resolve => { finish = resolve; }));
  h.client.loadFullHistory = async id => { let before = 'c1'; while (before) { const page = await h.client.historyWindow(id, before, 100); before = page.older_cursor; } };
  const starts = [], holds = [], context = {
    client: h.client, focusedRef: { current: true }, appActive: { current: true }, openingRef: { current: 1 }, threadId: 't', historyBusy: false,
    timelineRef: { current: { holdPosition: () => holds.push(true) } }, visibleMessages: [u(100), m(101)], pageCursor: 'c1',
    loadHistoryBlocks, olderCursors: { current: new Map() },
    setHistoryBusy: value => { context.historyBusy = value; }, setPageCursor: value => { context.pageCursor = value; },
    setStartRef: value => starts.push(value), setError: value => assert.fail(value)
  };
  const pending = callback('loadOlder', context)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, []); assert.equal(context.pageCursor, 'c1');
  assert.deepEqual(h.client.messages.get('t').filter(item => item.ref_seq >= 100).map(item => item.ref_seq), [100, 101]);
  finish({ messages: [u(1), m(2), u(20), m(21)], cursor: null }); await pending;
  assert.deepEqual(starts, [1]); assert.equal(holds.length, 1); assert.equal(context.historyBusy, false);
});

test('production scoped entry publishes its single page without more history or read reporting', async () => {
  const h = sdk([], {}), events = [];
  h.client.openConversation = async id => { events.push(['open', id]); h.client.currentThreadId = id; h.client.currentConversationKey = {}; h.client.currentOlderCursor = null; h.client.messages.set(id, [u(1), m(2), u(5), m(6), u(10), m(11), u(20), m(21), u(25), m(26), u(30), m(31)]); };
  const context = { client: h.client, focusedRef: { current: true }, appActive: { current: true }, ownedWatch: { current: null }, openingRef: { current: 0 }, loadHistoryBlocks,
    setPageCursor() {}, setHistoryBusy() {}, setLocated() {}, setStartRef: value => events.push(['start', value]), setError: value => assert.fail(value) };
  await callback('openThread', context)('t');
  assert.deepEqual(events, [['start', null], ['open', 't'], ['start', 1]]);
  assert.equal(h.requests.length, 0);
});

test('production entry waits for scoped opening before fetching user-started history blocks', async () => {
  const h = sdk([], {}); let finish;
  h.client.openConversation = () => new Promise(resolve => { finish = () => { h.client.currentThreadId = 't'; h.client.currentOlderCursor = null; h.client.messages.set('t', [u(10), m(11)]); resolve(); }; });
  const starts = [], context = { client: h.client, focusedRef: { current: true }, appActive: { current: true }, ownedWatch: { current: null }, openingRef: { current: 0 }, loadHistoryBlocks,
    setPageCursor() {}, setHistoryBusy() {}, setLocated() {}, setStartRef: value => starts.push(value), setError: value => assert.fail(value) };
  const pending = callback('openThread', context)('t');
  assert.deepEqual(starts, [null]); assert.equal(h.requests.length, 0); finish(); await pending;
  assert.deepEqual(starts, [null, 10]);
});

test('a late scoped entry cannot retain body or pagination in a closed view', async () => {
  const h = sdk([], {}); let finish;
  h.client.openConversation = () => new Promise(resolve => { finish = resolve; });
  const starts = [], context = { client: h.client, focusedRef: { current: true }, appActive: { current: true }, ownedWatch: { current: null }, openingRef: { current: 0 }, loadHistoryBlocks,
    setPageCursor() {}, setHistoryBusy() {}, setLocated() {}, setStartRef: value => starts.push(value), setError: value => assert.fail(value) };
  const pending = callback('openThread', context)('t'); context.focusedRef.current = false; ++context.openingRef.current; finish(); await pending;
  assert.deepEqual(starts, [null]); assert.equal(h.requests.length, 0);
});
