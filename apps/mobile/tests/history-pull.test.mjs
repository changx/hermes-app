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
const output = { exports: {} }, frames = new Map(), timers = new Map();
let now = 0, nextID = 0;
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
  { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
    Date: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++nextID; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++nextID, fn); return nextID; }, cancelAnimationFrame: id => frames.delete(id) });
const { ChatTimeline } = output.exports;
const row = ref => ({ key: `ref:${ref}`, refSeq: ref, role: 'assistant', text: `Message ${ref}` });
const scrollEvent = (y, height = 1400) => ({ nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 600 }, contentInset: { bottom: 0 } } });
async function mount(overrides = {}) {
  frames.clear(); timers.clear(); now = 0;
  const positions = [], scrolls = [];
  let props = { active: true, threadId: 'th', rows: [row(31)], startRef: 31, hasOlder: true, onOlder: async () => {},
    onPosition: value => positions.push(value), onVisibleRef() {}, text: '', onText() {}, onSend() {},
    receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false, ...overrides };
  let renderer;
  await act(async () => { renderer = create(React.createElement(ChatTimeline, props), { createNodeMock: node =>
    node.type === 'FlatList' ? { scrollToOffset: value => scrolls.push(value) }
      : node.type === 'BlurTargetView' ? { measureInWindow: cb => cb(0, 100, 400, 600) } : null }); });
  const list = () => renderer.root.findByType('FlatList').props;
  const cell = async (item, top = 12, height = 180) => {
    const element = list().CellRendererComponent({ item, children: null });
    await act(async () => element.props.onLayout({ nativeEvent: { layout: { y: top, height } } }));
    return element;
  };
  await act(async () => { list().onScroll(scrollEvent(0)); list().onLayout({ nativeEvent: { layout: { height: 600 } } }); });
  await cell(row(31));
  frames.clear();
  return { renderer, list, positions, scrolls, cell,
    async advance(ms) { await act(async () => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } }); },
    async flush() { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }); },
    async release(y = -80) { await act(async () => { list().onScrollBeginDrag(); list().onScroll(scrollEvent(y)); list().onScrollEndDrag({ nativeEvent: { contentOffset: { y }, velocity: { y: 1 } } }); }); },
    async update(values) { props = { ...props, ...values }; await act(async () => renderer.update(React.createElement(ChatTimeline, props))); },
    async close() { await act(async () => renderer.unmount()); assert.equal(timers.size, 0); } };
}

test('delay is one second after release; duplicate requests suppressed and progress awaits network', async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ onOlder: () => { calls++; return pending; } });
  assert.equal(h.list().ListHeaderComponent, null);
  assert.equal(h.list().renderScrollComponent({ refreshControl: h.list().refreshControl }).props.refreshControl, h.list().refreshControl);
  await h.release();
  let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.advance(999); assert.equal(calls, 0);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  await h.advance(1); assert.equal(calls, 1);
  assert.equal(h.list().refreshControl.props.refreshing, true);
  assert.equal(h.positions.at(-1).following, false);
  await h.update({ hasOlder: false });
  await act(async () => { finish(); await request; });
  assert.equal(h.list().refreshControl, undefined);
  await h.close();
});

test('onRefresh before drag-end does not load while finger held; timer starts at final release', async () => {
  let calls = 0;
  const h = await mount({ onOlder: async () => { calls++; } });
  await act(async () => { h.list().onScrollBeginDrag(); h.list().onScroll(scrollEvent(-60)); });
  let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.advance(2000); assert.equal(calls, 0);
  await act(async () => { h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -100 } } }); });
  await h.advance(999); assert.equal(calls, 0);
  await h.advance(1); await request; assert.equal(calls, 1);
  await h.update({ rows: [row(1), row(31)] });
  await h.cell(row(31), 512); await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 400);
  await h.close();
});

test('prepend keeps FIRST original message top at release coordinate, not a newly selected middle record', async () => {
  const h = await mount({ rows: [row(31), row(32)] });
  await h.cell(row(32), 250);
  await h.release(-80);
  let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await act(async () => h.list().onScroll(scrollEvent(0))); // native rebound
  await h.advance(1000); await request;
  await h.update({ rows: [row(1), row(31), row(32)], startRef: 1 });
  await h.cell(row(32), 900);
  await act(async () => h.list().onContentSizeChange(400, 2200)); await h.flush();
  assert.equal(h.scrolls.length, 0, 'wait for original cell committed layout, not other rows or content estimates');
  await h.cell(row(31), 512);
  assert.equal(h.scrolls.at(-1).offset, 420, 'correct in cell layout callback, without waiting another frame');
  await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 420);
  assert.equal(100 + 512 - h.scrolls.at(-1).offset, 100 + 12 - (-80));
  assert.equal(h.scrolls.at(-1).animated, false);
  assert.deepEqual(h.list().data.map(item => item.key), ['ref:1', 'ref:31', 'ref:32']);
  const count = h.scrolls.length;
  await act(async () => h.list().onScroll(scrollEvent(420, 2000))); await h.flush();
  assert.equal(h.scrolls.length, count, 'native aligned position is not double compensated');
  // Late height above the SAME record uses absolute target, independent of stale offset.
  await h.cell(row(31), 542); await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 450);
  await h.close();
});

