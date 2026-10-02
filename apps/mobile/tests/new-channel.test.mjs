import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const channel = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/EditorScreens.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/new-channel.tsx', import.meta.url), 'utf8');

test('Channels uses a safe-area floating new-channel button that opens a full-screen route', () => {
  assert.match(channel, /accessibilityLabel="New channel"/);
  assert.match(channel, /!channelId && <Pressable[^>]+onPress=\{onNewChannel\}[^>]+bottom: 18 \+ insets\.bottom/);
  assert.match(app, /onNewChannel=\{\(\) => router\.push\('\/new-channel'\)\}/);
  assert.match(layout, /Stack\.Screen name="new-channel" options=\{\{ title: 'New channel' \}\}/);
  assert.doesNotMatch(channel + editor, /<Modal|EditorSheet|keyboardWillShow|Keyboard\.metrics|useWindowDimensions/);
});

test('new-channel full-screen editor preserves the existing creation path', () => {
  assert.match(route, /<FormKeyboardAvoidingView>/);
  assert.match(route, /<NewChannelEditor client=\{client\}/);
  assert.match(route, /router\.replace\(\{ pathname: '\/channels\/\[channelId\]'/);
  assert.match(editor, /accessibilityLabel="Channel name" placeholder="Channel name"/);
  assert.doesNotMatch(editor, /autoFocus/);
  assert.match(editor, /accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines \(optional\)"[\s\S]*?multiline/);
  assert.match(editor, /form: \{ flex: 1, gap: 12 \}/);
  assert.match(editor, /descriptionArea: \{ flex: 1, minHeight: 0 \}/);
  assert.match(editor, /description: \{ flex: 1, minHeight: 0, textAlignVertical: 'top' \}/);
  assert.match(editor, /channelActions: \{ flexShrink: 0, gap: 12 \}/);
  assert.match(editor, /client\.createChannel\(patch\.name, patch\.description\)/);
  assert.match(editor, /if \(current\(\)\) onCreated\(made\.id\)/);
});

test('full-screen editor uses the native Stack back button and gesture', () => {
  assert.doesNotMatch(editor, /BackHandler|onCancel/);
  assert.doesNotMatch(layout, /name="new-channel"[^>]+gestureEnabled: false|name="new-channel"[^>]+headerBackVisible: false/);
});

test('channel-list content leaves room for the floating button', () => {
  assert.match(channel, /data=\{channels\}[\s\S]*?contentContainerStyle=\{\[s\.list, \{ paddingBottom: 96 \+ insets\.bottom \}\]\}/);
});
