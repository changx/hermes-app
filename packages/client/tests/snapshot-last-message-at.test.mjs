import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

const summary = (id, last_message_at) => ({ id, project_id: 'p', title: id, archived: 0, last_ref: 1, read_ref: 1, unread_count: 0, ...(last_message_at === undefined ? {} : { last_message_at }) });

test('snapshot accepts fractional last_message_at and drops invalid values', async () => {
  const sdk = new HermesClient({ token: () => 'synthetic', socket: { async connect() { throw new Error('unused'); } },
    http: { async request(method, path) {
      if (path.startsWith('/v1/snapshot')) return { status: 200, body: { threads: [summary('float', 1790593553.9755538), summary('int', 1790446482), summary('bad', 'x'), summary('none')], next_after: null, waterline: 'c1' } };
      if (path.startsWith('/v1/channels')) return { status: 200, body: { channels: [] } };
      throw new Error('unexpected ' + path);
    } } });
  await sdk.snapshot();
  assert.equal(sdk.threads.get('float').last_message_at, 1790593553.9755538);
  assert.equal(sdk.threads.get('int').last_message_at, 1790446482);
  assert.equal(sdk.threads.get('bad').last_message_at, undefined);
  assert.equal(sdk.threads.get('none').last_message_at, undefined);
});
