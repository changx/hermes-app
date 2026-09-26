import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileOutbox, OutboxStore, LEGACY_SEND_KEY, delayFor, retryable } from '../src/outbox.ts';
import { connection, newSend } from '../src/send.ts';

const config = connection('https://example.test', 'secret', 'identity-A');
const other = connection('https://example.test', 'secret-other', 'identity-B');
const id = n => `mob_123e4567-e89b-12d3-a456-${String(n).padStart(12, '0')}`;
const draft = (n, text = `text-${n}`, conn = config) => newSend(conn, 'thread', text, id(n));
const receipt = (r, state = 'queued') => ({ id: `receipt-${r.clientMessageId}`, client_message_id: r.clientMessageId, thread_id: r.threadId, durable: true, state });
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Store {
  data = new Map();
  fail = null;
  async getItemAsync(key) { if (this.fail?.('get', key)) throw new Error('secure storage unavailable'); return this.data.get(key) ?? null; }
  async setItemAsync(key, value) { if (this.fail?.('set', key)) throw new Error('secure storage unavailable'); this.data.set(key, value); }
  async deleteItemAsync(key) { if (this.fail?.('delete', key)) throw new Error('secure storage unavailable'); this.data.delete(key); }
}
const sdk = (send = async (thread, clientId, text) => receipt({ threadId: thread, clientMessageId: clientId })) => ({
  sends: [], receipts: new Map(), messages: new Map(), queries: [],
  async send(...args) { this.sends.push(args); return send(...args); },
  async getReceipt(receiptId) { this.queries.push(receiptId); return this.receipts.get(receiptId); },
  async historyTail() { return []; }
});
const make = (store = new Store(), client = sdk(), conn = config, clock = () => Date.now()) => {
  const updates = []; const notices = [];
  const box = new MobileOutbox(new OutboxStore(store, conn), client, (items, notice) => { updates.push(items); if (notice) notices.push(notice); }, clock, () => 0);
  return { box, updates, notices, store, client };
};

test('offline multiple records durable before network, exact UTF-8 chunks and migration', async () => {
  const store = new Store();
  const original = draft(1, '✨汉字'.repeat(900));
  store.data.set(LEGACY_SEND_KEY, JSON.stringify(original));
  const { box, client } = make(store);
  await box.start();
  await box.enqueue(draft(2));
  assert.deepEqual(box.records.map(r => r.clientMessageId), [id(1), id(2)]);
  assert.equal(box.records[0].text, original.text);
  assert.equal(box.records[0].status, 'ambiguous');
  assert.equal(client.sends.length, 0);
  assert.equal(store.data.has(LEGACY_SEND_KEY), false);
  for (const [key, value] of store.data) if (key.includes(':part:')) assert.ok(Buffer.byteLength(value) <= 768, key);
  await box.stop();
  const resumed = make(store);
  await resumed.box.start();
  assert.deepEqual(resumed.box.records.map(r => r.text), [original.text, 'text-2']);
  await resumed.box.stop();
});

test('ACK loss retries the original ID/body, never runs concurrent duplicate drain', async () => {
  let now = 1000, calls = 0;
  const seen = new Map();
  const client = sdk(async (thread, clientId, text) => {
    calls++;
    const key = clientId;
    if (!seen.has(key)) seen.set(key, receipt({ threadId: thread, clientMessageId: clientId }));
    if (calls === 1) throw new TypeError('Network request failed');
    return seen.get(key);
  });
  const { box } = make(new Store(), client, config, () => now);
  await box.start();
  await box.enqueue(draft(3, '  original\n中文  '));
  box.setConnection('online'); box.setConnection('online');
  await flush();
  assert.equal(calls, 1);
  assert.equal(box.records[0].status, 'ambiguous');
  now += 1000;
  box.setConnection('retrying'); box.setConnection('online'); box.setConnection('online');
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(client.sends.map(args => args.slice(0, 3)), [
    ['thread', id(3), '  original\n中文  '], ['thread', id(3), '  original\n中文  ']
  ]);
  assert.equal(box.records[0].status, 'accepted');
  box.setConnection('online'); await flush(); assert.equal(calls, 2);
  await box.stop();
});

