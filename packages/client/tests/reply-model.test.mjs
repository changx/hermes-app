import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

const reply = messages => new HermesClient({
  token: () => 'synthetic-device',
  socket: { connect: async () => { throw Error('no socket expected'); } },
  http: { request: async () => ({ status: 200, body: { messages, receipts: [], next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }) },
});

test('final replies keep a well-formed model; other rows and malformed values drop it', async () => {
  const messages = [
    { id: '1', ref_seq: 1, role: 'user', text: 'Q', model: 'gpt-5' },
    { id: '2', ref_seq: 2, role: 'assistant', text: 'Working on it', model: 'gpt-5' },
    { id: '3', ref_seq: 3, role: 'assistant', text: 'Answer', display_kind: 'final', model: 'anthropic/claude-opus-5-5' },
    { id: '4', ref_seq: 4, role: 'assistant', text: 'Answer', display_kind: 'final', model: 'bad model\u202e' },
    { id: '5', ref_seq: 5, role: 'assistant', text: 'Answer', display_kind: 'final', model: 42 },
    { id: '6', ref_seq: 6, role: 'assistant', text: 'Answer', display_kind: 'final' },
  ];
  const sdk = reply(messages);
  for (const page of [await sdk.history('th_model0001'), await sdk.search('th_model0001', 'Answer')])
    assert.deepEqual(page.messages.map(m => m.model), [undefined, undefined, 'anthropic/claude-opus-5-5', undefined, undefined, undefined]);
});
