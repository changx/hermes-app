import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const channels = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');

test('header actions are compact native symbols with accessible labels', () => {
  assert.match(app, /<SymbolView name=\{\{ ios, android \}\}/);
  assert.match(app, /label="Connection" ios="antenna\.radiowaves\.left\.and\.right" android="wifi"/);
  assert.match(app, /label="Agent settings" ios="gearshape" android="settings"/);
  assert.doesNotMatch(app, /<Button title="(Connection|Agent settings)"/);
});

test('back buttons show only the arrow', () => {
  assert.match(layout, /headerBackButtonDisplayMode: 'minimal'/);
});

test('topics sort oldest activity first, show last message time, and open at the end', () => {
  const sort = channels.match(/\.sort\(\(a, b\) => \(a\.last_message_at \?\? 0\) - \(b\.last_message_at \?\? 0\)[^\n]*/)?.[0];
  assert.ok(sort, 'ascending last message sort');
  const order = (list) => list.sort((a, b) => (a.last_message_at ?? 0) - (b.last_message_at ?? 0) || a.last_ref - b.last_ref || a.title.localeCompare(b.title)).map(t => t.id);
  assert.deepEqual(order([{ id: 'new', last_message_at: 30, last_ref: 1, title: 'b' }, { id: 'old', last_message_at: 10, last_ref: 9, title: 'a' }, { id: 'mid', last_message_at: 20, last_ref: 2, title: 'c' }]), ['old', 'mid', 'new']);
  assert.match(channels, /<MessageTime seconds=\{item\.last_message_at\} \/>/);
  assert.match(channels, /onContentSizeChange=\{\(_, height\) => \{ if \(stickToEnd\.current && height > 0\) topicList\.current\?\.scrollToEnd\(\{ animated: false \}\); \}\}/);
  assert.match(channels, /onScrollBeginDrag=\{\(\) => \{ stickToEnd\.current = false; \}\}/);
});

test('every conversation entry follows the latest message instead of restoring an old offset', () => {
  assert.match(app, /useState<TimelinePosition>\(\(\) => \(\{ offset: 0, following: true, startRef: positions\.current\.get\(threadId\)\?\.startRef \?\? null \}\)\)/);
  assert.match(app, /position=\{entryPosition\}/);
});
