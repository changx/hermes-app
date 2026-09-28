import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const channel = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
const attachments = readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');

test('Channel uses a safe-area floating new-topic button and multiline first-message sheet', () => {
  assert.match(channel, /accessibilityLabel="New topic"/);
  assert.match(channel, /style=\{\[s\.fab, \{ bottom: 18 \+ insets\.bottom \}/);
  assert.match(channel, /accessibilityLabel="First message"[^>]*multiline/);
  assert.doesNotMatch(channel, /accessibilityLabel="New topic title"/);
});

test('new-topic submission stages local attachments then creates, uploads and sends one stable message', () => {
  assert.match(channel, /threadId=\{null\}/);
  assert.match(channel, /createThread\(channelId, 'New topic', draftThreadId\.current\)/);
  assert.match(channel, /uploadTo\(threadId\)/);
  assert.match(channel, /client\.send\(threadId, draftMessageId\.current, message, attachmentIds\)/);
  assert.match(attachments, /With no threadId, files stay local until uploadTo/);
  assert.match(attachments, /Photo library/);
  assert.match(attachments, /Take photo/);
  assert.match(attachments, /Choose file/);
  assert.match(attachments, /Paste/);
});