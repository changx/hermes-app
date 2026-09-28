import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTimeline } from '../src/timeline.ts';

test('each direct Hermes reply has its own sender/time, without changing normal grouping', () => {
  const input = [
    { id: '1', role: 'assistant', text: 'AI progress', ref_seq: 1, created_at: 11 },
    { id: 'dm_one', role: 'assistant', text: 'Native status', ref_seq: 2, created_at: 12, display_kind: 'direct' },
    { id: 'dm_two', role: 'assistant', text: '原文 preserved', ref_seq: 3, created_at: 13, display_kind: 'direct' },
    { id: '4', role: 'assistant', text: 'AI next', ref_seq: 4, created_at: 14 },
    { id: '5', role: 'assistant', text: 'AI final', ref_seq: 5, created_at: 15 },
  ];
  const rows = projectTimeline(input, null, 'thread');
  assert.deepEqual(rows.map(r => r.continuation), [false, false, false, false, true]);
  assert.deepEqual(rows.map(r => r.timestamp), [11, 12, 13, 14, 15]);
  assert.deepEqual(rows.map(r => r.text), input.map(m => m.text));
  assert.ok(rows.every(r => !r.optimistic && !r.reaction));
});
