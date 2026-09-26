import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BASE, accepted, connection, editConnection, newSend, restoreSend, retrySend, sendDescription } from '../src/send.ts';

const id1 = 'mob_123e4567-e89b-12d3-a456-426614174000';
const id2 = 'mob_123e4567-e89b-12d3-a456-426614174001';
const config = connection(DEFAULT_BASE + '/', ' secret ', 'one');

test('changing origin never reuses a saved credential', () => {
  assert.throws(() => editConnection(config, 'https://other.example', '', 'new'));
  assert.deepEqual(editConnection(config, DEFAULT_BASE + '/', '', 'new'), config);
  const other = editConnection(config, 'https://other.example', 'other-token', 'new');
  assert.equal(other.token, 'other-token');
  assert.equal(other.id, 'new');
  assert.equal(editConnection(config, DEFAULT_BASE, 'rotated-token', 'new').id, 'new');
});

test('HTTPS origin only; no credential or path in persisted URL', () => {
  assert.equal(config.baseUrl, DEFAULT_BASE);
  assert.equal(config.token, 'secret');
  for (const bad of ['http://agent.tuly.space', 'https://u:p@agent.tuly.space', 'https://agent.tuly.space/v1', 'https://agent.tuly.space?token=x', 'https://agent.tuly.space/#a']) {
    assert.throws(() => connection(bad, 'secret', 'one'));
  }
  assert.throws(() => connection(DEFAULT_BASE, '', 'one'));
});

test('ambiguous send survives restart and retry preserves exact ID, thread and body', () => {
  const original = newSend(config, 'th_1', ' 你好\n ', id1);
  const restored = restoreSend(JSON.stringify(original), config);
  assert.equal(restored?.status, 'ambiguous');
  const retry = retrySend(config, restored);
  assert.deepEqual([retry.threadId, retry.clientMessageId, retry.text], ['th_1', id1, ' 你好\n ']);
  assert.match(sendDescription(restored), /原 ID 和原文/);
  assert.throws(() => retrySend(connection(DEFAULT_BASE, 'other', 'two'), restored));
  assert.equal(restoreSend(JSON.stringify(original), connection(DEFAULT_BASE, 'other', 'two')), null);
});

test('receipt is durable only when exact identity matches; independent new send gets new ID', () => {
  const first = newSend(config, 'th_1', 'same body', id1);
  const receipt = { id: 'rc_1', client_message_id: id1, thread_id: 'th_1', durable: true, state: 'queued' };
  const done = accepted(first, receipt);
  assert.equal(restoreSend(JSON.stringify(done), config)?.receiptId, 'rc_1');
  assert.throws(() => retrySend(config, done));
  assert.throws(() => accepted(first, { ...receipt, thread_id: 'th_2' }));
  const second = newSend(config, 'th_1', 'same body', id2);
  assert.notEqual(second.clientMessageId, first.clientMessageId);
});

test('corrupt saved send refuses unsafe retry', () => {
  assert.throws(() => restoreSend('{"connectionId":"one","threadId":"th_1","text":"x","clientMessageId":"bad","status":"sending"}', config));
  assert.throws(() => newSend(config, 'th_1', ' ', id1));
});
