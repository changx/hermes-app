import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

test('new-topic Thread creation sends the stable client identity without inventing a local title', async () => {
  const calls = [];
  const thread = { id: 'th_clienttopic123', project_id: 'p_one', title: 'New topic', archived: false };
  const client = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return { status: 201, body: { thread } }; } },
  });
  assert.deepEqual(await client.createThread('p_one', 'New topic', 'th_clienttopic123'), thread);
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][1], '/v1/channels/p_one/threads');
  assert.deepEqual(calls[0][3], { title: 'New topic', client_thread_id: 'th_clienttopic123' });
});