test('older accepted receipt survives newer send and is fetched after cold restart, unknown is not replayed', async () => {
  const store = new Store(); const first = make(store);
  await first.box.start(); first.box.setConnection('online');
  await first.box.enqueue(draft(4)); await flush();
  await first.box.enqueue(draft(5)); await flush();
  assert.deepEqual(first.box.records.map(r => r.status), ['accepted', 'accepted']);
  await first.box.stop();
  const remote = sdk();
  const authoritative = new Map([[receipt(draft(4)).id, receipt(draft(4), 'completed')], [receipt(draft(5)).id, receipt(draft(5), 'unknown')]]);
  remote.getReceipt = async receiptId => { remote.queries.push(receiptId); return authoritative.get(receiptId); };
  const revived = make(store, remote);
  await revived.box.start(); revived.box.setConnection('online'); revived.box.reconcile(); await flush();
  assert.deepEqual(remote.queries.sort(), [receipt(draft(4)).id, receipt(draft(5)).id].sort());
  assert.deepEqual(revived.box.records.map(r => r.receiptState), ['completed', 'unknown']);
  assert.equal(remote.sends.length, 0);
  await revived.box.stop();
});

test('terminal receipt removed only after exact matching server identity, not matching text', async () => {
  const remote = sdk(); const { box } = make(new Store(), remote);
  await box.start(); box.setConnection('online'); await box.enqueue(draft(6, 'same')); await flush();
  remote.receipts.set(receipt(draft(6)).id, receipt(draft(6), 'completed'));
  remote.messages.set('thread', [{ role: 'user', client_message_id: id(7), text: 'same' }]);
  box.reconcile(); await flush(); assert.equal(box.records.length, 1);
  remote.messages.set('thread', [{ role: 'user', client_message_id: id(6), text: 'same' }]);
  box.reconcile(); await flush(); assert.equal(box.records.length, 0);
  await box.stop();
});

test('bounded capacity is explicit and storage failures never dispatch or silently discard', async () => {
  const store = new Store(), client = sdk(); const { box } = make(store, client);
  await box.start();
  for (let n = 10; n < 34; n++) await box.enqueue(draft(n));
  await assert.rejects(box.enqueue(draft(34)), /已满/);
  assert.equal(box.records.length, 24);
  assert.equal(box.records[0].text, 'text-10');
  await box.stop();
  const bad = new Store(), blocked = make(bad);
  await blocked.box.start();
  bad.fail = (verb, key) => verb === 'set' && key.includes(':part:');
  await assert.rejects(blocked.box.enqueue(draft(35)), /secure storage unavailable/);
  blocked.box.setConnection('online'); await flush();
  assert.equal(blocked.client.sends.length, 0);
  await blocked.box.stop();
  bad.fail = null;
  const restored = make(bad);
  await restored.box.start(); assert.equal(restored.box.records.length, 0);
  await restored.box.stop();
  await assert.rejects(make(new Store()).box.enqueue(draft(36, 'a'.repeat(65537))), /64 KiB/);
});

test('foreground racing sends and stop fences late ACK; identity switch cannot leak or resurrect after logout', async () => {
  const store = new Store(), gate = deferred();
  const oldSdk = sdk(() => gate.promise); const a = make(store, oldSdk);
  await a.box.start(); a.box.setConnection('online'); await a.box.enqueue(draft(40)); await flush();
  assert.equal(oldSdk.sends.length, 1);
  const stopping = a.box.stop();
  const b = make(store, sdk(), other);
  await b.box.start(); b.box.setConnection('online'); await b.box.enqueue(draft(41, 'new', other)); await flush();
  assert.deepEqual(b.box.records.map(r => r.clientMessageId), [id(41)]);
  gate.resolve(receipt(draft(40))); await stopping; await flush();
  assert.equal(a.box.records[0].status, 'sending'); // crashed/closed while request in flight
  assert.equal(b.box.records[0].status, 'accepted');
  await b.box.stop();
  await a.box.storage.clear();
  const afterLogout = make(store);
  await afterLogout.box.start(); assert.equal(afterLogout.box.records.length, 0);
  await afterLogout.box.stop();
});

