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
  validate(key) { assert.match(key, /^[A-Za-z0-9._-]+$/, `invalid SecureStore key: ${key}`); }
  async getItemAsync(key) { this.validate(key); if (this.fail?.('get', key)) throw new Error('secure storage unavailable'); return this.data.get(key) ?? null; }
  async setItemAsync(key, value) { this.validate(key); if (this.fail?.('set', key)) throw new Error('secure storage unavailable'); this.data.set(key, value); }
  async deleteItemAsync(key) { this.validate(key); if (this.fail?.('delete', key)) throw new Error('secure storage unavailable'); this.data.delete(key); }
}
const sdk = (send = async (thread, clientId, text) => receipt({ threadId: thread, clientMessageId: clientId })) => ({
  sends: [], receipts: new Map(), messages: new Map(), queries: [], supportsLatest: true,
  async send(...args) { this.sends.push(args); return send(...args); },
  async getReceipt(receiptId) { this.queries.push(receiptId); return this.receipts.get(receiptId); },
  async historyTail() { return []; }
});
const make = (store = new Store(), client = sdk(), conn = config, clock = () => Date.now(), pollMs = 12000) => {
  const updates = []; const notices = [];
  const box = new MobileOutbox(new OutboxStore(store, conn), client, (items, notice) => { updates.push(items); if (notice) notices.push(notice); }, clock, () => 0, pollMs);
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
  for (const [key, value] of store.data) if (key.includes('.part.')) assert.ok(Buffer.byteLength(value) <= 768, key);
  await box.stop();
  const resumed = make(store);
  await resumed.box.start();
  assert.deepEqual(resumed.box.records.map(r => r.text), [original.text, 'text-2']);
  await resumed.box.stop();
});

test('feedback persists across cold outbox load and same-state receipt updates without callback success', async () => {
  const store = new Store(), client = sdk(async (thread, clientId) => ({
    ...receipt({ threadId: thread, clientMessageId: clientId }, 'running'),
    feedback: '⏩ Steered into current run (iteration 2/500). Your message arrives after the next tool call.'
  }));
  const first = make(store, client);
  await first.box.start(); first.box.setConnection('online'); await first.box.enqueue(draft(50)); await flush();
  const ack = first.box.records[0].receiptFeedback;
  assert.ok(ack); assert.equal(first.box.records[0].receiptProcessing, undefined);
  await first.box.stop();
  const remote = sdk();
  const second = make(store, remote);
  await second.box.start();
  assert.equal(second.box.records[0].receiptFeedback, ack);
  remote.receipts.set(receipt(draft(50)).id, { ...receipt(draft(50), 'running'), processing: 'failed' });
  second.box.setConnection('online'); await flush();
  assert.equal(second.box.records[0].receiptFeedback, ack);
  assert.equal(second.box.records[0].receiptProcessing, 'failed');
  const nextAck = "↪ Redirected current run. I'll adjust using your correction.";
  remote.receipts.set(receipt(draft(50)).id, { ...receipt(draft(50), 'running'), feedback: nextAck });
  second.box.reconcile(); await flush();
  assert.equal(second.box.records[0].receiptFeedback, nextAck);
  assert.equal(second.box.records[0].receiptProcessing, 'failed');
  await second.box.stop();
  const third = make(store);
  await third.box.start(); assert.equal(third.box.records[0].receiptFeedback, nextAck);
  await third.box.stop();
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
  assert.deepEqual(revived.box.records.map(r => r.receiptState), ['unknown']); // final receipt and successful tail sync permit cleanup
  assert.equal(remote.sends.length, 0);
  await revived.box.stop();
});

test('terminal receipt removed only after exact matching server identity, not matching text', async () => {
  const remote = sdk(); const { box } = make(new Store(), remote);
  await box.start(); box.setConnection('online'); await box.enqueue(draft(6, 'same')); await flush();
  remote.receipts.set(receipt(draft(6)).id, receipt(draft(6), 'completed'));
  remote.messages.set('thread', [{ role: 'user', client_message_id: id(7), text: 'same' }]);
  remote.supportsLatest = false; // unanchored old-server tail cannot prove a sync
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
  bad.fail = (verb, key) => verb === 'set' && key.includes('.part.');
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
  store.fail = (verb, key) => verb === 'set' && key.includes('hermes-outbox-v2') && !key.includes('.part.') && store.data.get(key)?.includes('"status":"sending"') && fail;
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
  store.fail = (verb, key) => verb === 'set' && key.endsWith('.0');
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
  const chunkKey = [...store.data.keys()].find(key => key.includes('.part.'));
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

test('slot reuse keeps durable enqueue order across restart and only oldest same-thread send starts', async () => {
  const store = new Store(); const initial = make(store);
  await initial.box.start();
  await initial.box.enqueue(draft(100)); await initial.box.enqueue(draft(101));
  await initial.box.storage.update({ ...initial.box.records[0], status: 'accepted', receiptId: 'r', receiptState: 'completed' });
  await initial.box.storage.removeConfirmed(id(100));
  await initial.box.enqueue(draft(102)); // slot 0 reused behind slot 1
  assert.deepEqual(initial.box.records.map(r => r.clientMessageId), [id(101), id(102)]);
  await initial.box.stop();
  const gate = deferred(); const client = sdk(async (thread, clientId) => clientId === id(101) ? gate.promise : receipt({ threadId: thread, clientMessageId: clientId }));
  const resumed = make(store, client);
  await resumed.box.start();
  assert.deepEqual(resumed.box.records.map(r => r.clientMessageId), [id(101), id(102)]);
  resumed.box.setConnection('online'); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(101)]);
  gate.resolve(receipt(draft(101))); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(101), id(102)]);
  await resumed.box.stop();
});

