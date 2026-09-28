import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

const receipt = (state = 'unknown', ref_seq) => ({ id: 'r', client_message_id: 'c', thread_id: 't', state, durable: true, ...(ref_seq === undefined ? {} : { ref_seq }) });
function fixture(value) {
  const source = { value };
  source.sdk = new HermesClient({ token: () => 'test', socket: { connect() {} }, http: {
    async request() { return { status: 200, body: { receipt: source.value } }; }
  } });
  return source;
}

test('receipt keeps stable reference through recovery, terminal fence and late ACK omission', async () => {
  const f = fixture(receipt());
  assert.equal((await f.sdk.getReceipt('r')).ref_seq, undefined);
  f.value = { ...receipt('unknown', 323), processing: 'completed' };
  assert.equal((await f.sdk.getReceipt('r')).ref_seq, 323);
  f.value = receipt('completed', 323);
  assert.equal((await f.sdk.getReceipt('r')).state, 'completed');
  assert.equal(f.sdk.receipts.get('r').processing, 'completed');
  for (const state of ['queued', 'running', 'unknown']) {
    f.value = receipt(state);
    const r = await f.sdk.getReceipt('r');
    assert.equal(r.state, 'completed'); assert.equal(r.ref_seq, 323);
  }
  f.value = receipt('completed', 324);
  await assert.rejects(f.sdk.getReceipt('r'), ProtocolError);
  assert.equal(f.sdk.receipts.get('r').ref_seq, 323);
});

test('reference enrichment is independent of lifecycle fence; malformed refs rejected', async () => {
  const f = fixture(receipt('completed'));
  await f.sdk.getReceipt('r');
  f.value = receipt('queued', 7);
  assert.equal((await f.sdk.getReceipt('r')).state, 'completed');
  assert.equal(f.sdk.receipts.get('r').ref_seq, 7);
  for (const ref of [null, 0, -1, 1.5, '7', true, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = fixture(receipt('unknown', ref));
    await assert.rejects(bad.sdk.getReceipt('r'), ProtocolError);
    assert.equal(bad.sdk.receipts.size, 0);
  }
});

test('new send exposes durable position before history and permits proven unknown recovery', async () => {
  for (const state of ['completed', 'failed', 'interrupted']) {
    const f = fixture(receipt('unknown', 9));
    assert.equal((await f.sdk.send('t', 'c', '/usage')).ref_seq, 9);
    f.value = receipt(state, 9);
    assert.equal((await f.sdk.getReceipt('r')).state, state);
  }
});
