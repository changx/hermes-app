import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { connection, newSend } from '../src/send.ts';
import { projectTimeline } from '../src/timeline.ts';

const config = connection('https://example.test', 'synthetic-only', 'recovery');
const original = () => newSend(config, 'thread', 'original', 'mob_123e4567-e89b-12d3-a456-000000000001');
const proof = (patch = {}) => ({ id: 'r1', thread_id: 'thread', client_message_id: original().clientMessageId, state: 'running', processing: 'running', durable: true, ref_seq: 7, ...patch });
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
class Store {
  data = new Map(); failWrite = false;
  async getItemAsync(key) { return this.data.get(key) ?? null; }
  async setItemAsync(key, value) { if (this.failWrite) throw Error('disk'); this.data.set(key, value); }
  async deleteItemAsync(key) { this.data.delete(key); }
}
async function fixture(recordPatch = {}) {
  const store = new Store(), calls = [], notices = [];
  const seeded = new OutboxStore(store, config); await seeded.load();
  await seeded.enqueue({ ...original(), status: 'blocked', ...recordPatch });
  const sdk = { messages: new Map(), receipts: new Map(), supportsLatest: true,
    async send() { calls.push('send'); throw Error('must not resend'); },
    async getReceipt() { calls.push('receipt'); throw Error('must not query'); },
    async historyTail() { calls.push('history'); throw Error('must not read'); },
    rememberAcceptedInput() { calls.push('echo'); } };
  const box = new MobileOutbox(new OutboxStore(store, config), sdk, (_items, notice) => { if (notice) notices.push(notice); }, undefined, undefined, undefined, true);
  await box.start(); box.setConnection('online'); await flush();
  return { store, sdk, box, calls, notices };
}

test('a send response failure followed by delayed live confirmation recovers without another submission', async () => {
  const f = await fixture();
  try {
    await f.box.deleteFailed('thread', original().clientMessageId);
    f.sdk.send = async () => { f.calls.push('send'); throw Error('Malformed confirmation'); };
    await f.box.enqueue(original()); await flush();
    assert.equal(f.box.records[0].status, 'blocked');
    assert.ok(f.notices.some(notice => notice.includes('Sending could not be confirmed')));
    f.sdk.receipts.set('r1', proof()); f.box.reconcile(); await flush();
    assert.equal(f.box.records.length, 0); assert.deepEqual(f.calls, ['send', 'echo']);
  } finally { await f.box.stop(); }
});

test('failed local send recovers from exact opened-session proof and stays retired across cold reopen', async () => {
  const f = await fixture();
  try {
    assert.equal(projectTimeline([], null, 'thread', undefined, true, f.box.records)[0].status, 'blocked');
    // The history arrives after the failed optimistic row has already mounted.
    f.sdk.messages.set('thread', [{ id: 'user', role: 'user', text: 'original', ref_seq: 7, receipt_id: 'r1', client_message_id: original().clientMessageId }]);
    f.sdk.receipts.set('r1', proof()); f.box.reconcile(); await flush();
    assert.equal(f.box.records.length, 0);
    assert.deepEqual(f.calls, ['echo']); assert.deepEqual(f.notices, []);
    await f.box.stop();
    const cold = new OutboxStore(f.store, config); assert.deepEqual(await cold.load(), []);
    // Before body hydration there is now no stale failed row to flash.
    assert.deepEqual(projectTimeline([], null, 'thread', undefined, true, cold.records), []);
  } finally { await f.box.stop(); }
});

test('foreign identity, non-durable or missing-reference proof cannot erase a failed original', async () => {
  for (const patch of [{ thread_id: 'other' }, { client_message_id: 'other' }, { durable: false }, { ref_seq: undefined }]) {
    const f = await fixture();
    try {
      f.sdk.receipts.set('r1', proof(patch)); f.box.reconcile(); await flush();
      assert.equal(f.box.records[0].status, 'blocked'); assert.deepEqual(f.calls, []);
    } finally { await f.box.stop(); }
  }
});

test('equal body under a different send identity is not reception proof', async () => {
  const f = await fixture();
  try {
    f.sdk.messages.set('thread', [{ id: 'user', role: 'user', text: 'original', ref_seq: 7, receipt_id: 'r1', client_message_id: 'other' }]);
    f.sdk.receipts.set('r1', proof({ client_message_id: 'other' }));
    f.box.reconcile(); await flush(); assert.equal(f.box.records[0].status, 'blocked'); assert.deepEqual(f.calls, []);
  } finally { await f.box.stop(); }
});

test('a stored receipt identity cannot be replaced by another receipt for the same client ID', async () => {
  const f = await fixture({ receiptId: 'old' });
  try { f.sdk.receipts.set('r1', proof()); f.box.reconcile(); await flush(); assert.equal(f.box.records[0].status, 'blocked'); assert.deepEqual(f.calls, []); }
  finally { await f.box.stop(); }
});

test('unknown execution proof recovers reception without sending or rerunning it', async () => {
  const f = await fixture();
  try {
    f.sdk.receipts.set('r1', proof({ state: 'unknown', processing: 'unknown' })); f.box.reconcile(); await flush();
    assert.equal(f.box.records.length, 0); assert.deepEqual(f.calls, ['echo']);
  } finally { await f.box.stop(); }
});

test('reception proof must persist before failed original is removed; write failure remains visible', async () => {
  const f = await fixture();
  try {
    f.store.failWrite = true; f.sdk.receipts.set('r1', proof()); f.box.reconcile(); await flush();
    assert.equal(f.box.records[0].status, 'blocked'); assert.deepEqual(f.calls, []);
    assert.ok(f.notices.some(notice => notice.includes('could not be updated')));
    f.store.failWrite = false; const cold = new OutboxStore(f.store, config); assert.equal((await cold.load())[0].status, 'blocked');
  } finally { await f.box.stop(); }
});
