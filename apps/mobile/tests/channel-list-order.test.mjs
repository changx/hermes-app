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

test('sessions show newest at the top from first frame without scrolling', () => {
  const sort = channels.match(/\.sort\(\(a, b\) => \(b\.last_message_at \?\? 0\) - \(a\.last_message_at \?\? 0\)[^\n]*/)?.[0];
  assert.ok(sort, 'newest-first data for the ordinary list');
  const order = (list) => list.sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0) || b.last_ref - a.last_ref || b.title.localeCompare(a.title)).map(t => t.id);
  assert.deepEqual(order([{ id: 'old', last_message_at: 10, last_ref: 9, title: 'a' }, { id: 'new', last_message_at: 30, last_ref: 1, title: 'b' }, { id: 'mid', last_message_at: 20, last_ref: 2, title: 'c' }]), ['new', 'mid', 'old']);
  assert.doesNotMatch(channels, /<FlatList inverted/);
  assert.match(channels, /<MessageTime seconds=\{item\.last_message_at\} \/>/);
  assert.doesNotMatch(channels, /scrollToEnd|stickToEnd|onContentSizeChange/);
});

test('no generic Opening status is shown over channels or conversations', () => {
  assert.doesNotMatch(app, /loading && <Text[^>]*>Opening…/);
  assert.doesNotMatch(app, /'Opening conversation…' :/);
  assert.match(readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8'), /ListEmptyComponent=\{props\.locatingMessage \|\| props\.locatingBusy \? null :/);
});

test('every conversation entry follows the latest message instead of restoring an old offset', () => {
  assert.match(app, /useState<TimelinePosition>\(\(\) => \(\{ offset: 0, following: true, startRef: null \}\)\)/);
  assert.match(app, /position=\{entryPosition\}/);
});