test('late onRefresh uses remaining delay from release and never recaptures after rebound', async () => {
  let calls = 0;
  const h = await mount({ onOlder: async () => { calls++; } });
  await h.release(-96); await h.advance(600);
  await act(async () => h.list().onScroll(scrollEvent(0)));
  let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.advance(399); assert.equal(calls, 0);
  await h.advance(1); await request; assert.equal(calls, 1);
  await h.cell(row(31), 512); await h.flush();
  assert.equal(h.scrolls.at(-1).offset, 404);
  await h.close();
});

test('blur, unmount, or a new gesture during delay cancels without loading', async () => {
  for (const action of ['blur', 'unmount', 'drag']) {
    let calls = 0;
    const h = await mount({ onOlder: async () => { calls++; } });
    await h.release(); let request;
    await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
    await h.advance(500);
    if (action === 'blur') await h.update({ active: false });
    if (action === 'unmount') await h.close();
    if (action === 'drag') await act(async () => h.list().onScrollBeginDrag());
    await h.advance(1000); await request; assert.equal(calls, 0);
    if (action !== 'unmount') await h.close();
  }
});

test('inactive, locating, exhausted guards; send busy remains independent', async () => {
  for (const overrides of [{ active: false }, { locatingBusy: true }, { hasOlder: false }, { busy: true }]) {
    let calls = 0;
    const h = await mount({ ...overrides, onOlder: async () => { calls++; } });
    const control = h.list().refreshControl;
    let request; if (control) await act(async () => { request = control.props.onRefresh(); });
    await h.advance(1000); await request;
    assert.equal(calls, overrides.busy ? 1 : 0);
    await h.close();
  }
});

test('becoming exhausted or locating during delay prevents stale pagination', async () => {
  for (const values of [{ hasOlder: false }, { locatingBusy: true }]) {
    let calls = 0; const h = await mount({ onOlder: async () => { calls++; } });
    await h.release(); let request;
    await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
    await h.update(values); await h.advance(1000); await request; assert.equal(calls, 0);
    await h.close();
  }
});

test('cached completion and failed request release lock for retry after a new delay', async () => {
  let calls = 0;
  const h = await mount({ onOlder: async () => { if (++calls === 1) throw new Error('offline'); } });
  await h.release(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  const rejected = assert.rejects(request, /offline/);
  await h.advance(1000); await rejected;
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.release(); await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.advance(1000); await request;
  assert.equal(calls, 2); assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.close();
});

test('stale callback after focus loss does not load', async () => {
  let calls = 0; const h = await mount({ onOlder: async () => { calls++; } });
  const pull = h.list().refreshControl.props.onRefresh;
  await h.update({ active: false }); await act(async () => { await pull(); });
  await h.advance(1000); assert.equal(calls, 0); await h.close();
});

test('blur before release cancels the release gate; no delayed load or stale progress on return', async () => {
  let calls = 0; const h = await mount({ onOlder: async () => { calls++; } });
  await act(async () => { h.list().onScrollBeginDrag(); h.list().onScroll(scrollEvent(-80)); });
  let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.update({ active: false }); await request; await h.advance(2000);
  await h.update({ active: true });
  assert.equal(calls, 0); assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.close();
});

test('unmounted cell layout is not reused as an anchor and a new gesture owns scrolling after prepend', async () => {
  let calls = 0; const h = await mount({ onOlder: async () => { calls++; } });
  const original = await h.cell(row(31));
  await act(async () => original.props.ref(null));
  await h.release(); await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  await h.advance(1000); assert.equal(calls, 0, 'no arbitrary jump when original geometry unavailable');
  await h.cell(row(31)); await h.release(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.advance(1000); await request; await h.cell(row(31), 512);
  const count = h.scrolls.length;
  await act(async () => h.list().onScrollBeginDrag());
  await h.cell(row(31), 700); await h.flush(); assert.equal(h.scrolls.length, count);
  await h.close();
});

test('absolute content geometry cannot double-count a native prepend scroll', () => {
  const anchor = historyAnchor.releasedHistoryAnchor([{ key: 'original', top: 12, height: 180 }, { key: 'middle', top: 250, height: 180 }], -80, 600, 100);
  assert.deepEqual(anchor, { key: 'original', top: 192 });
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 512, 100, 0), 420);
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 512, 100, 400), 420);
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 512, 100, 420), null);
  assert.equal(historyAnchor.historyAnchorOffset(anchor, 12, 100, 0), null);
});

test('App still passes authoritative pagination Promise and cached history path', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /onOlder=\{loadOlder\}/);
  assert.match(source, /await client\.historyWindow\(id, pageCursor\)/);
  assert.match(source, /if \(first > 0\) \{ setStartRef\(olderStart/);
});
