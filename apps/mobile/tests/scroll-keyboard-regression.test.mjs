import test from 'node:test';
import assert from 'node:assert/strict';
import { appendedAtEnd, followDuringDrag, latestOffset, scrollToExactEnd, shouldFollowContentChange } from '../src/timeline.ts';

test('exact native ScrollView end wins over heterogeneous last-cell estimate', () => {
  const calls = [];
  const list = {
    getScrollResponder: () => ({ scrollToEnd: options => calls.push(['native', options]) }),
    scrollToOffset: options => calls.push(['estimated', options])
  };
  // Last cell approximation would target 4500, actual content ends at 6900.
  assert.equal(latestOffset(7500, 600), 6900);
  assert.equal(scrollToExactEnd(list, 7500, 600, false), true);
  assert.deepEqual(calls, [['native', { animated: false }]]);
  assert.equal(scrollToExactEnd({ ...list, getScrollResponder: () => null }, 7500, 600, true), true);
  assert.deepEqual(calls.at(-1), ['estimated', { offset: 6900, animated: true }]);
  assert.equal(scrollToExactEnd({ ...list, getScrollResponder: () => null }, 0, 600, false), false);
});

test('bottom bounce/rebound does not leave follow; actual drag up beyond threshold does', () => {
  assert.equal(followDuringDrag(true, 400, 450, 1000, 1000, 600, 600), true);
  assert.equal(followDuringDrag(true, 450, 400, 1000, 1000, 600, 600), true);
  assert.equal(followDuringDrag(true, 400, 350, 1000, 1000, 600, 600, true, 300, 250), true);
  assert.equal(followDuringDrag(false, 400, 400, 1000, 1000, 600, 600), false);
  assert.equal(followDuringDrag(true, 400, 350, 1000, 1000, 600, 600), false);
  assert.equal(followDuringDrag(false, 350, 260, 1000, 1000, 600, 600), false);
  assert.equal(followDuringDrag(false, 260, 395, 1000, 1000, 600, 600), true);
});

test('programmatic animated momentum cannot change following or activate reader mode', () => {
  assert.equal(followDuringDrag(true, 400, 120, 1000, 1000, 600, 600, false), true);
  assert.equal(followDuringDrag(false, 120, 400, 1000, 1000, 600, 600, false), false);
  // A real drag momentum still counts; drag end itself never calls scrollToEnd.
  assert.equal(followDuringDrag(true, 400, 120, 1000, 1000, 600, 600, true), false);
});

test('keyboard resize with append follows only new measured extent, not viewport geometry', () => {
  assert.equal(followDuringDrag(true, 400, 220, 1000, 1000, 600, 780), true);
  assert.equal(shouldFollowContentChange(true, false, 1000, 1000), false);
  assert.equal(shouldFollowContentChange(true, true, 1000, 1050), false);
  assert.equal(shouldFollowContentChange(true, false, 1000, 1050), true);
  assert.equal(appendedAtEnd(['a'], ['a', 'b']), true);
});

test('prepend while reading preserves mode and never triggers a latest command', () => {
  assert.equal(appendedAtEnd(['a', 'b'], ['old', 'a', 'b']), false);
  assert.equal(followDuringDrag(false, 210, 410, 900, 1100, 600, 600), false);
  assert.equal(shouldFollowContentChange(false, false, 900, 1100), false);
});
