import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { connection, newSend } from '../src/send.ts';

const config = connection('https://example.test', 'test-only', 'retry-test');
const original = () => ({ ...newSend(config, 'thread', '原文\n**unchanged**', 'mob_123e4567-e89b-12d3-a456-000000000001'), status: 'blocked', attachments: [{ id: 'att_test', thread_id: 'thread', name: 'file.txt', mime: 'text/plain', size: 3, state: 'available' }] });
class Store {
  data = new Map(); fail = false;
  async getItemAsync(k) { return this.data.get(k) ?? null; }
  async setItemAsync(k, v) { if (this.fail) throw Error('storage unavailable'); this.data.set(k, v); }
  async deleteItemAsync(k) { this.data.delete(k); }
}
function make(store) {
  const calls = [], received = new Map();
  const sdk = { receipts: new Map(), messages: new Map(), supportsLatest: true,
    async send(thread, id, text, attachments) {
      calls.push({ thread, id, text, attachments });
      // Explicit fake durable server: identity is the sole deduplication key.
      if (!received.has(id)) received.set(id, { id: 'receipt', thread_id: thread, client_message_id: id, state: 'unknown', durable: true, ref_seq: 1 });
      return received.get(id);
    }, async getReceipt() { throw Error('unexpected read'); }, async historyTail() { throw Error('unexpected read'); } };
  return { box: new MobileOutbox(new OutboxStore(store, config), sdk, () => {}, undefined, undefined, undefined, true), calls, received, sdk };
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('retry durably queues same identity, original text and attachments; cold restart sends once', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  await f.box.retryFailed('thread', item.clientMessageId);
  assert.deepEqual(f.box.records, [{ ...item, status: 'queued' }]);
  assert.equal(f.calls.length, 0);
  await f.box.stop();
  const next = make(store); await next.box.start();
  assert.deepEqual(next.box.records, [{ ...item, status: 'queued' }]);
  next.box.setConnection('online'); await flush();
  assert.deepEqual(next.calls, [{ thread: item.threadId, id: item.clientMessageId, text: item.text, attachments: ['att_test'] }]);
  assert.equal(next.received.size, 1);
  assert.equal(next.box.records.length, 0);
  await assert.rejects(next.box.retryFailed('thread', item.clientMessageId));
  await next.box.stop();
});

test('retry preserves original on failed storage commit and does not send', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  const before = [...store.data]; store.fail = true;
  await assert.rejects(f.box.retryFailed('thread', item.clientMessageId), /storage unavailable/);
  assert.deepEqual(f.box.records, [item]); assert.deepEqual([...store.data], before); assert.equal(f.calls.length, 0);
  store.fail = false; await f.box.stop();
  const next = make(store); await next.box.start(); assert.deepEqual(next.box.records, [item]); await next.box.stop();
});

test('retry refuses foreign thread, missing or changed state and any execution proof', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  await assert.rejects(f.box.retryFailed('other', item.clientMessageId));
  await assert.rejects(f.box.retryFailed('thread', 'missing'));
  for (const patch of [...['queued', 'sending', 'ambiguous', 'accepted'].map(status => ({ status })), { receiptId: 'receipt' }, { receiptState: 'unknown' }, { receiptRefSeq: 1 }]) {
    await f.box.storage.update({ ...item, ...patch });
    const before = [...store.data];
    await assert.rejects(f.box.retryFailed('thread', item.clientMessageId));
    assert.deepEqual([...store.data], before);
  }
  assert.equal(f.calls.length, 0); await f.box.stop();
  await assert.rejects(f.box.retryFailed('thread', item.clientMessageId), /closed/);
});

test('double retry and delete cannot race a durable retry transition', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  const first = f.box.retryFailed('thread', item.clientMessageId);
  await assert.rejects(f.box.retryFailed('thread', item.clientMessageId));
  await assert.rejects(f.box.deleteFailed('thread', item.clientMessageId));
  await first; assert.equal(f.box.records[0].status, 'queued');
  await assert.rejects(f.box.deleteFailed('thread', item.clientMessageId));
  await f.box.stop();
});

test('interrupted deletion cannot resurrect an incomplete message via Retry', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  store.deleteItemAsync = async () => { throw Error('cleanup interrupted'); };
  await assert.rejects(f.box.deleteFailed('thread', item.clientMessageId));
  await assert.rejects(f.box.retryFailed('thread', item.clientMessageId), /cannot be retried/);
  assert.equal(f.calls.length, 0); await f.box.stop();
});

test('failed response after durable reception retries same ID without rerunning unknown execution', async () => {
  const store = new Store(), f = make(store), item = original();
  await f.box.start(); await f.box.storage.enqueue(item);
  const send = f.sdk.send.bind(f.sdk); let lose = true;
  f.sdk.send = async (...args) => { const result = await send(...args); if (lose) throw Object.assign(Error('invalid response'), { name: 'ProtocolError' }); return result; };
  f.box.setConnection('online');
  await f.box.retryFailed('thread', item.clientMessageId); await flush();
  assert.equal(f.box.records[0].status, 'blocked'); assert.equal(f.received.size, 1);
  lose = false; await f.box.retryFailed('thread', item.clientMessageId); await flush();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.received.size, 1); assert.equal(f.box.records.length, 0);
  await f.box.stop();
});
