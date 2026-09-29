import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../../../packages/client/dist/index.js';
import { projectTimeline } from '../src/timeline.ts';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { accepted, newSend } from '../src/send.ts';

const config = { id: 'connection', baseUrl: 'https://example.com', token: 'test' };
const id = 'mob_12345678-1234-1234-1234-123456789abc';
const receipt = (state = 'running') => ({ id: 'r', client_message_id: id, thread_id: 'th', state, durable: true, ref_seq: 8, admission: 'followup' });
const message = { id: 'm', ref_seq: 8, role: 'user', text: '补充', client_message_id: id, receipt_id: 'r' };
const reaction = r => projectTimeline([message], null, 'th', undefined, true, [], new Map([['r', r]]))[0].reaction;

test('multiple followups without callbacks never borrow the primary completion', () => {
  const r = receipt();
  const second = { ...message, id: 'm2', ref_seq: 9, client_message_id: 'second', receipt_id: 'r2' };
  const cache = new Map([['r', { ...r, handed_off: true }], ['r2', { ...r, id: 'r2', client_message_id: 'second', state: 'completed', processing: null }], ['primary', { ...r, id: 'primary', client_message_id: 'other', state: 'completed', processing: 'completed', admission: undefined }]]);
  const rows = projectTimeline([message, second], null, 'th', undefined, true, [], cache);
  assert.deepEqual(rows.map(row => row.reaction), [undefined, undefined]);
  assert.equal(reaction({ ...r, handed_off: true, processing: 'running' }).emoji, '👀');
  assert.equal(reaction({ ...receipt('completed'), processing: 'completed' }).label, 'Completed');
  assert.equal(reaction({ ...receipt('unknown'), processing: 'completed' }).label, 'Completed', 'actual callback beats unknown receipt bookkeeping');
  assert.equal(reaction({ ...receipt('completed'), processing: 'failed' }).label, 'Failed');
  assert.equal(reaction({ ...r, processing: 'interrupted' }), undefined);
  assert.equal(reaction({ ...r, thread_id: 'foreign', processing: 'completed' }), undefined);
  assert.deepEqual(reaction(receipt('received')), { emoji: '✅', label: 'Handled', source: 'agent' });
  assert.equal(reaction(receipt('completed')).label, 'Handled', 'legacy followup confirms handoff, not task completion');
  assert.equal(reaction({ ...receipt('completed'), admission: undefined }), undefined);
});

test('SDK validates admission from authenticated server without inventing it for old receipts', async () => {
  let value = receipt();
  const client = new HermesClient({ token: () => 'test', http: { async request() { return { status: 200, body: { receipt: value } }; } }, socket: { connect() {} } });
  assert.equal((await client.getReceipt('r')).admission, 'followup');
  value = { ...value, handed_off: true };
  assert.equal((await client.getReceipt('r')).handed_off, true);
  value = { ...value, handed_off: 'true' };
  await assert.rejects(client.getReceipt('r'), ProtocolError);
  value = receipt();
  value = { ...value, admission: undefined };
  assert.equal((await client.getReceipt('r')).admission, undefined);
  value = { ...value, admission: 'completed-steer' };
  await assert.rejects(client.getReceipt('r'), ProtocolError);
});

test('durable callback survives cold outbox restoration and truthful unknown update', async () => {
  const data = new Map();
  const kv = { async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } };
  const store = new OutboxStore(kv, config);
  await store.load();
  const record = newSend(config, 'th', '补充', id);
  await store.enqueue(record);
  await store.update(accepted(record, { ...receipt(), processing: 'running' }));
  const cold = new OutboxStore(kv, config);
  const records = await cold.load();
  assert.equal(records[0].receiptAdmission, 'followup');
  assert.equal(records[0].receiptProcessing, 'running');
  const rows = projectTimeline([], null, 'th', undefined, true, records);
  assert.equal(rows[0].reaction.emoji, '👀');
  assert.equal(rows[0].status, 'accepted');
  await cold.update(accepted(records[0], { ...receipt('unknown'), processing: 'unknown' }));
  const again = new OutboxStore(kv, config);
  const restored = await again.load();
  assert.equal(projectTimeline([], null, 'th', undefined, true, restored)[0].reaction.label, 'Outcome unknown');
});

