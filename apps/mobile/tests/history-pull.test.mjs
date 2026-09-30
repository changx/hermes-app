import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';
import * as historyAnchor from '../src/historyAnchor.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  AppState: { addEventListener: () => ({ remove() {} }) } };
for (const name of ['FlatList', 'Pressable', 'RefreshControl', 'ScrollView', 'View']) native[name] = name;
const modules = {
  react: React, 'react-native': native, './FontSize': { Text: 'Text', TextInput: 'TextInput' },
  'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler() {} },
  'react-native-reanimated': { runOnJS: fn => fn, useSharedValue: value => React.useRef({ value }).current },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
  './historyAnchor': historyAnchor, './timeline': timeline, './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' },
  './messageMarkdown': { messageNeedsViewport: () => false }, './receiptState': { hasRunningReceipt: () => false }
};
const output = { exports: {} };
const frames = new Map();
let nextFrame = 0;
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
  { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
    setTimeout, clearTimeout,
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) });
const { ChatTimeline } = output.exports;
const row = ref => ({ key: `ref:${ref}`, refSeq: ref, role: 'assistant', text: `Message ${ref}` });
async function mount(overrides = {}) {
  frames.clear();
  const positions = [], scrolls = [];
  let props = { active: true, threadId: 'th', rows: [row(31)], startRef: 31, hasOlder: true, onOlder: async () => {},
    onPosition: position => positions.push(position), onVisibleRef() {}, text: '', onText() {}, onSend() {},
    receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false, ...overrides };
  let renderer;
  await act(async () => { renderer = create(React.createElement(ChatTimeline, props), { createNodeMock: node =>
    node.type === 'FlatList' ? { scrollToOffset: value => scrolls.push(value) }
      : node.type === 'BlurTargetView' ? { measureInWindow: cb => cb(0, 100, 400, 600) } : null }); });
  const list = () => renderer.root.findByType('FlatList').props;
  return { renderer, list, positions, scrolls,
    cell(item, geometry) {
      const cell = list().CellRendererComponent({ item, children: null });
      cell.props.ref({ measureInWindow: cb => cb(0, geometry.top, 400, geometry.height) });
      return cell;
    },
    async flush() { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }); },
    async update(values) { props = { ...props, ...values }; await act(async () => renderer.update(React.createElement(ChatTimeline, props))); },
    async close() { await act(async () => renderer.unmount()); } };
}

test('top pull loads one page, keeps progress until completion, and stops latest-follow before prepending', async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ onOlder: () => { calls++; return pending; } });
  assert.equal(h.list().ListHeaderComponent, null, 'old load button removed');
  assert.equal(h.list().refreshControl.type, 'RefreshControl');
  assert.equal(h.list().refreshControl.props.refreshing, false);
  const scroll = h.list().renderScrollComponent({ refreshControl: h.list().refreshControl });
  assert.equal(scroll.type, 'KeyboardChatScrollView');
  assert.equal(scroll.props.refreshControl, h.list().refreshControl, 'native refresh survives custom keyboard scroll wrapper');
  const anchor = JSON.stringify(h.list().maintainVisibleContentPosition);
  let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 1);
  assert.equal(h.list().refreshControl.props.refreshing, true);
  assert.equal(h.positions.at(-1).following, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 1, 'repeat pulls cannot request duplicate page');
  await h.update({ rows: [row(1), row(31)], startRef: 1, hasOlder: false });
  assert.equal(h.list().refreshControl.props.refreshing, true, 'last page retains control until finished');
  assert.equal(JSON.stringify(h.list().maintainVisibleContentPosition), anchor);
  await act(async () => { finish(); await request; for (const fn of frames.values()) fn(); frames.clear(); });
  assert.equal(h.list().refreshControl, undefined, 'no further pull once history is exhausted');
  assert.equal(h.scrolls.length, 0, 'history insertion must not scroll to latest');
  await h.close();
});

test('inactive, locating and exhausted conversations cannot request history; send busy is independent', async () => {
  for (const overrides of [{ active: false }, { locatingBusy: true }, { hasOlder: false }, { busy: true }]) {
    let calls = 0;
    const h = await mount({ ...overrides, onOlder: async () => { calls++; } });
    const control = h.list().refreshControl;
    if (control) await act(async () => { await control.props.onRefresh(); });
    assert.equal(calls, overrides.busy ? 1 : 0);
    if (control) assert.equal(control.props.enabled, !!overrides.busy);
    await h.close();
  }
});

test('cached history completes immediately and a failed request releases the pull lock for retry', async () => {
  let calls = 0;
  const h = await mount({ onOlder: async () => { if (++calls === 1) throw new Error('offline'); } });
  await act(async () => { await assert.rejects(h.list().refreshControl.props.onRefresh(), /offline/); });
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 2);
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.close();
});