test('ambiguous same-thread predecessor blocks followers even in backoff; other threads progress', async () => {
  let now = 1000, attempts = 0; const gate = deferred();
  const client = sdk(async (thread, clientId) => {
    if (clientId === id(110)) {
      attempts++;
      if (attempts === 1) throw new TypeError('Network request failed');
      return gate.promise;
    }
    return receipt({ threadId: thread, clientMessageId: clientId });
  });
  const { box } = make(new Store(), client, config, () => now);
  await box.start(); await box.enqueue(draft(110)); await box.enqueue(draft(111));
  await box.enqueue(newSend(config, 'other-thread', 'independent', id(112)));
  box.setConnection('online'); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(110), id(112)]);
  assert.equal(box.records.find(r => r.clientMessageId === id(110)).status, 'ambiguous');
  now += 1000; box.setConnection('retrying'); box.setConnection('online'); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(110), id(112), id(110)]);
  gate.resolve(receipt(draft(110))); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(110), id(112), id(110), id(111)]);
  await box.stop();
});

test('SecureStore keys are legal for unusual identities; worst-case Unicode survives cold restart', async () => {
  const unusual = connection('https://example.test', 'secret', '身份:with/slashes');
  const store = new Store(), first = make(store, sdk(), unusual);
  const boundary = ('a'.repeat(767) + '🙂').repeat(85); // 65,535 bytes, 86 chunks due to split waste
  assert.equal(Buffer.byteLength(boundary), 65535);
  await first.box.start(); await first.box.enqueue(draft(120, boundary, unusual));
  assert.equal([...store.data.keys()].filter(k => k.includes('.part.')).length, 86);
  await first.box.stop();
  const second = make(store, sdk(), unusual); await second.box.start();
  assert.equal(second.box.records[0].text, boundary);
  await second.box.enqueue(draft(121, '🙂'.repeat(16384), unusual));
  await assert.rejects(second.box.enqueue(draft(122, boundary + 'aa', unusual)), /64 KiB/);
  await second.box.stop();
});

test('terminal receipts outside empty latest cache free slots repeatedly across restart', async () => {
  const store = new Store(), client = sdk(async (thread, clientId) => receipt({ threadId: thread, clientMessageId: clientId }, 'completed'));
  client.getReceipt = async receiptId => { client.queries.push(receiptId); return receipt({ clientMessageId: receiptId.slice('receipt-'.length), threadId: 'thread' }, 'completed'); };
  let syncs = 0;
  client.historyTail = async () => { syncs++; return []; }; // latest page does not contain these old identities
  const first = make(store, client);
  await first.box.start(); first.box.setConnection('online');
  for (let n = 130; n < 160; n++) { await first.box.enqueue(draft(n)); await flush(); }
  assert.equal(first.box.records.length, 0);
  assert.equal(client.sends.length, 30);
  assert.ok(syncs >= 30);
  assert.equal([...store.data.keys()].filter(k => k.startsWith('hermes-outbox-v2')).length, 0);
  await first.box.stop();
  const seeded = make(store); await seeded.box.start();
  for (let n = 160; n < 184; n++) {
    await seeded.box.enqueue(draft(n));
    const record = seeded.box.records.at(-1);
    await seeded.box.storage.update({ ...record, status: 'accepted', receiptId: receipt(record).id, receiptState: 'completed' });
  }
  await seeded.box.stop();
  const recoveredSdk = sdk();
  recoveredSdk.getReceipt = async rid => {
    recoveredSdk.queries.push(rid);
    return receipt({ clientMessageId: rid.slice('receipt-'.length), threadId: 'thread' }, 'completed');
  };
  const revived = make(store, recoveredSdk); await revived.box.start();
  assert.equal(revived.box.records.length, 24);
  revived.box.setConnection('online'); await flush();
  assert.equal(recoveredSdk.queries.length, 24);
  assert.equal(revived.box.records.length, 0);
  await revived.box.enqueue(draft(184));
  await revived.box.stop();
});

