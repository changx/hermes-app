import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../../../packages/client/dist/index.js';
const a = ref => ({ id: String(ref), ref_seq: ref, role: 'assistant', text: `Synthetic ${ref}` });
const response = (messages, next_cursor) => ({ status: 200, body: { messages, next_cursor, incomplete_turns: [], turn_outcomes: [] } });
function source(recover) {
  const requests = [];
  const client = new HermesClient({ token: () => 'synthetic-only', http: { request: async (method, path, token, signal) => {
    const url = new URL(path, 'https://synthetic.invalid');
    requests.push({ path: url.pathname, after: url.searchParams.get('after'), afterRef: url.searchParams.get('after_ref_seq'), latest: url.searchParams.get('latest') });
    if (url.pathname === '/v1/snapshot') return { status: 200, body: { threads: [], next_after: null, waterline: 'sync-0' } };
    if (url.pathname === '/v1/channels') return { status: 200, body: { channels: [] } };
    if (url.pathname === '/v1/sync') return { status: 200, body: { events: [], waterline: 'sync-0', next_cursor: 'sync-0', has_more: false } };
    const after = url.searchParams.get('after');
    if (!after) return response([a(130)], 'pending-1');
    if (after === 'pending-1') return response([a(131)], 'pending-2');
    if (after === 'pending-2') return response([a(132)], 'pending-3');
    return recover(after, signal);
  } } });
  client.messages.set('t', [{ ...a(120), role: 'user' }, a(121)]);
  return { client, requests, async seed() { await assert.rejects(client.historyTail('t'), /exceeds 300 refs/); assert.equal(client.tailIncomplete.has('t'), true); requests.length = 0; } };
}

test('SDK continues saved forward cursor without a latest jump or dropping pre-existing messages', async () => {
  const h = source(after => after === 'pending-3' ? response([a(133)], 'pending-4') : response([a(134)], null));
  await h.seed(); await h.client.recoverHistoryTail('t');
  assert.deepEqual(h.requests.map(item => item.after), ['pending-3', 'pending-4']);
  assert.ok(h.requests.every(item => item.latest === null && item.afterRef === null));
  assert.deepEqual(h.client.messages.get('t').map(item => item.ref_seq), [120, 121, 130, 131, 132, 133, 134]);
  assert.equal(h.client.tailIncomplete.has('t'), false);
});

test('simultaneous recovery callers share the SAME in-flight job, not separate network requests', async () => {
  let finish;
  const h = source(() => new Promise(resolve => { finish = resolve; })); await h.seed();
  const first = h.client.recoverHistoryTail('t'), second = h.client.recoverHistoryTail('t');
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 1);
  finish(response([a(133)], null)); await Promise.all([first, second]);
  assert.equal(h.client.tailIncomplete.has('t'), false);
});

test('failed recovery retains exact cursor progress and remains marked incomplete until successful retry', async () => {
  let fail = true;
  const h = source(after => {
    if (after === 'pending-3') return response([a(133)], 'pending-4');
    if (fail) throw new Error('synthetic offline');
    return response([a(134)], null);
  }); await h.seed();
  await assert.rejects(h.client.recoverHistoryTail('t'), /offline/);
  assert.equal(h.client.tailIncomplete.has('t'), true);
  fail = false; await h.client.recoverHistoryTail('t');
  assert.deepEqual(h.requests.map(item => item.after), ['pending-3', 'pending-4', 'pending-4']);
  assert.equal(h.client.tailIncomplete.has('t'), false);
});

test('abort releases owner but keeps continuation, and late transport completion cannot falsely resume it', async () => {
  let finish, deferred = true;
  const h = source(() => deferred ? new Promise(resolve => { finish = resolve; }) : response([a(133)], null)); await h.seed();
  const controller = new AbortController(); const job = h.client.recoverHistoryTail('t', controller.signal);
  controller.abort(); await assert.rejects(job, /aborted/);
  finish(response([a(133)], null)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.tailIncomplete.has('t'), true);
  assert.equal(h.client.messages.get('t').some(item => item.ref_seq === 133), false);
  deferred = false; await h.client.recoverHistoryTail('t');
  assert.deepEqual(h.requests.map(item => item.after), ['pending-3', 'pending-3']);
  assert.equal(h.client.tailIncomplete.has('t'), false);
});

test('page budget is bounded and a later recovery continues progress rather than a fresh latest query', async () => {
  let calls = 0, finish = false;
  const h = source(() => { calls++; return response([a(200 + calls)], finish ? null : `more-${calls}`); }); await h.seed();
  await assert.rejects(h.client.recoverHistoryTail('t'), /page budget exceeded/);
  assert.equal(calls, 20); assert.equal(h.client.tailIncomplete.has('t'), true);
  finish = true; await h.client.recoverHistoryTail('t');
  assert.equal(h.requests.at(-1).after, 'more-20'); assert.equal(h.client.tailIncomplete.has('t'), false);
});

test('cyclic cursor fails instead of repeating reads or marking repair complete', async () => {
  const h = source(after => response([a(133)], after)); await h.seed();
  await assert.rejects(h.client.recoverHistoryTail('t'), /did not advance/);
  assert.equal(h.requests.length, 1); assert.equal(h.client.tailIncomplete.has('t'), true);
});

test('missing continuation is not guessed from max cached ref; no-op when nothing needs repair', async () => {
  const h = source(() => assert.fail('unexpected network'));
  assert.deepEqual(await h.client.recoverHistoryTail('t'), h.client.messages.get('t'));
  h.client.tailIncomplete.add('t');
  await assert.rejects(h.client.recoverHistoryTail('t'), /continuation unavailable/);
  assert.equal(h.requests.length, 0); assert.equal(h.client.tailIncomplete.has('t'), true);
});

test('legacy known-empty thread also stores the unfinished cursor for safe forward continuation', async () => {
  let reads = 0; const after = [];
  const client = new HermesClient({ token: () => 'synthetic-only', http: { request: async (_method, path) => {
    after.push(new URL(path, 'https://synthetic.invalid').searchParams.get('after'));
    reads++;
    if (reads === 1) return response([], null);
    if (reads === 2) return response([a(1)], 'legacy-pending');
    return response([a(2)], null);
  } } });
  await client.history('t');
  await assert.rejects(client.historyTail('t'), /exceeds empty-thread page/);
  await client.recoverHistoryTail('t');
  assert.deepEqual(after, [null, null, 'legacy-pending']);
  assert.deepEqual(client.messages.get('t').map(item => item.ref_seq), [1, 2]);
  assert.equal(client.tailIncomplete.has('t'), false);
});

test('explicit resync invalidates the old recovery cursor and its late completion', async () => {
  let finish;
  const h = source(() => new Promise(resolve => { finish = resolve; })); await h.seed();
  const job = h.client.recoverHistoryTail('t');
  await h.client.resync();
  finish(response([a(133)], 'old-continuation')); await assert.rejects(job, /aborted/);
  assert.equal(h.client.tailIncomplete.has('t'), false);
  assert.equal(h.client.messages.get('t')?.some(item => item.ref_seq === 133) ?? false, false);
  h.client.tailIncomplete.add('t');
  await assert.rejects(h.client.recoverHistoryTail('t'), /continuation unavailable/);
});
