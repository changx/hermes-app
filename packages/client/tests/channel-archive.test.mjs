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

test('channel archive is enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, channel_archive: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsChannelArchive, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.equal(old.supportsChannelArchive, false);
});

test('archiveChannel sends only the archive flag and drops the confirmed Channel', async () => {
  const { sdk, calls } = client(() => ({ status: 200, body: { channel: { id: 'p_one', name: 'One', archived: true } } }));
  sdk.channels.set('p_one', { id: 'p_one', name: 'One' });
  await sdk.archiveChannel('p_one');
  assert.deepEqual(calls[0].slice(0, 2), ['PATCH', '/v1/channels/p_one']);
  assert.deepEqual(calls[0][3], { archived: true });
  assert.equal(sdk.channels.has('p_one'), false);
});

test('archiveChannel keeps the Channel when the server does not confirm the archive', async () => {
  const { sdk } = client(() => ({ status: 200, body: { channel: { id: 'p_one', name: 'One' } } }));
  sdk.channels.set('p_one', { id: 'p_one', name: 'One' });
  await assert.rejects(sdk.archiveChannel('p_one'), /archive not confirmed/);
  assert.equal(sdk.channels.has('p_one'), true);
});
