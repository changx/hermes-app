import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

function client(messages) {
  const sdk = new HermesClient({ token: () => 'test-token',
    socket: { async connect() { throw new Error('not used'); } },
    http: { async request() { return { status: 200, body: { messages, next_cursor: null, older_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }
  });
  sdk.supportsLatest = true;
  return sdk;
}
const message = (id, ref, createdAt) => ({ id, ref_seq: ref, role: 'assistant', text: '原文保持不变', ...(createdAt === undefined ? {} : { created_at: createdAt }) });

test('message times survive history, latest and search without changing reference order', async () => {
  const messages = [message('second', 2, 1000.25), message('first', 1, 2000.5)];
  const sdk = client(messages);
  assert.deepEqual((await sdk.history('thread')).messages.map(m => m.created_at), [1000.25, 2000.5]);
  assert.deepEqual(sdk.messages.get('thread').map(m => [m.id, m.created_at]), [['first', 2000.5], ['second', 1000.25]]);
  assert.equal((await sdk.historyWindow('thread')).messages[0].created_at, 1000.25);
  assert.equal((await sdk.search('thread', '原文')).messages[0].created_at, 1000.25);
  assert.equal(sdk.messages.get('thread')[0].text, '原文保持不变');
  const fresh = client(messages);
  assert.deepEqual((await fresh.history('thread')).messages, (await sdk.history('thread')).messages);
});

test('legacy missing timestamps remain absent and epoch zero is valid', async () => {
  const sdk = client([message('legacy', 1), message('epoch', 2, 0), message('max', 3, 8.64e12)]);
  const { messages } = await sdk.history('thread');
  assert.equal(Object.hasOwn(messages[0], 'created_at'), false);
  assert.equal(messages[1].created_at, 0);
  assert.equal(messages[2].created_at, 8.64e12);
});

test('malformed timestamps are rejected before they enter the SDK cache', async () => {
  for (const timestamp of [null, true, -1, NaN, Infinity, -Infinity, '1234', {}, [], 8.64e12 + 1]) {
    const sdk = client([message('bad', 1, timestamp)]);
    await assert.rejects(sdk.history('thread'), ProtocolError);
    assert.equal(sdk.messages.has('thread'), false);
    await assert.rejects(sdk.search('thread', 'original'), ProtocolError);
    await assert.rejects(sdk.historyWindow('thread'), ProtocolError);
  }
});