test('received input remains visible until exact authoritative identity arrives', async () => {
  const local = accepted(newSend(config, 'th', '补充一', id), receipt('received'));
  const pending = projectTimeline([], null, 'th', undefined, true, [local]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].text, '补充一');
  assert.equal(pending[0].reaction.label, 'Handled');
  const foreign = { ...message, client_message_id: 'another', text: '补充一' };
  assert.equal(projectTimeline([foreign], null, 'th', undefined, true, [local]).length, 2, 'equal text is not identity');
  const input = { id: 'receipt:r', ref_seq: 8, role: 'user', text: '补充一', client_message_id: id, receipt_id: 'r' };
  const client = new HermesClient({ token: () => 'test', http: { async request() { return { status: 200, body: { messages: [input], next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }, socket: { connect() {} } });
  await client.history('th');
  const result = projectTimeline(client.messages.get('th'), null, 'th', undefined, true, [local], new Map([['r', receipt('received')]]));
  assert.equal(result.length, 1);
  assert.equal(result[0].key, pending[0].key, 'confirmation preserves the optimistic row identity');
  assert.equal(result[0].reaction.label, 'Handled');
  assert.equal(result[0].receipt.id, 'r');
  const data = new Map();
  const kv = { async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } };
  const store = new OutboxStore(kv, config); await store.load(); await store.enqueue(local);
  await store.removeConfirmed(id);
  assert.equal((await new OutboxStore(kv, config).load()).length, 0);
});

test('interleaved input/output keeps server order across replay, cold history and equal inputs', async () => {
  const id2 = 'mob_22345678-1234-1234-1234-123456789abc';
  const inputs = [
    { id: 'receipt:r', ref_seq: 12, role: 'user', text: '相同补充', client_message_id: id, receipt_id: 'r' },
    { id: 'receipt:r2', ref_seq: 14, role: 'user', text: '相同补充', client_message_id: id2, receipt_id: 'r2' }
  ];
  const stream = [
    { id: 'a1', ref_seq: 11, role: 'assistant', text: '开始处理' }, inputs[0],
    { id: 'a2', ref_seq: 13, role: 'assistant', text: '', tool_calls: [{ id: 'call', name: 'read_file', label: '读取文件' }] }, inputs[1],
    { id: 'a3', ref_seq: 15, role: 'assistant', text: '按补充继续' }
  ];
  let page = stream.slice(0, 3);
  const makeClient = () => new HermesClient({ token: () => 'test', http: { async request() { return { status: 200, body: { messages: page, next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }, socket: { connect() {} } });
  const client = makeClient(); await client.history('th');
  page = stream.slice(2); await client.history('th'); await client.history('th');
  const pending = [id, id2].map((key, index) => accepted(newSend(config, 'th', '相同补充', key), { ...receipt('received'), id: index ? 'r2' : 'r', client_message_id: key, ref_seq: index ? 14 : 12 }));
  const project = c => projectTimeline(c.messages.get('th'), null, 'th', undefined, true, pending);
  const rows = project(client);
  assert.deepEqual(rows.map(r => r.refSeq), [11, 12, 13, 14, 15]);
  assert.deepEqual(rows.filter(r => r.role === 'user').map(r => r.key), [`local:${id}`, `local:${id2}`]);
  assert.equal(rows[2].toolCalls[0].id, 'call');
  page = stream; const cold = makeClient(); await cold.history('th');
  assert.deepEqual(project(cold), rows);
  const unresolved = accepted(newSend(config, 'th', '尚无原文引用', id), receipt('completed'));
  assert.equal(projectTimeline([], null, 'th', undefined, true, [unresolved])[0].reaction.label, 'Handled');
});

test('received followup survives successful history sync until its exact input is available', async () => {
  const data = new Map();
  const kv = { async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } };
  const store = new OutboxStore(kv, config); await store.load();
  await store.enqueue(accepted(newSend(config, 'th', '停止前的补充', id), receipt('received')));
  let syncs = 0;
  const sdk = { receipts: new Map([['r', receipt('received')]]), messages: new Map(), supportsLatest: true,
    async getReceipt() { return receipt('received'); },
    async send() { assert.fail('received input must never be sent again'); },
    async historyTail() { syncs++; }
  };
  const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)); };
  const box = new MobileOutbox(store, sdk, () => {}, () => 1000);
  try {
    await box.start(); box.setConnection('online'); await flush();
    assert.ok(syncs > 0);
    assert.equal(box.records.length, 1, 'a receipt and empty successful sync cannot erase the only original');
    assert.equal((await new OutboxStore(kv, config).load())[0].text, '停止前的补充');
    sdk.messages.set('th', [{ ...message, id: 'receipt:r', text: '停止前的补充' }]);
    box.reconcile(); await flush();
    assert.equal(box.records.length, 0, 'exact published input permits local cleanup');
    assert.equal((await new OutboxStore(kv, config).load()).length, 0);
  } finally { await box.stop(); }
});

