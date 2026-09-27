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
  const feedback = '⏩ Steered into current run (iteration 2/500). Your message arrives after the next tool call.';
  const sdk = new HermesClient({ token: () => 'test', socket: { connect() {} }, http: { async request(_method, path) {
    if (path.startsWith('/v1/snapshot')) return { status: 200, body: { threads: [{ id: 'th', project_id: 'p', title: 'Thread', archived: 0, last_ref: 0, read_ref: 0, unread_count: 0, active_receipts: [{ ...base, processing, feedback }] }], waterline: 'c1', next_after: null } };
    if (path === '/v1/channels') return { status: 200, body: { channels: [] } };
    return { status: 200, body: { receipt: { ...base, processing } } };
  } } });
  await sdk.snapshot();
  assert.equal(sdk.receipts.get('r').processing, 'running');
  assert.equal(sdk.receipts.get('r').feedback, feedback);
  processing = 'completed';
  await sdk.getReceipt('r');
  assert.equal(sdk.receipts.get('r').processing, 'completed');
  assert.equal(sdk.receipts.get('r').feedback, feedback);
});

test('feedback accepts exact native ACK text, rejects malformed values, survives omitted same-state and late ACK', async () => {
  const modes = [
    '⏩ Steered into current run (iteration 2/500). Your message arrives after the next tool call.',
    '⏩ Steered into current run and its active subagent(s). Your message arrives after their next tool call.',
    "↪ Redirected current run. I'll adjust using your correction.",
    "⏳ Queued for the next turn. I'll respond once the current task finishes.",
    '⏳ Subagent working — your message is queued for when it finishes (use /stop to cancel everything).',
    '⏳ Compressing context — your message is queued for when it finishes (use /stop to cancel everything).',
    "⚡ Interrupting current task. I'll respond to your message shortly."
  ];
  const source = { value: base }, sdk = makeClient(source);
  for (const feedback of modes) {
    source.value = { ...base, feedback };
    assert.equal((await sdk.getReceipt('r')).feedback, feedback);
    assert.equal((await makeClient(source).getReceipt('r')).feedback, feedback);
  }
  const prior = modes.at(-1);
  source.value = { ...base, state: 'completed', processing: 'failed' };
  assert.equal((await sdk.getReceipt('r')).feedback, prior);
  source.value = { ...base, state: 'running' };
  assert.equal((await sdk.send('th', 'client', 'hello')).feedback, prior);
  for (const feedback of ['', null, 4, {}, 'a'.repeat(2001)]) {
    source.value = { ...base, feedback };
    await assert.rejects(sdk.getReceipt('r'), ProtocolError);
    assert.equal(sdk.receipts.get('r').feedback, prior);
  }
  source.value = { ...base, feedback: 'x'.repeat(2000) };
  assert.equal((await sdk.getReceipt('r')).feedback.length, 2000);
});
