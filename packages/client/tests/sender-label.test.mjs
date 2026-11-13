import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../dist/index.js';
const { HermesClient, HttpError, isRetryableError } = client;

const fixture = messages => new HermesClient({
  token: () => 'synthetic-device', socket: { connect: async () => { throw Error('unexpected socket'); } },
  http: { request: async () => ({ status: 200, body: { messages, complete: true, receipts: [], older_cursor: null, next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }) },
});
const row = (sender, ref_seq = 1) => ({ id: `m${ref_seq}`, ref_seq, role: 'user', text: '[Wang.Sheng-1] hello', created_at: 1700000000.125, ...(sender === undefined ? {} : { sender }) });

test('sender parsing: present-valid, absent and invalid fields do not drop history/snapshot rows', async () => {
  const invalid = ['', null, 1, true, {}, [], '1bob', '_bob', 'bob smith', ' bob', 'bob ', 'a'.repeat(33), '王生', 'bob\n', 'bob\r', 'bob\u202e', '[bob]'];
  const inputs = [row('Wang.Sheng-1'), row(undefined, 2), ...invalid.map((v, i) => row(v, i + 3)), { ...row('bob', 30), role: 'assistant' }];
  const sdk = fixture(inputs);
  sdk.supportsFullHistory = true;
  sdk.supportsLatest = true;
  for (const page of [await sdk.history('th_sender'), await sdk.historyWindow('th_sender'), await sdk.search('th_sender', 'hello')]) {
    assert.equal(page.messages.length, inputs.length);
    assert.equal(page.messages[0].sender, 'Wang.Sheng-1');
    assert.ok(page.messages.slice(1).every(m => !Object.hasOwn(m, 'sender')));
    assert.ok(page.messages.every(m => m.text === '[Wang.Sheng-1] hello'));
    assert.equal(page.messages[0].created_at, 1700000000.125);
  }
  assert.equal(sdk.messages.get('th_sender').length, inputs.length);
});

test('sender parsing preserves case and the one- and 32-character limits', async () => {
  const inputs = ['A', 'a', 'A' + '1_-.'.repeat(7) + 'xyz'];
  const page = await fixture(inputs.map(row)).history('th_sender');
  assert.deepEqual(page.messages.map(m => m.sender), inputs);
});

test('display, copy and edit text remove only the exact leading member prefix once', () => {
  const text = client.userMessageText;
  for (const [message, expected] of [
    [{ role: 'user', sender: 'bob', text: '[bob] hello' }, 'hello'],
    [{ role: 'user', sender: 'bob', text: '[bob] [bob] hello' }, '[bob] hello'],
    [{ role: 'user', sender: 'bob', text: '[bob] ' }, ''],
    [{ role: 'user', sender: 'bob', text: '[bob]' }, ''],
    [{ role: 'user', sender: 'bob', text: '[bob]  hello\n中文  ' }, ' hello\n中文  '],
    [{ role: 'user', text: '[bob] hello' }, '[bob] hello'],
    [{ role: 'user', sender: 'bob', text: '[Bob] hello' }, '[Bob] hello'],
    [{ role: 'user', sender: 'bob', text: ' [bob] hello' }, ' [bob] hello'],
    [{ role: 'user', sender: 'bob', text: '[bob]\nhello' }, '[bob]\nhello'],
    [{ role: 'user', sender: 'bad name', text: '[bad name] hello' }, '[bad name] hello'],
    [{ role: 'assistant', sender: 'bob', text: '[bob] hello' }, '[bob] hello'],
  ]) {
    const original = { ...message };
    assert.equal(text(message), expected);
    assert.deepEqual(message, original, 'presentation never mutates wire text or identity');
  }
});

test('unbound send has a safe distinct code, is nonretryable and retains the original body/ID', async () => {
  const calls = [];
  const sdk = new HermesClient({ token: () => 'synthetic-device', socket: {}, http: { request: async (...args) => {
    calls.push(args); return { status: 403, body: 'device not bound to a member' };
  } } });
  await assert.rejects(sdk.send('th_sender', 'original-id', ' hello '), error => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, 'device_not_bound');
    assert.equal(client.isDeviceNotBoundError(error), true);
    assert.equal(isRetryableError(error), false);
    assert.doesNotMatch(error.message, /device not bound/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['POST', '/v1/threads/th_sender/messages']);
  assert.deepEqual(calls[0][3], { client_message_id: 'original-id', text: ' hello ' });
});

test('other auth failures are not mislabeled as missing membership', async () => {
  for (const [method, path, status, body] of [
    ['POST', '/v1/threads/th_sender/messages', 401, 'device not bound to a member'],
    ['GET', '/v1/threads/th_sender/messages', 403, 'device not bound to a member'],
    ['POST', '/v1/threads/th_sender/stop', 403, 'device not bound to a member'],
    ['POST', '/v1/threads/th_sender/messages', 403, 'revoked'],
  ]) {
    const sdk = new HermesClient({ token: () => 'synthetic-device', socket: {}, http: { request: async () => ({ status, body }) } });
    await assert.rejects(sdk.call(method, path), error => {
      assert.equal(error.code, undefined);
      assert.equal(client.isDeviceNotBoundError(error), false);
      return true;
    });
  }
});