test('a stale pull callback cannot load history after route loses focus', async () => {
  let calls = 0;
  const h = await mount({ onOlder: async () => { calls++; } });
  const oldPull = h.list().refreshControl.props.onRefresh;
  await h.update({ active: false });
  await act(async () => { await oldPull(); });
  assert.equal(calls, 0);
  await h.close();
});

const scrollEvent = (y, height = 1400) => ({ nativeEvent: {
  contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 600 }, contentInset: { bottom: 0 }
} });

test('prepend preserves the middle message at its released pull position, not the old offset or new top', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ rows: [row(31), row(32)], onOlder: () => pending });
  const first = { top: 180, height: 100 }, middle = { top: 350, height: 120 };
  h.cell(row(31), first); const middleCell = h.cell(row(32), middle);
  await act(async () => {
    h.list().onScrollBeginDrag(); h.list().onScroll(scrollEvent(-80));
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -80 }, velocity: { y: 1 } } });
  });
  let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.update({ rows: [row(1), row(31), row(32)], startRef: 1 });
  // Native first-item anchoring/rebound left the middle record 70pt too low.
  middle.top = 420;
  await act(async () => { h.list().onScroll(scrollEvent(400, 2200)); finish(); await request; });
  await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 470);
  assert.equal(h.scrolls.at(-1).animated, false);
  assert.equal(middle.top - (h.scrolls.at(-1).offset - 400), 350, 'same record stays at released screen coordinate');
  assert.deepEqual(h.list().data.map(item => item.key), ['ref:1', 'ref:31', 'ref:32']);
  assert.equal(h.positions.at(-1).following, false);
  // Already-correct native anchoring must not be compensated twice.
  middle.top = 350;
  const count = h.scrolls.length;
  await act(async () => { h.list().onScroll(scrollEvent(470, 2200)); middleCell.props.onLayout({}); });
  await h.flush();
  assert.equal(h.scrolls.length, count);
  // A later height change above the anchor is corrected, not total content growth below it.
  middle.top = 380;
  await act(async () => { middleCell.props.onLayout({}); });
  await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 500);
  // The next deliberate gesture takes ownership; no correction fights the reader.
  const after = h.scrolls.length;
  await act(async () => { h.list().onScrollBeginDrag(); middle.top = 450; middleCell.props.onLayout({}); });
  await h.flush();
  assert.equal(h.scrolls.length, after);
  await h.close();
});

test('measurements after rebound restore the full released gap and blur cancels pending correction', async () => {
  const h = await mount({ onOlder: async () => {} });
  const geometry = { top: 112, height: 180 };
  const cell = h.cell(row(31), geometry);
  await act(async () => {
    h.list().onScrollBeginDrag(); h.list().onScroll(scrollEvent(-96));
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -96 } } });
    h.list().onScroll(scrollEvent(0)); // rebound before native measurement returns
    await h.list().refreshControl.props.onRefresh();
  });
  geometry.top = 612;
  await act(async () => { h.list().onScroll(scrollEvent(0, 2000)); });
  await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 404, '500pt prepend minus the retained 96pt pull gap');
  const count = h.scrolls.length;
  geometry.top = 800;
  await act(async () => { cell.props.onLayout({}); });
  await h.update({ active: false });
  await h.flush();
  assert.equal(h.scrolls.length, count);
  await h.close();
});

test('refresh fired before drag end uses final release height, not the threshold height', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ onOlder: () => pending });
  const geometry = { top: 172, height: 180 };
  h.cell(row(31), geometry);
  await act(async () => { h.list().onScrollBeginDrag(); h.list().onScroll(scrollEvent(-60)); });
  let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await act(async () => {
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -100 }, velocity: { y: 1 } } });
    geometry.top = 612;
    h.list().onScroll(scrollEvent(0, 2000));
    finish(); await request;
  });
  await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 400, 'the full final 100pt gap is retained');
  await h.close();
});

test('anchor geometry uses stable identity and real middle row measurement', () => {
  const anchor = historyAnchor.middleHistoryAnchor([
    { key: 'offscreen', top: -400, height: 100 }, { key: 'first', top: 150, height: 100 },
    { key: 'middle', top: 350, height: 100 }, { key: 'bottom', top: 650, height: 100 }
  ], 100, 600);
  assert.deepEqual(anchor, { key: 'middle', top: 250 });
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 950, 100, 40), 640);
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 350, 100, 640), null);
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 110, 100, 0), null, 'no repeated command at the top boundary');
  assert.equal(historyAnchor.middleHistoryAnchor([], 100, 600), null);
});

test('App passes the history promise through so progress covers network pagination', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /onOlder=\{loadOlder\}/);
  assert.match(source, /await client\.historyWindow\(id, pageCursor\)/);
  assert.match(source, /if \(first > 0\) \{ setStartRef\(olderStart/);
});
