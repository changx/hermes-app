import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

test('native replies survive history, search and same-identity edits', async () => {
  let text = 'Compressing context…';
  const sdk = new HermesClient({ token: () => 'synthetic',
    socket: { async connect() { throw new Error('unused'); } },
    http: { async request() { return { status: 200, body: { messages: [{ id: 'dm_one', ref_seq: 2,
      role: 'assistant', text, created_at: 123.5, display_kind: 'direct' }],
      next_cursor: null, older_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }
  });
  sdk.supportsLatest = true;
  await sdk.historyWindow('thread');
  assert.equal(sdk.messages.get('thread')[0].display_kind, 'direct');
  text = 'Context compressed.';
  await sdk.historyWindow('thread');
  assert.equal(sdk.messages.get('thread').length, 1);
  assert.equal(sdk.messages.get('thread')[0].text, text);
  assert.equal(sdk.messages.get('thread')[0].created_at, 123.5);
  assert.equal((await sdk.search('thread', 'compressed')).messages[0].display_kind, 'direct');
});
