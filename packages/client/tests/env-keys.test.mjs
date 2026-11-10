import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};

test('API keys are enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, env_keys: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsEnvKeys, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.equal(old.supportsEnvKeys, false);
});

test('envKeys reads metadata; set and remove send one value and get metadata back', async () => {
  const keys = [{ name: 'EXA_API_KEY', set: true, preview: '…0002', sandbox: false, description: 'Exa search', url: 'https://exa.ai' },
    { name: 'MY_SERVICE_KEY', set: true, preview: '', sandbox: true }];
  const suggestions = [{ name: 'TAVILY_API_KEY', description: 'Tavily search', url: 'https://tavily.com' }];
  const { sdk, calls } = client(method => method === 'GET' ? { status: 200, body: { keys, suggestions } }
    : method === 'PUT' ? { status: 200, body: { key: keys[1] } } : { status: 200, body: { removed: true } });
  assert.deepEqual(await sdk.envKeys(), { keys, suggestions });
  assert.deepEqual(await sdk.setEnvKey('MY_SERVICE_KEY', 'svc-value'), keys[1]);
  assert.deepEqual([calls[1][0], calls[1][1], calls[1][3]], ['PUT', '/v1/env-keys/MY_SERVICE_KEY', { value: 'svc-value' }]);
  assert.equal(await sdk.removeEnvKey('MY_SERVICE_KEY'), true);
  assert.deepEqual(calls[2].slice(0, 2), ['DELETE', '/v1/env-keys/MY_SERVICE_KEY']);
});

test('invalid names never reach the server; unsafe links are dropped', async () => {
  const { sdk, calls } = client(() => ({ status: 200, body: { keys: [{ name: 'A_KEY', set: true, preview: '', sandbox: false, url: 'javascript:alert(1)' }] } }));
  await assert.rejects(sdk.setEnvKey('lower', 'v'), /invalid key name/);
  await assert.rejects(sdk.removeEnvKey('../x'), /invalid key name/);
  assert.equal(calls.length, 0);
  const listed = await sdk.envKeys();
  assert.equal(listed.keys[0].url, undefined);
  assert.deepEqual(listed.suggestions, [], 'suggestions are optional');
  const bad = client(() => ({ status: 200, body: { keys: [{ name: 'bad name', set: true }] } })).sdk;
  await assert.rejects(bad.envKeys(), /invalid key name/);
});