test('same-state processing update is persisted immediately without losing completion', async () => {
  const data = new Map();
  const kv = { async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } };
  const store = new OutboxStore(kv, config);
  await store.load();
  await store.enqueue(accepted(newSend(config, 'th', '补充', id), receipt()));
  let queries = 0;
  const sdk = {
    receipts: new Map([['r', receipt()]]), messages: new Map(), supportsLatest: true,
    async getReceipt() { queries++; return sdk.receipts.get('r'); },
    async send() { assert.fail('accepted messages must never resend'); },
    async historyTail() {},
  };
  const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)); };
  const box = new MobileOutbox(store, sdk, () => {}, () => 1000);
  try {
    await box.start(); box.setConnection('online'); await flush();
    const before = queries;
    sdk.receipts.set('r', { ...receipt(), handed_off: true });
    box.reconcile(); await flush();
    assert.equal(box.records[0].receiptHandedOff, true);
    const cold = await new OutboxStore(kv, config).load();
    assert.equal(cold[0].receiptHandedOff, true);
    assert.equal(projectTimeline([], null, 'th', undefined, true, cold)[0].reaction, undefined);
    assert.equal(queries, before, 'handoff status must not wait for another polling cycle');
    sdk.receipts.set('r', { ...receipt(), admission: undefined });
    box.reconcile(); await flush();
    assert.equal(box.records[0].receiptAdmission, undefined);
    assert.equal(queries, before, 'event metadata update must not wait for polling');
    assert.equal((await new OutboxStore(kv, config).load())[0].receiptAdmission, undefined);
    sdk.receipts.set('r', receipt()); box.reconcile(); await flush();
    assert.equal(box.records[0].receiptAdmission, 'followup');
    assert.equal((await new OutboxStore(kv, config).load())[0].receiptAdmission, 'followup');
    for (const [processing, label] of [[null, undefined], ['running', 'Working'], ['unknown', 'Outcome unknown'], ['completed', 'Completed']]) {
      sdk.receipts.set('r', { ...receipt(), processing }); box.reconcile(); await flush();
      const restored = await new OutboxStore(kv, config).load();
      assert.equal(restored[0].receiptProcessing, processing);
      assert.equal(projectTimeline([], null, 'th', undefined, true, restored)[0].reaction?.label, label);
      assert.equal(queries, before, 'same-state callback must not wait for polling');
    }
    for (const processing of [null, undefined, 'running', 'unknown']) {
      sdk.receipts.set('r', { ...receipt(), processing }); box.reconcile(); await flush();
      assert.equal(box.records[0].receiptProcessing, 'completed');
      const late = accepted(box.records[0], { ...receipt('queued'), processing });
      assert.equal(late.receiptProcessing, 'completed');
    }
    sdk.receipts.set('r', { ...receipt('unknown'), processing: 'unknown' }); box.reconcile(); await flush();
    assert.equal(box.records[0].receiptProcessing, 'completed', 'legacy unknown bookkeeping cannot erase a real completion');
    assert.equal((await new OutboxStore(kv, config).load())[0].receiptProcessing, 'completed');
  } finally { await box.stop(); }
});