test('accepted history failure retries without events, including unchanged final receipt after restart', async () => {
  const store = new Store(), client = sdk(async (thread, clientId) => receipt({ threadId: thread, clientMessageId: clientId }, 'completed'));
  let syncs = 0;
  client.historyTail = async () => { if (++syncs === 1) throw new TypeError('offline'); return []; };
  client.getReceipt = async rid => { client.queries.push(rid); return receipt(draft(170), 'completed'); };
  const { box } = make(store, client, config, () => Date.now(), 15);
  await box.start(); box.setConnection('online'); await box.enqueue(draft(170)); await flush();
  assert.equal(box.records.length, 0); // first authoritative poll retries history automatically
  assert.ok(syncs >= 2);
  await box.stop();

  const seed = make(new Store()); await seed.box.start();
  await seed.box.enqueue(draft(171));
  await seed.box.storage.update({ ...seed.box.records[0], status: 'accepted', receiptId: receipt(draft(171)).id, receiptState: 'completed' });
  await seed.box.stop();
  const remote = sdk(); let historyCalls = 0;
  remote.getReceipt = async rid => { remote.queries.push(rid); return receipt(draft(171), 'completed'); };
  remote.historyTail = async () => { if (++historyCalls === 1) throw new TypeError('offline'); return []; };
  const recovered = make(seed.store, remote, config, () => Date.now(), 15);
  await recovered.box.start(); recovered.box.setConnection('online'); await flush();
  assert.equal(recovered.box.records.length, 1);
  await new Promise(resolve => setTimeout(resolve, 50)); await flush();
  assert.equal(recovered.box.records.length, 0);
  assert.ok(remote.queries.length >= 2);
  await recovered.box.stop();
});

test('polling nonretryable receipt failures gives one notice; cleanup failure retries with a bound', async () => {
  const seed = make(); await seed.box.start(); await seed.box.enqueue(draft(180));
  await seed.box.storage.update({ ...seed.box.records[0], status: 'accepted', receiptId: receipt(draft(180)).id, receiptState: 'completed' });
  await seed.box.stop();
  const remote = sdk(); remote.getReceipt = async rid => { remote.queries.push(rid); throw Object.assign(new Error('not found'), { status: 404 }); };
  const { box, notices } = make(seed.store, remote, config, () => Date.now(), 10);
  await box.start(); box.setConnection('online');
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.ok(remote.queries.length >= 2);
  assert.equal(notices.length, 1);
  await box.stop();

  const cleanup = sdk(); cleanup.getReceipt = async rid => { cleanup.queries.push(rid); return receipt(draft(180), 'completed'); };
  const fault = make(seed.store, cleanup, config, () => Date.now(), 10);
  seed.store.fail = (verb, key) => verb === 'delete' && key.includes('.part.');
  await fault.box.start(); fault.box.setConnection('online'); await flush();
  const reads = cleanup.queries.length;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(cleanup.queries.length < reads + 10); // no tight loop under persistent failure
  assert.equal(fault.notices.length, 1);
  seed.store.fail = null;
  await new Promise(resolve => setTimeout(resolve, 30)); await flush();
  assert.equal(fault.box.records.length, 0);
  await fault.box.stop();
});

test('cold interrupted receipt clears by exact ID while following queued send advances', async () => {
  const store = new Store(), seed = make(store);
  await seed.box.start(); await seed.box.enqueue(draft(230)); await seed.box.enqueue(draft(231));
  await seed.box.storage.update({ ...seed.box.records[0], status: 'accepted', receiptId: receipt(draft(230)).id, receiptState: 'running' });
  await seed.box.stop();
  const client = sdk(async (thread, clientId) => receipt({ threadId: thread, clientMessageId: clientId }, 'queued'));
  client.getReceipt = async rid => {
    client.queries.push(rid);
    const earlier = rid === receipt(draft(230)).id;
    return receipt(draft(earlier ? 230 : 231), earlier ? 'interrupted' : 'queued');
  };
  client.historyTail = async () => { client.messages.set('thread', [{ role: 'user', client_message_id: id(230) }]); return []; };
  const revived = make(store, client);
  await revived.box.start(); revived.box.setConnection('online'); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(231)]);
  assert.deepEqual(revived.box.records.map(r => r.clientMessageId), [id(231)]);
  assert.equal(revived.box.records[0].status, 'accepted');
  await revived.box.stop();
});

