import test from 'node:test';
import assert from 'node:assert/strict';
import { appendedAtEnd, followDuringDrag, latestOffset, scrollStateFromEvent, scrollToExactEnd, shouldFollowContentChange } from '../src/timeline.ts';

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
  assert.equal(scrollToExactEnd({ ...list, getScrollResponder: () => null }, 7500, 600, false, 260), true);
  assert.deepEqual(calls.at(-1), ['estimated', { offset: 7160, animated: false }]);
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

test('native inset changes the real bottom used for follow and rebound', () => {
  const geometry = { height: 1000, viewport: 600, inset: 260 };
  assert.equal(latestOffset(1000, 600, 260), 660);
  const event = y => ({ contentOffset: { y }, contentSize: { height: 1000 }, layoutMeasurement: { height: 600 }, contentInset: { bottom: 260 } });
  // This is the same event adapter ChatTimeline calls from onScroll.
  assert.equal(scrollStateFromEvent(false, 630, geometry, event(650), true).following, true);
  assert.equal(scrollStateFromEvent(true, 670, geometry, event(660), true).following, true);
  assert.equal(scrollStateFromEvent(true, 660, geometry, event(640), true).following, false);
  assert.equal(scrollStateFromEvent(true, 400, { ...geometry, inset: 0 }, event(660), true).following, true);
  assert.equal(scrollStateFromEvent(false, 640, geometry, event(650), true).following, true);
  // Android's synthetic inset is absent from onScroll; the controller reports it separately.
  assert.deepEqual(scrollStateFromEvent(false, 630, geometry, { ...event(650), contentInset: undefined }, true, 260),
    { offset: 650, geometry, following: true });
});

test('flow dock needs keyboard inset without subtracting its own height', () => {
  const area = 800, safeBottom = 34, keyboard = 330, content = 1400;
  for (const dock of [60, 130, 220]) { // simple, multiline, multiline plus controls
    const viewport = area - dock;
    assert.equal(content - latestOffset(content, viewport, keyboard - safeBottom), viewport - (keyboard - safeBottom));
    assert.equal(content - latestOffset(content, viewport, keyboard - safeBottom - dock), viewport - (keyboard - safeBottom) + dock);
    assert.equal(content - latestOffset(content, viewport), viewport); // hidden keyboard
    // Natural short content consumes whitespace before any keyboard shift.
    assert.equal(latestOffset(100, viewport, keyboard - safeBottom), 0);
  }
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
