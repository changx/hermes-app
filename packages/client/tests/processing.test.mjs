import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

const base = { id: 'r', thread_id: 'th', client_message_id: 'client', state: 'running', durable: true };
const makeClient = source => new HermesClient({ token: () => 'test', http: { async request(method) { return { status: 200, body: { receipt: source.value } }; } }, socket: { connect() {} } });

test('processing validates nullable callback, preserves legacy omission and same-state changes', async () => {
  const source = { value: { ...base, processing: null } };
  const sdk = makeClient(source);
  assert.equal((await sdk.getReceipt('r')).processing, null);
  for (const processing of ['running', 'completed', 'failed', 'interrupted', 'unknown', null]) {
    source.value = { ...base, processing };
    const fresh = makeClient(source);
    assert.equal((await fresh.getReceipt('r')).processing, processing);
    assert.equal(fresh.receipts.get('r').processing, processing);
  }
  source.value = { ...base, processing: 'completed' };
  await sdk.getReceipt('r');
  source.value = { ...base, processing: 'unknown' };
  assert.equal((await sdk.getReceipt('r')).processing, 'completed');
  source.value = { ...base }; // old server/late ACK omits callback field
  assert.equal((await sdk.getReceipt('r')).processing, 'completed');
  assert.equal((await sdk.send('th', 'client', 'hello')).processing, 'completed');
  for (const processing of ['done', 'queued', 1, false, {}, []]) {
    source.value = { ...base, processing };
    await assert.rejects(sdk.getReceipt('r'), ProtocolError);
    assert.equal(sdk.receipts.get('r').processing, 'completed');
  }
});

test('cold authenticated receipt fetch does not infer success from terminal state or handoff', async () => {
  const source = { value: { ...base, state: 'completed', admission: 'followup', handed_off: true, processing: null } };
  const first = makeClient(source);
  assert.equal((await first.getReceipt('r')).processing, null);
  const cold = makeClient(source);
  assert.equal((await cold.getReceipt('r')).processing, null);
  source.value = { ...base, state: 'unknown', processing: 'completed' };
  assert.equal((await cold.getReceipt('r')).processing, 'completed');
});

test('late ACK cannot clear or restart a terminal callback', async () => {
  for (const final of ['completed', 'failed', 'interrupted']) {
    const source = { value: { ...base, state: 'completed', processing: final } };
    const sdk = makeClient(source);
    await sdk.getReceipt('r');
    for (const state of ['completed', 'running', 'queued']) {
      for (const processing of [null, undefined, 'running', 'unknown']) {
        source.value = { ...base, state, processing };
        assert.equal((await sdk.send('th', 'client', 'hello')).processing, final);
        assert.equal(sdk.receipts.get('r').processing, final);
      }
    }
  }
});

test('snapshot active receipt preserves callback through cold projection and later same-state fetch', async () => {
  let processing = 'running';
  const sdk = new HermesClient({ token: () => 'test', socket: { connect() {} }, http: { async request(_method, path) {
    if (path.startsWith('/v1/snapshot')) return { status: 200, body: { threads: [{ id: 'th', project_id: 'p', title: 'Thread', archived: 0, last_ref: 0, read_ref: 0, unread_count: 0, active_receipts: [{ ...base, processing }] }], waterline: 'c1', next_after: null } };
    if (path === '/v1/channels') return { status: 200, body: { channels: [] } };
    return { status: 200, body: { receipt: { ...base, processing } } };
  } } });
  await sdk.snapshot();
  assert.equal(sdk.receipts.get('r').processing, 'running');
  processing = 'completed';
  await sdk.getReceipt('r');
  assert.equal(sdk.receipts.get('r').processing, 'completed');
});
