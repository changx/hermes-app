import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, formatTokens, exactTokens } from '../dist/index.js';

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};

test('thread usage is enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, thread_usage: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsThreadUsage, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } }));
  await old.sdk.capabilities();
  assert.equal(old.sdk.supportsThreadUsage, false);
  assert.equal(await old.sdk.threadUsage('th_one'), undefined);
  assert.equal(old.calls.length, 1, 'an old server gets no usage request');
});

test('threadUsage reads the context size and the total of one Session', async () => {
  const { sdk, calls } = client(() => ({ status: 200, body: { usage: { thread_id: 'th_one', context_tokens: 28202, total_tokens: 206250929, input_tokens: 1 } } }));
  sdk.supportsThreadUsage = true;
  assert.deepEqual(await sdk.threadUsage('th_one'), { contextTokens: 28202, totalTokens: 206250929 });
  assert.deepEqual(calls[0].slice(0, 2), ['GET', '/v1/threads/th_one/usage']);
});

test('threadUsage keeps a missing context as null and rejects a mismatched reply', async () => {
  const empty = client(() => ({ status: 200, body: { usage: { thread_id: 'th_one', context_tokens: null, total_tokens: 0 } } })).sdk;
  empty.supportsThreadUsage = true;
  assert.deepEqual(await empty.threadUsage('th_one'), { contextTokens: null, totalTokens: 0 });
  for (const usage of [{ thread_id: 'th_two', context_tokens: 1, total_tokens: 2 }, { thread_id: 'th_one', context_tokens: -1, total_tokens: 2 },
    { thread_id: 'th_one', context_tokens: 1, total_tokens: '2' }, { thread_id: 'th_one', total_tokens: 2 }]) {
    const bad = client(() => ({ status: 200, body: { usage } })).sdk;
    bad.supportsThreadUsage = true;
    await assert.rejects(bad.threadUsage('th_one'), /invalid usage/);
  }
});

test('token counts are compact and exact', () => {
  const cases = [[0, '0'], [950, '950'], [1000, '1K'], [28202, '28.2K'], [99949, '99.9K'], [99960, '100K'], [124589, '125K'],
    [999999, '1M'], [1_234_567, '1.2M'], [206_250_929, '206M'], [999_960_000, '1B'], [1_500_000_000, '1.5B']];
  for (const [value, text] of cases) assert.equal(formatTokens(value), text, String(value));
  assert.equal(exactTokens(206250929), '206,250,929');
});
