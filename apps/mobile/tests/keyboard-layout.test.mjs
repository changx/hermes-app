import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardFrameAfter, keyboardInset } from '../src/keyboardLayout.ts';
import { appendedAtEnd, followDuringDrag } from '../src/timeline.ts';

const screen = 844;
const dock = { y: 110, height: 700 }; // top header and bottom safe-area excluded
const nineKey = { screenY: 490, height: 354 };

test('screen-coordinate keyboard overlap excludes bottom safe area and never accumulates', () => {
  assert.equal(keyboardInset(dock, nineKey, screen), 320);
  assert.equal(keyboardInset(dock, nineKey, screen), 320);
  assert.equal(keyboardInset(dock, { screenY: 440, height: 404 }, screen), 370); // candidate bar grew
  assert.equal(keyboardInset({ y: 110, height: 380 }, nineKey, screen), 0); // OS already resized
  assert.equal(keyboardInset({ y: 110, height: 700 }, { screenY: 740, height: 104 }, screen), 70);
});

test('invalid, floating, background and out-of-window frames cannot displace the chat', () => {
  for (const bad of [
    { screenY: 0, height: 844 }, { screenY: -4, height: 848 },
    { screenY: 1000, height: 200 }, { screenY: 400, height: 100 },
    { screenY: Number.NaN, height: 354 }, { screenY: 490, height: 0 }
  ]) assert.equal(keyboardInset(dock, bad, screen), 0);
  assert.equal(keyboardInset(null, nineKey, screen), 0);
  assert.equal(keyboardInset({ y: 100, height: 1000 }, nineKey, screen), 0);
  assert.equal(keyboardFrameAfter('show', false, true, nineKey, dock, screen), null);
});

test('background drops old geometry; foreground only accepts a visible valid metric', () => {
  const shown = keyboardFrameAfter('show', true, true, nineKey, dock, screen);
  assert.deepEqual(shown, nineKey);
  assert.equal(keyboardFrameAfter('background', false, true, shown, dock, screen), null);
  assert.equal(keyboardFrameAfter('foreground', true, false, shown, dock, screen), null);
  assert.equal(keyboardFrameAfter('foreground', true, true, { screenY: 0, height: 844 }, dock, screen), null);
  assert.deepEqual(keyboardFrameAfter('foreground', true, true, nineKey, dock, screen), nineKey);
  assert.equal(keyboardFrameAfter('hide', true, true, nineKey, dock, screen), null);
});

test('interactive downward movement reduces overlap without snapping; reversal restores it', () => {
  assert.equal(keyboardInset(dock, nineKey, screen), 320);
  assert.equal(keyboardInset(dock, { screenY: 590, height: 354 }, screen), 220);
  assert.equal(keyboardInset(dock, { screenY: 790, height: 354 }, screen), 20);
  assert.equal(keyboardInset(dock, nineKey, screen), 320);
});

test('reader mode survives keyboard resize and prepends; only end append animates', () => {
  assert.equal(followDuringDrag(true, 400, 300, 1200, 1200, 600, 700), true);
  assert.equal(followDuringDrag(false, 400, 300, 1200, 1200, 600, 700), false);
  assert.equal(followDuringDrag(true, 400, 300, 1200, 1200, 600, 600), false);
  assert.equal(followDuringDrag(false, 400, 590, 1200, 1200, 600, 600), true);
  assert.equal(appendedAtEnd([], ['a']), false); // initial load/history restore
  assert.equal(appendedAtEnd(['a'], ['a', 'b']), true);
  assert.equal(appendedAtEnd(['a', 'b'], ['old', 'a', 'b']), false);
  assert.equal(appendedAtEnd(['a', 'b'], ['a', 'c']), false);
});
