import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const channel = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/EditorScreens.tsx', import.meta.url), 'utf8');
const attachments = readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/channels/[channelId]/new-topic.tsx', import.meta.url), 'utf8');

test('Channel list uses an inline composer instead of the new-topic FAB and route', () => {
  assert.match(channel, /<NewTopicComposer key=\{channelId\}/);
  assert.doesNotMatch(channel, /accessibilityLabel="New topic"|onNewTopic/);
  assert.match(app, /enqueueFirstMessage=\{async/);
  assert.doesNotMatch(app, /pathname: '\/channels\/\[channelId\]\/new-topic'/);
  assert.match(layout, /Stack\.Screen name="channels\/\[channelId\]\/new-topic" options=\{\{ title: 'New topic' \}\}/);
  assert.match(route, /<FormKeyboardAvoidingView>/);
  assert.match(editor, /accessibilityLabel="First message"[\s\S]*?multiline/);
  assert.doesNotMatch(editor, /autoFocus/);
  assert.doesNotMatch(editor, /accessibilityLabel="New topic title"/);
});

test('new-topic submission stages local attachments then creates, uploads and sends one stable message', () => {
  assert.match(editor, /threadId=\{null\}/);
  assert.match(editor, /useRef\(newId\('mob_'\)\).*useRef\(newId\('th_'\)\)/);
  assert.match(editor, /createThread\(channelId, 'New topic', draftThreadId\.current\)/);
  assert.match(editor, /uploadTo\(threadId\)/);
  assert.match(editor, /client\.send\(threadId, draftMessageId\.current, message, attachmentIds\)/);
  assert.match(route, /router\.replace\(\{ pathname: '\/threads\/\[threadId\]'/);
  assert.match(attachments, /With no threadId, files stay local until uploadTo/);
  assert.match(attachments, /Photo library/);
  assert.match(attachments, /Take photo/);
  assert.match(attachments, /Choose file/);
  assert.match(attachments, /Paste/);
});

test('native route cancellation removes uploaded draft data before leaving', () => {
  assert.match(editor, /useEffect\(\(\) => \(\) => \{/);
  assert.match(editor, /if \(!threadId \|\| finalized\.current\) return/);
  assert.match(editor, /handle\.discardFrom\(threadId\)/);
  assert.match(editor, /client\.deleteUnattached\(threadId, id\)/);
  assert.match(editor, /client\.archiveThread\(threadId\)/);
  assert.match(editor, /finalized\.current = true; onCreated\(threadId\)/);
});
