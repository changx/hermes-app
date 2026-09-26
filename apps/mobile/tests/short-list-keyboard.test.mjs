import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the production style and the pinned controller's real clamp. This
// models the flex-grow measurement contract, not a native renderer/gesture test.
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const styles = runInNewContext(source.slice(source.lastIndexOf('StyleSheet.create(')), {
  StyleSheet: { create: value => value }
});
const helperSource = readFileSync(new URL('../node_modules/react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard/helpers.ts', import.meta.url), 'utf8');
const exports = {};
runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports,
  require: name => { assert.equal(name, 'react-native-reanimated'); return {}; }
});
const { clampedScrollTarget, isScrollAtEnd } = exports;
const measuredHeight = (natural, viewport) => styles.messages.flexGrow > 0 ? Math.max(natural, viewport) : natural;

test('short top-aligned messages use bottom whitespace before moving upward', () => {
  for (const dock of [60, 130, 220]) {
    const viewport = 800 - dock;
    for (const natural of [48, 100, 220]) {
      const height = measuredHeight(natural, viewport);
      assert.equal(isScrollAtEnd(0, viewport, height), true);
      for (const inset of [0, 120, 296, 330]) {
        const target = clampedScrollTarget(0, inset, height, viewport);
        assert.equal(target, 0, `natural=${natural}, viewport=${viewport}, inset=${inset}`);
        assert.ok(natural - target <= viewport - inset, 'short content stays above composer');
      }
    }
  }
});

test('near-full content lifts only the obscured portion; close restores its start', () => {
  const viewport = 600, natural = 500, inset = 296;
  const height = measuredHeight(natural, viewport);
  const opened = clampedScrollTarget(0, inset, height, viewport);
  assert.equal(opened, 196);
  assert.equal(natural - opened, viewport - inset);
  assert.equal(clampedScrollTarget(0, 0, height, viewport), 0);
});

test('long content keeps the existing exact-bottom keyboard movement', () => {
  const viewport = 600, natural = 1700, start = natural - viewport;
  const height = measuredHeight(natural, viewport);
  for (const inset of [0, 120, 296, 330]) {
    const target = clampedScrollTarget(start, inset, height, viewport);
    assert.equal(target, start + inset);
    assert.equal(natural - target, viewport - inset);
  }
  assert.equal(clampedScrollTarget(start, 0, height, viewport), start);
});
