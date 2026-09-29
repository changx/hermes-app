import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const attachments = readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');

test('running status, attachments, and input share one sticky blurred surface', () => {
  const sticky = timeline.slice(timeline.indexOf('<KeyboardStickyView'), timeline.indexOf('</KeyboardStickyView>'));
  const surfaceOpen = sticky.indexOf('<View style={styles.composerSurface}>');
  const blur = sticky.indexOf('<BlurView', surfaceOpen);
  const status = sticky.indexOf('{props.typingIndicator}', surfaceOpen);
  const attachmentComposer = sticky.indexOf('props.composerAccessory', surfaceOpen);
  const surfaceClose = sticky.indexOf('</View>', attachmentComposer);

  assert.ok(surfaceOpen >= 0 && blur > surfaceOpen);
  assert.ok(status > blur && attachmentComposer > status && surfaceClose > attachmentComposer);
  assert.equal((sticky.match(/<BlurView/g) || []).length, 1);
  assert.match(sticky, /experimentalBlurMethod="dimezisBlurView"/);
  assert.match(timeline, /composerSurface: \{ backgroundColor: 'rgba\(/);
  assert.doesNotMatch(timeline, /composerSurface: \{[^\n]*(boxShadow|shadowColor|elevation)/);
});

test('attachment composer stays transparent inside the shared surface', () => {
  assert.match(attachments, /composerRoot: \{ backgroundColor: 'transparent' \}/);
  assert.doesNotMatch(attachments, /composerRow: \{[^\n]*borderTopWidth/);
});