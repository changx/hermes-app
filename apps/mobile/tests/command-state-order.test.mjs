import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTimeline } from '../src/timeline.ts';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { accepted, newSend, restoreSend } from '../src/send.ts';

const config = { id: 'c', baseUrl: 'https://example.test', token: 'test' };
const states = ['queued', 'running', 'completed', 'failed', 'interrupted', 'unknown', 'received'];
const id = n => `mob_12345678-1234-1234-1234-${String(n).padStart(12, '0')}`;
const input = (n, ref) => ({ id: `receipt:r${n}`, ref_seq: ref, role: 'user', text: '/usage', receipt_id: `r${n}`, client_message_id: id(n) });
const receipt = (n, state, ref_seq) => ({ id: `r${n}`, thread_id: 't', client_message_id: id(n), durable: true, state, ...(ref_seq === undefined ? {} : { ref_seq }) });
const local = (n, state, ref) => accepted({ ...newSend(config, 't', '/usage', id(n)), createdAt: n }, receipt(n, state, ref));
const assistant = ref => ({ id: `a${ref}`, ref_seq: ref, role: 'assistant', text: 'answer', created_at: 2000 - ref });
const project = (messages, records, known = messages, receipts = new Map()) => projectTimeline(messages, null, 't', undefined, true, records, receipts, [], known);
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
function kv() { const data = new Map(); return { data, async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } }; }

test('all execution states keep exact row identity and ref order before and after history hydration', () => {
  for (const state of states) {
    const record = local(1, state, 11);
    const before = project([assistant(10), assistant(12)], [record]);
    assert.deepEqual(before.map(r => r.refSeq), [10, 11, 12], state);
    assert.equal(before[2].continuation, false, 'inserted input splits assistant grouping');
    const after = project([assistant(10), input(1, 11), assistant(12)], [record]);
    assert.deepEqual(after.map(r => [r.key, r.refSeq]), before.map(r => [r.key, r.refSeq]), state);
    assert.equal(after[2].continuation, before[2].continuation);
  }
});

test('four old completed reactions never reappear at tail, even while bookkeeping remains unknown', () => {
  const seqs = [323, 324, 327, 328];
  const old = seqs.map((ref, n) => ({ ...local(n + 1, 'unknown', ref), receiptProcessing: 'completed' }));
  const latest = [assistant(380), assistant(388)];
  assert.deepEqual(project(latest, old).map(r => r.refSeq), [380, 388]);
  const originals = seqs.map((ref, n) => input(n + 1, ref));
  assert.deepEqual(project([...originals, ...latest], old).map(r => r.refSeq), [...seqs, 380, 388]);
  // Loaded but outside the rendered window: identity suppresses all local copies.
  assert.deepEqual(project(latest, old.map(r => ({ ...r, receiptRefSeq: undefined })), [...originals, ...latest]).map(r => r.refSeq), [380, 388]);
});

test('old accepted records await exact location without losing originals; unsent remains immediate', () => {
  for (const state of states) {
    const old = local(1, state);
    assert.equal(project([assistant(100)], [old]).length, 1);
    assert.equal(old.text, '/usage');
    const receipts = new Map([['r1', receipt(1, state, 101)]]);
    assert.deepEqual(project([assistant(100)], [old], undefined, receipts).map(r => r.refSeq), [100, 101]);
  }
  const unsent = { ...newSend(config, 't', 'new', id(2)), status: 'queued' };
  assert.deepEqual(project([assistant(100)], [unsent]).map(r => r.text), ['answer', 'new']);
  assert.equal(project([], [{ ...local(1, 'unknown', 1), threadId: 'foreign' }]).length, 0);
});

test('equal text sends are not collapsed and server sequence wins over timestamps', () => {
  const records = [local(2, 'failed', 12), local(1, 'completed', 11)];
  assert.deepEqual(project([assistant(10), assistant(13)], records).map(r => r.refSeq), [10, 11, 12, 13]);
  assert.equal(new Set(project([], records).map(r => r.key)).size, 2);
});

