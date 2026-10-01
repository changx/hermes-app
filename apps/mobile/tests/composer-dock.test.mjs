import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const attachments = readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');

test('one sticky surface keeps blur behind the running status, attachments, and input', () => {
  const sticky = timeline.slice(timeline.indexOf('<KeyboardStickyView'), timeline.indexOf('</KeyboardStickyView>'));
  const surfaceOpen = sticky.indexOf('<View collapsable={false} style={styles.composerSurface}>');
  const blur = sticky.indexOf('<BlurView', surfaceOpen);
  const blurClose = sticky.indexOf('/>', blur);
  const foreground = sticky.indexOf('<View collapsable={false} style={styles.composerForeground}>', blurClose);
  const status = sticky.indexOf('{props.typingIndicator}', surfaceOpen);
  const attachmentComposer = sticky.indexOf('props.composerAccessory', surfaceOpen);

  assert.ok(surfaceOpen >= 0);
  assert.ok(blur > surfaceOpen && blurClose > blur && foreground > blurClose && status > foreground && attachmentComposer > status);
  assert.doesNotMatch(sticky, /<\/BlurView>/, 'blur must never contain native text input');
  assert.equal((sticky.match(/<BlurView/g) || []).length, 1);
  assert.match(sticky, /<BlurView pointerEvents="none"/);
  assert.match(timeline, /composerBackdrop: \{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 \}/);
  assert.match(timeline, /composerForeground: \{ zIndex: 1 \}/);
  assert.match(timeline, /<BlurTargetView ref=\{blurTarget\}/);
  assert.match(sticky, /blurMethod="dimezisBlurViewSdk31Plus"/);
  assert.match(sticky, /blurTarget=\{blurTarget\}/);
  assert.match(timeline, /composerSurface: \{ backgroundColor: 'rgba\(/);
  assert.match(timeline, /composerSurface: \{[^\n]*boxShadow/);
  assert.doesNotMatch(timeline, /composerSurface: \{[^\n]*overflow: 'hidden'/);
  assert.match(sticky, /runningRow[\s\S]*props\.typingIndicator[\s\S]*accessibilityLabel="Stop"/);
  assert.ok(sticky.indexOf('accessibilityLabel="Stop"') < attachmentComposer, 'stop belongs to the running row, not the input row');
  assert.match(timeline, /runningIndicator: \{ flex: 1, minWidth: 0 \}/);
});

test('attachment composer stays transparent inside the shared surface', () => {
  assert.match(attachments, /composerRoot: \{ backgroundColor: 'transparent' \}/);
  assert.doesNotMatch(attachments, /composerRow: \{[^\n]*borderTopWidth/);
});
