import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, formatTokens, exactTokens, cacheHitPercent } from '../dist/index.js';

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
  assert.deepEqual(await sdk.threadUsage('th_one'), { contextTokens: 28202, totalTokens: 206250929, cache: null }, 'a 0.2.55 reply has no last request');
  assert.deepEqual(calls[0].slice(0, 2), ['GET', '/v1/threads/th_one/usage']);
});

test('threadUsage keeps a missing context as null and rejects a mismatched reply', async () => {
  const empty = client(() => ({ status: 200, body: { usage: { thread_id: 'th_one', context_tokens: null, total_tokens: 0 } } })).sdk;
  empty.supportsThreadUsage = true;
  assert.deepEqual(await empty.threadUsage('th_one'), { contextTokens: null, totalTokens: 0, cache: null });
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

test('threadUsage reads the cache of the latest turn\'s first request, not the latest request; no cache activity is no data, not 0%', async () => {
  const reply = last_request => client(() => ({ status: 200, body: { usage: { thread_id: 'th_one', context_tokens: 240051, total_tokens: 9, turn_first_request: last_request, last_request: { prompt_tokens: 5, cache_read_tokens: 5, cache_write_tokens: 0, output_tokens: 1, at: 2 } } } })).sdk;
  const read = async last => { const sdk = reply(last); sdk.supportsThreadUsage = true; return (await sdk.threadUsage('th_one')).cache; };
  assert.deepEqual(await read({ prompt_tokens: 240051, cache_read_tokens: 239459, cache_write_tokens: 590, output_tokens: 1420, at: 1 }), { readTokens: 239459, promptTokens: 240051 });
  assert.deepEqual(await read({ prompt_tokens: 50000, cache_read_tokens: 0, cache_write_tokens: 50000, output_tokens: 1, at: 1 }), { readTokens: 0, promptTokens: 50000 }, 'a real miss that wrote the cache');
  assert.equal(await read({ prompt_tokens: 50000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1, at: 1 }), null, 'provider reported no cache activity');
  assert.equal(await read(null), null);
  for (const bad of [{ prompt_tokens: 10, cache_read_tokens: 11, cache_write_tokens: 0 }, { prompt_tokens: '10', cache_read_tokens: 1, cache_write_tokens: 0 }, 'x']) {
    const sdk = reply(bad); sdk.supportsThreadUsage = true;
    await assert.rejects(sdk.threadUsage('th_one'), /invalid usage/, JSON.stringify(bad));
  }
});

test('cache hit percent rounds down, so only a full hit shows 100%', () => {
  assert.equal(cacheHitPercent({ readTokens: 239459, promptTokens: 240051 }), 99);
  assert.equal(cacheHitPercent({ readTokens: 239999, promptTokens: 240000 }), 99);
  assert.equal(cacheHitPercent({ readTokens: 240000, promptTokens: 240000 }), 100);
  assert.equal(cacheHitPercent({ readTokens: 0, promptTokens: 50000 }), 0);
  assert.equal(cacheHitPercent({ readTokens: 1, promptTokens: 3 }), 33);
});

test('a 0.2.56 reply with only last_request has no cache value', async () => {
  const sdk = client(() => ({ status: 200, body: { usage: { thread_id: 'th_one', context_tokens: 1, total_tokens: 2,
    last_request: { prompt_tokens: 100, cache_read_tokens: 99, cache_write_tokens: 1, output_tokens: 1, at: 1 } } } })).sdk;
  sdk.supportsThreadUsage = true;
  assert.equal((await sdk.threadUsage('th_one')).cache, null);
});