test('reference survives durable cold restore; changed and malformed refs fail closed', async () => {
  const storage = kv(), store = new OutboxStore(storage, config);
  const saved = local(1, 'unknown', 323);
  await store.load(); await store.enqueue(saved);
  const restored = (await new OutboxStore(storage, config).load())[0];
  assert.equal(restored.receiptRefSeq, 323);
  assert.equal(accepted(restored, receipt(1, 'unknown')).receiptRefSeq, 323);
  assert.throws(() => accepted(restored, receipt(1, 'unknown', 999)), /reference/);
  for (const bad of [null, 0, -1, 2.5, '323']) assert.throws(() => restoreSend(JSON.stringify({ ...saved, receiptRefSeq: bad }), config), /reference/);
});

test('cold unknown ref outside latest page is reconciled and cleared without send or full-history scan', async () => {
  const storage = kv(), seed = new OutboxStore(storage, config);
  await seed.load(); await seed.enqueue(local(1, 'unknown')); // pre-upgrade local record
  let queries = 0, tails = 0;
  const sdk = { receipts: new Map(), messages: new Map(), supportsLatest: true,
    async getReceipt() { queries++; return receipt(1, 'unknown', 323); },
    async historyTail() { tails++; sdk.messages.set('t', [assistant(380), assistant(388)]); },
    async send() { assert.fail('unknown must never be replayed'); }
  };
  const box = new MobileOutbox(new OutboxStore(storage, config), sdk, () => {}, () => 1000);
  try {
    await box.start(); box.setConnection('online'); await tick();
    assert.equal(queries, 1); assert.equal(tails, 1);
    assert.equal(box.records.length, 0);
    assert.equal((await new OutboxStore(storage, config).load()).length, 0);
    assert.deepEqual(project(sdk.messages.get('t'), box.records).map(r => r.refSeq), [380, 388]);
  } finally { await box.stop(); }
});

test('unknown without location proof survives failed or empty sync; exact input permits cleanup', async () => {
  const storage = kv(), seed = new OutboxStore(storage, config);
  await seed.load(); await seed.enqueue(local(1, 'unknown'));
  let now = 1000, fail = true;
  const sdk = { receipts: new Map(), messages: new Map(), supportsLatest: true,
    async getReceipt() { return receipt(1, 'unknown'); },
    async historyTail() { if (fail) throw new TypeError('offline'); },
    async send() { assert.fail('unknown must never be replayed'); }
  };
  const box = new MobileOutbox(new OutboxStore(storage, config), sdk, () => {}, () => now);
  try {
    await box.start(); box.setConnection('online'); await tick(); assert.equal(box.records.length, 1);
    fail = false; now += 12000; box.reconcile(); await tick(); assert.equal(box.records.length, 1);
    sdk.messages.set('t', [input(2, 324)]); box.reconcile(); await tick(); assert.equal(box.records.length, 1, 'same text is not proof');
    sdk.messages.set('t', [input(1, 323)]); box.reconcile(); await tick(); assert.equal(box.records.length, 0);
  } finally { await box.stop(); }
});

test('same-state receipt enrichment is saved immediately while running and survives cold load', async () => {
  const storage = kv(), seed = new OutboxStore(storage, config);
  await seed.load(); await seed.enqueue(local(1, 'running'));
  const sdk = { receipts: new Map([['r1', receipt(1, 'running', 5)]]), messages: new Map(), supportsLatest: true,
    async getReceipt() { return receipt(1, 'running', 5); }, async historyTail() {},
    async send() { assert.fail('accepted must never resend'); }
  };
  const box = new MobileOutbox(new OutboxStore(storage, config), sdk, () => {}, () => 1000);
  try {
    await box.start(); box.setConnection('online'); await tick();
    assert.equal(box.records[0].receiptRefSeq, 5);
    assert.equal((await new OutboxStore(storage, config).load())[0].receiptRefSeq, 5);
  } finally { await box.stop(); }
});
