import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TAB_BAR_CLEARANCE, tabListBottomPadding } from '../src/tabInsets.ts';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Tab lists end above the native tab bar', () => {
  assert.ok(TAB_BAR_CLEARANCE >= 83, 'clears a standard iOS tab bar');
  assert.equal(tabListBottomPadding(34), TAB_BAR_CLEARANCE + 34);
  assert.equal(tabListBottomPadding(0), TAB_BAR_CLEARANCE);
  assert.equal(tabListBottomPadding(-1), TAB_BAR_CLEARANCE);
  for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/automations.tsx', 'ProjectList.tsx']) {
    const text = source(file);
    assert.match(text, /contentContainerStyle=\{\[s\.list, \{ paddingBottom: tabListBottomPadding\(insets\.bottom\) \}\]\}/, file);
    assert.doesNotMatch(text, /paddingBottom: 24/, file);
  }
});

test('New conversation opens the keyboard after the push, not during it', () => {
  const page = source('app/new-thread.tsx'), composer = source('NewTopicComposer.tsx');
  assert.match(page, /addListener\('transitionEnd'/);
  assert.match(page, /if \(!event\?\.data\?\.closing\) setEntered\(true\)/);
  assert.match(page, /autoFocus=\{focus\}/);
  assert.doesNotMatch(composer, /autoFocus=\{autoFocus\}/, 'no native autoFocus at mount');
  assert.match(composer, /if \(autoFocus && focusedRef\.current\) input\.current\?\.focus\(\)/);
});