test('SDK onChange during send and history does not reenter submission or duplicate IDs', async () => {
  const gate = deferred();
  const client = sdk(async (thread, clientId) => {
    const r = receipt({ threadId: thread, clientMessageId: clientId }, 'completed');
    client.receipts.set(r.id, r);
    box.reconcile(); // SDK fires onChange before its send Promise resolves
    if (clientId === id(220)) await gate.promise;
    return r;
  });
  client.historyTail = async () => { box.reconcile(); return []; };
  const store = new Store();
  const { box } = make(store, client);
  await box.start();
  await box.enqueue(draft(220)); await box.enqueue(draft(221));
  box.setConnection('online'); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(220)]);
  gate.resolve(); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(220), id(221)]);
  assert.equal(box.records.length, 0); // authoritative final receipt + latest history sync
  assert.equal([...store.data.keys()].filter(key => key.startsWith('hermes-outbox-v2')).length, 0);
  await box.stop();
});

test('durably accepted predecessor releases queued follower before stalled history catch-up', async () => {
  const gate = deferred(), store = new Store();
  const client = sdk(async (thread, clientId) => receipt({ threadId: thread, clientMessageId: clientId }, 'queued'));
  client.historyTail = async () => gate.promise;
  const { box } = make(store, client);
  await box.start();
  await box.enqueue(draft(210)); await box.enqueue(draft(211));
  box.setConnection('online'); await flush();
  assert.equal(box.records[0].status, 'accepted');
  assert.deepEqual(client.sends.map(args => args[1]), [id(210), id(211)]);
  gate.resolve([]); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(210), id(211)]);
  await box.stop();
});

test('one transient confirmed-record cleanup failure does not starve the next same-thread send', async () => {
  const store = new Store();
  const client = sdk(async (thread, clientId) => receipt({ threadId: thread, clientMessageId: clientId }, 'completed'));
  client.getReceipt = async rid => { client.queries.push(rid); return receipt({ threadId: 'thread', clientMessageId: rid.slice('receipt-'.length) }, 'completed'); };
  client.historyTail = async () => {
    client.messages.set('thread', client.sends.map(args => ({ role: 'user', client_message_id: args[1] })));
    return client.messages.get('thread');
  };
  const { box, notices } = make(store, client, config, () => Date.now(), 15);
  await box.start();
  await box.enqueue(draft(200));
  let failed = false;
  store.fail = (verb, key) => {
    if (verb !== 'delete' || !key.endsWith('.part.0') || failed) return false;
    failed = true;
    return true;
  };
  box.setConnection('online');
  await flush();
  assert.equal(failed, true);
  assert.ok(notices.some(text => text.includes('清理失败')));
  await box.enqueue(draft(201)); await flush();
  assert.deepEqual(client.sends.map(args => args[1]), [id(200), id(201)]);
  await new Promise(resolve => setTimeout(resolve, 45)); await flush();
  assert.equal(box.records.length, 0);
  assert.equal([...store.data.keys()].filter(key => key.startsWith('hermes-outbox-v2')).length, 0);
  await box.stop();
  const resumed = make(store); await resumed.box.start();
  assert.equal(resumed.box.records.length, 0);
  await resumed.box.stop();
});

test('stale cached receipt cannot regress terminal state; wrong authoritative identity cannot clean it', async () => {
  const store = new Store(), seed = make(store);
  await seed.box.start(); await seed.box.enqueue(draft(190));
  await seed.box.storage.update({ ...seed.box.records[0], status: 'accepted', receiptId: receipt(draft(190)).id, receiptState: 'completed' });
  await seed.box.stop();
  const client = sdk(); client.receipts.set(receipt(draft(190)).id, receipt(draft(190), 'queued'));
  client.getReceipt = async rid => { client.queries.push(rid); return { ...receipt(draft(190), 'completed'), client_message_id: id(191) }; };
  const { box, notices } = make(store, client);
  await box.start(); box.setConnection('online'); await flush();
  assert.equal(box.records[0].receiptState, 'completed');
  assert.equal(box.records.length, 1);
  assert.equal(notices.length, 1);
  await box.stop();
});

test('late receipt after stop cannot mutate persisted metadata or revive polling', async () => {
  const store = new Store(), seed = make(store);
  await seed.box.start(); await seed.box.enqueue(draft(192));
  await seed.box.storage.update({ ...seed.box.records[0], status: 'accepted', receiptId: receipt(draft(192)).id, receiptState: 'queued' });
  await seed.box.stop();
  const gate = deferred(), client = sdk();
  client.getReceipt = async () => gate.promise;
  const { box } = make(store, client);
  await box.start(); box.setConnection('online'); await flush();
  const stopping = box.stop();
  gate.resolve(receipt(draft(192), 'completed'));
  await stopping;
  const resumed = make(store); await resumed.box.start();
  assert.equal(resumed.box.records[0].receiptState, 'queued');
  await resumed.box.stop();
});
