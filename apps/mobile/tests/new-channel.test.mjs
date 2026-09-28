import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const channel = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');

test('Channels uses a safe-area floating new-channel button instead of a top New action', () => {
  assert.match(channel, /accessibilityLabel="New channel"/);
  assert.match(channel, /!channelId && <Pressable[^>]+onPress=\{startCreate\}[^>]+bottom: 18 \+ insets\.bottom/);
  assert.doesNotMatch(channel, /label=\{channelId \? 'Edit' : 'New'\}/);
  assert.match(channel, /\{!!channelId && <Action label="Edit"/);
});

test('new-channel editor slides up with the existing fields and creation path', () => {
  assert.match(channel, /<Modal visible=\{creating\} transparent animationType="slide"/);
  assert.match(channel, /accessibilityLabel="Close new channel editor"/);
  assert.match(channel, /accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b"[^>]*autoFocus/);
  assert.match(channel, /accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines \(optional\)" placeholderTextColor="#65758b"[^>]*multiline/);
  assert.match(channel, /description: \{ minHeight: 140, maxHeight: 260, textAlignVertical: 'top' \}/);
  assert.match(channel, /client\.createChannel\(patch\.name, patch\.description\)/);
  assert.match(channel, /setCreating\(false\); onChannel\(made\.id\)/);
});

test('channel-list content leaves room for the floating button', () => {
  assert.match(channel, /data=\{channels\}[\s\S]*?contentContainerStyle=\{\[s\.list, \{ paddingBottom: 96 \+ insets\.bottom \}\]\}/);
});