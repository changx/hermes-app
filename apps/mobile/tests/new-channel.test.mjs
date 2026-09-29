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

test('new-channel editor uses the shared static-backdrop editor sheet and existing creation path', () => {
  assert.match(channel, /<EditorSheet visible=\{creating\} closeLabel="Close new channel editor"/);
  assert.match(channel, /<Modal visible=\{visible\} transparent animationType="none"/);
  assert.match(channel, /<Pressable[^>]*style=\{s\.backdrop\}[\s\S]*?<KeyboardAvoidingView/);
  assert.match(channel, /<Animated\.View style=\{\[s\.composer,[^>]*translateY: sheetOffset/);
  assert.match(channel, /Animated\.timing\(sheetOffset/);
  assert.match(channel, /accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b"[^>]*autoFocus/);
  assert.match(channel, /accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines \(optional\)" placeholderTextColor="#65758b"[^>]*multiline/);
  assert.match(channel, /description: \{ minHeight: 140, maxHeight: 260, textAlignVertical: 'top' \}/);
  assert.match(channel, /client\.createChannel\(patch\.name, patch\.description\)/);
  assert.match(channel, /setCreating\(false\); onChannel\(made\.id\)/);
});

test('channel-list content leaves room for the floating button', () => {
  assert.match(channel, /data=\{channels\}[\s\S]*?contentContainerStyle=\{\[s\.list, \{ paddingBottom: 96 \+ insets\.bottom \}\]\}/);
});