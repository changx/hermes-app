import test from 'node:test';
import assert from 'node:assert/strict';
import { locateLatest, nearLatest, olderStart, projectTimeline, windowStart } from '../src/timeline.ts';
import { accepted, connection, newSend, retrySend } from '../src/send.ts';

const config = connection('https://agent.tuly.space', 'token', 'conn');
const id = 'mob_123e4567-e89b-12d3-a456-426614174000';
const messages = [
  { id: 'core_1', role: 'user', text: 'same body', ref_seq: 10 },
  { id: 'core_2', role: 'user', text: 'same body', ref_seq: 13 },
  { id: 'core_3', role: 'assistant', text: 'final', ref_seq: 19 }
];

test('optimistic identity survives retry; identical text never merges by content', () => {
  const sending = newSend(config, 'th_1', 'same body', id);
  const rows = projectTimeline(messages, sending, 'th_1');
  assert.deepEqual(rows.map(r => r.key), ['ref:10', 'ref:13', 'ref:19', `local:${id}`]);
  const ambiguous = { ...sending, status: 'ambiguous' };
  assert.equal(projectTimeline(messages, retrySend(config, ambiguous), 'th_1').at(-1).key, `local:${id}`);
  const receipt = { id: 'rc_1', client_message_id: id, thread_id: 'th_1', state: 'queued', durable: true };
  const confirmed = projectTimeline(messages, accepted(sending, receipt), 'th_1');
  assert.deepEqual(confirmed.map(r => r.key), ['ref:10', 'ref:13', 'ref:19']);
  assert.equal(projectTimeline(messages, sending, 'th_other').length, 3);
});

test('draft appears only when actual ephemeral text is supplied; final ref stays independent', () => {
  assert.deepEqual(projectTimeline(messages, null, 'th_1').map(r => r.key), ['ref:10', 'ref:13', 'ref:19']);
  assert.equal(projectTimeline(messages, null, 'th_1', 'incomplete **').at(-1).text, 'incomplete **');
});

test('authoritative time wins over matching local send; legacy remains unknown', () => {
  const record = { ...newSend(config, 'th_1', 'local', id), createdAt: 100 };
  assert.equal(projectTimeline([], record, 'th_1')[0].timestamp, 100);
  const published = { id: 'published', role: 'user', text: record.text, ref_seq: 11, client_message_id: id, created_at: 0 };
  assert.equal(projectTimeline([published], record, 'th_1')[0].timestamp, 0);
  assert.equal(projectTimeline([{ ...published, created_at: 300 }], record, 'th_1')[0].timestamp, 300);
  assert.equal(projectTimeline([{ ...published, created_at: undefined }], record, 'th_1')[0].timestamp, 100);
  assert.equal(projectTimeline([{ ...published, created_at: undefined }], null, 'th_1')[0].timestamp, undefined);
  assert.equal(projectTimeline([], { ...record, createdAt: undefined }, 'th_1')[0].timestamp, undefined);
  assert.equal(projectTimeline([{ id: 'assistant', role: 'assistant', text: 'reply', ref_seq: 12 }], null, 'th_1')[0].timestamp, undefined);
  assert.equal(projectTimeline([{ ...published, created_at: 300 }], record, 'different')[0].timestamp, 300);
});

test('window reveals older cached refs without assuming dense global ref sequences', () => {
  assert.equal(windowStart(messages, null, 2), 1);
  assert.equal(windowStart(messages, 13, 2), 1);
  assert.equal(olderStart(messages, 13, 1), 10);
  assert.equal(windowStart(messages, olderStart(messages, 13, 1)), 0);
  assert.equal(olderStart(messages, 10), 10);
  assert.equal(windowStart([], null), 0);
});

test('follow stops when the reader leaves the bottom threshold', () => {
  assert.equal(nearLatest(100, 600, 400), false);
  assert.equal(nearLatest(130, 600, 400), true);
});

test('latest discovery has a hard page budget and preserves opaque cursors', async () => {
  const seen = [];
  const cursor = await locateLatest(after => {
    seen.push(after);
    return Promise.resolve({ next_cursor: `opaque-${seen.length}` });
  });
  assert.deepEqual(seen, [undefined, 'opaque-1', 'opaque-2']);
  assert.equal(cursor, 'opaque-3');
  const finished = await locateLatest(after => Promise.resolve({ next_cursor: after ? null : 'opaque' }));
  assert.equal(finished, null);
  let current = true;
  const changed = await locateLatest(() => { current = false; return Promise.resolve({ next_cursor: 'opaque' }); }, 3, () => current);
  assert.equal(changed, null);
});
