import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const src = new URL('../src/', import.meta.url);
test('mobile contains no temporary timing collector, settings switch or result panel', () => {
  for (const name of ['sessionTiming.ts', 'sessionTimingSwitch.ts', 'SessionTimingPanel.tsx']) {
    assert.equal(existsSync(new URL(name, src)), false, name);
  }
  for (const name of readdirSync(src).filter(name => /\.tsx?$/.test(name))) {
    const text = readFileSync(new URL(name, src), 'utf8');
    assert.doesNotMatch(text, /SessionOpenMeasurement|SessionTimingPanel|SessionTimingControl|EXPO_PUBLIC_SESSION_TIMING|sessionTimingForPage|beginSessionTiming|onMeasuredVisible|measuredVisibility/, name);
  }
  const app = readFileSync(new URL('App.tsx', src), 'utf8');
  assert.match(app, /openConversation\(id, requestedRef, undefined, releaseContent\)/);
  assert.match(app, /onVisibleRefs=\{onVisibleRefs\}/);
  assert.match(app, /<ModelSettings/);
  assert.match(app, /<FontSizeSettings/);
  const timeline = readFileSync(new URL('ChatTimeline.tsx', src), 'utf8');
  assert.match(timeline, /onViewableItemsChanged=\{onViewableItemsChanged\}/);
  assert.doesNotMatch(timeline, /viewabilityConfigCallbackPairs/);
});