test('accepted metadata write failure cannot create an automatic re-execution loop', async () => {
  const store = new Store(), client = sdk(); const notices = [];
  const box = new MobileOutbox(new OutboxStore(store, config), client, (_, notice) => { if (notice) notices.push(notice); });
  await box.start(); await box.enqueue(draft(50));
  let fail = true;
  store.fail = (verb, key) => verb === 'set' && key.includes('hermes-outbox-v1') && !key.includes(':part:') && store.data.get(key)?.includes('"status":"sending"') && fail;
  box.setConnection('online'); await flush();
  assert.equal(client.sends.length, 1);
  assert.ok(notices.some(x => x.includes('接收')));
  box.setConnection('retrying'); box.setConnection('online'); await flush();
  assert.equal(client.sends.length, 1);
  fail = false; await box.stop();
});

test('pre-send status write failure cannot reach network; receipt 404 does not block newer sends', async () => {
  const store = new Store(), client = sdk(); const { box } = make(store, client);
  await box.start(); await box.enqueue(draft(60));
  store.fail = (verb, key) => verb === 'set' && key.endsWith(':0');
  box.setConnection('online'); await flush();
  assert.equal(client.sends.length, 0);
  assert.equal(box.records[0].status, 'queued');
  store.fail = null; await box.stop();

  const seeded = make(new Store());
  await seeded.box.start(); seeded.box.setConnection('online'); await seeded.box.enqueue(draft(61)); await flush();
  await seeded.box.stop();
  const resumedSdk = sdk();
  resumedSdk.getReceipt = async () => { throw Object.assign(new Error('not found'), { status: 404 }); };
  const resumed = make(seeded.store, resumedSdk);
  await resumed.box.start(); resumed.box.setConnection('online'); resumed.box.reconcile(); await flush();
  await resumed.box.enqueue(draft(62)); await flush();
  assert.equal(resumedSdk.sends.length, 1);
  assert.deepEqual(resumed.box.records.map(r => r.clientMessageId), [id(61), id(62)]);
  await resumed.box.stop();
});

test('corrupt committed chunk prevents loading and cannot be overwritten by new send', async () => {
  const store = new Store(), initial = make(store);
  await initial.box.start(); await initial.box.enqueue(draft(70, 'persistent'));
  await initial.box.stop();
  const chunkKey = [...store.data.keys()].find(key => key.includes(':part:'));
  store.data.set(chunkKey, 'tampered');
  const resumed = make(store);
  await assert.rejects(resumed.box.start(), /不完整/);
  await assert.rejects(resumed.box.enqueue(draft(71)), /本机待发状态异常/);
  assert.equal(store.data.get(chunkKey), 'tampered');
  await resumed.box.stop();
});

test('permanent server rejection does not retry; 429 Retry-After and 5xx backoff are classified', async () => {
  const err = (status, retryAfterMs) => Object.assign(new Error(`HTTP ${status}`), { status, retryAfterMs });
  assert.equal(retryable(err(403)), false);
  assert.equal(retryable(err(429, 7000)), true);
  assert.equal(retryable(err(503)), true);
  assert.equal(delayFor(1, err(429, 7000), () => 0), 7000);
  const client = sdk(async () => { throw err(403); }); const { box } = make(new Store(), client);
  await box.start(); await box.enqueue(draft(51)); box.setConnection('online'); await flush();
  assert.equal(box.records[0].status, 'blocked');
  box.setConnection('retrying'); box.setConnection('online'); await flush(); assert.equal(client.sends.length, 1);
  await box.stop();
});
