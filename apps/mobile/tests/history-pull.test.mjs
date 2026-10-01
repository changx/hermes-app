import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as historyLayout from '../src/historyLayout.ts';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';
import { loadHistoryBlocks } from '../src/historyBlocks.ts';
import { HermesClient } from '../../../packages/client/dist/index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(process.env.HISTORY_TIMELINE_SOURCE ?? new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const appHandlers = new Set();
const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value, hairlineWidth: 0.5 },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  AppState: { currentState: 'active', addEventListener: (_event, handler) => { appHandlers.add(handler); return { remove() { appHandlers.delete(handler); } }; } } };
for (const name of ['ActivityIndicator', 'Pressable', 'RefreshControl', 'ScrollView', 'View']) native[name] = name;
// The app wiring tests substitute native list views; they are not device tests.
const modules = {
  react: React, 'react-native': native, './historyLayout': historyLayout, '@shopify/flash-list': { FlashList: 'FlashList' },
  './FontSize': { Text: 'Text', TextInput: 'TextInput' },
  'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler() {} },
  'react-native-reanimated': { View: 'View', FadeIn: { duration: duration => ({ reduceMotion: reduceMotion => ({ duration, reduceMotion }) }) }, ReduceMotion: { System: 'system' }, runOnJS: fn => fn, useSharedValue: value => React.useRef({ value }).current },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
  './timeline': timeline, './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' },
  './messageMarkdown': { messageNeedsViewport: () => false }, './receiptState': { hasRunningReceipt: () => false }
};
function load(text, imports, extras = {}) {
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, ...extras });
  return output.exports;
}
const frames = new Map(); let nextFrame = 0;
const { ChatTimeline } = load(source, modules, {
  // No Date or timers provided: obsolete delay/measurement code must not execute.
  requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id)
});
const row = ref => ({ key: `ref:${ref}`, refSeq: ref, role: 'assistant', text: `Message ${ref}` });
const event = (y, height = 1400) => ({ nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 600 }, contentInset: { bottom: 0 } } });
async function mount(overrides = {}, { released = true } = {}) {
  frames.clear(); const positions = [], scrolls = [];
  let props = { active: true, threadId: 'th', rows: [row(31)], startRef: 31, hasOlder: true, onOlder: async () => {},
    onPosition: value => positions.push(value), onVisibleRef() {}, text: '', onText() {}, onSend() {},
    receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false, ...overrides };
  let renderer;
  await act(async () => { renderer = create(React.createElement(ChatTimeline, props), { createNodeMock: node =>
    node.type === 'FlashList' ? { scrollToOffset: value => scrolls.push(value), getScrollResponder: () => ({ scrollToEnd: value => scrolls.push(value) }) } : null }); });
  const list = () => renderer.root.findByType('FlashList').props;
  const release = async () => { await act(async () => list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -80 }, velocity: { y: 0 } } })); };
  if (released) { await act(async () => list().onScrollBeginDrag()); await release(); }
  return { renderer, list, positions, scrolls,
    release,
    async begin() { await act(async () => list().onScrollBeginDrag()); },
    async app(state) { await act(async () => { for (const handler of [...appHandlers]) handler(state); }); },
    async flush() { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }); },
    async update(values) { props = { ...props, ...values }; await act(async () => renderer.update(React.createElement(ChatTimeline, props))); },
    async close() { await act(async () => renderer.unmount()); } };
}

test('FlashList owns position maintenance with stable keys, no top auto-jump and no bespoke anchor', async () => {
  const h = await mount();
  const config = h.list().maintainVisibleContentPosition;
  assert.equal(config.disabled, false);
  assert.equal(config.autoscrollToTopThreshold, undefined);
  assert.equal(config.autoscrollToBottomThreshold, undefined, 'existing explicit latest-follow owns tail behavior');
  assert.equal(h.list().keyExtractor(row(31)), 'ref:31');
  assert.equal(h.list().CellRendererComponent, undefined);
  const nativeAnchor = { minIndexForVisible: 0 }, scrollRef = React.createRef();
  const scroll = h.list().renderScrollComponent({ maintainVisibleContentPosition: nativeAnchor, ref: scrollRef });
  assert.equal(scroll.props.maintainVisibleContentPosition, nativeAnchor, 'FlashList native anchor passes through keyboard wrapper unchanged');
  assert.equal(scroll.props.ref, scrollRef, 'FlashList can still address the actual keyboard scroll view');
  assert.equal(h.list().maxItemsInRecyclePool, 0, 'rich media state must not leak to another message');
  await h.update({ rows: [row(1), row(31)] });
  assert.equal(h.list().maintainVisibleContentPosition, config, 'configuration stays stable during prepend');
  assert.equal(existsSync(new URL('../src/historyAnchor.ts', import.meta.url)), false);
  assert.doesNotMatch(source, /historyAnchorOffset|measureInWindow|releaseSnapshot|historyDelay|setTimeout/);
  await h.close();
});

test('early refresh waits for release, then starts without a timer; progress covers network', async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ onOlder: () => { calls++; return pending; } });
  assert.equal(h.list().ListHeaderComponent.props.children[0].props.accessibilityLabel, 'Pull down for earlier messages');
  const control = h.list().refreshControl;
  assert.equal(h.list().renderScrollComponent({ refreshControl: control }).props.refreshControl, control);
  await act(async () => { h.list().onScrollBeginDrag(); h.list().onScroll(event(-80)); });
  let request; await act(async () => { request = control.props.onRefresh(); });
  assert.equal(calls, 0, 'finger still down: no cache or network load');
  assert.equal(h.list().refreshControl.props.refreshing, true);
  assert.equal(h.positions.at(-1).following, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 0);
  await h.release();
  assert.equal(calls, 1, 'drag-end starts immediately, no one-second wait');
  await h.update({ rows: [row(1), row(31)], startRef: 1, hasOlder: false });
  assert.equal(h.list().refreshControl.props.refreshing, true);
  await act(async () => { finish(); await request; });
  assert.equal(h.list().refreshControl, undefined);
  await h.close();
});

test('cached expansion also waits for drag-end, and release without refresh does not load', async () => {
  let calls = 0;
  const h = await mount({ onOlder: () => { calls++; } }, { released: false });
  await h.begin(); await h.release(); assert.equal(calls, 0);
  await h.begin(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await act(async () => { h.list().onScroll(event(-100)); h.list().onScroll(event(-140)); });
  assert.equal(calls, 0);
  await h.release(); await request; assert.equal(calls, 1);
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.begin(); await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 1); await h.release(); await request; assert.equal(calls, 2, 'later gesture remains allowed');
  await h.close();
});

test('refresh delivered before observed begin-drag still cannot start until observed release', async () => {
  let calls = 0; const h = await mount({ onOlder: () => { calls++; } }, { released: false });
  let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 0); await h.begin(); assert.equal(calls, 0);
  await h.release(); await request; assert.equal(calls, 1);
  await h.close();
});

test('refresh delivered after drag-end starts immediately, not after a timeout', async () => {
  let calls = 0; const h = await mount({ onOlder: () => { calls++; } });
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 1); assert.doesNotMatch(source, /setTimeout|historyDelay|Date\.now/);
  await h.close();
});

test('pending release is canceled by blur, background, unmount or explicit latest', async () => {
  for (const action of ['blur', 'background', 'unmount', 'latest']) {
    let calls = 0; const h = await mount({ onOlder: () => { calls++; } }, { released: false });
    await h.begin(); let request;
    await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
    if (action === 'blur') await h.update({ active: false });
    if (action === 'background') await h.app('background');
    if (action === 'unmount') await h.close();
    if (action === 'latest') await act(async () => h.renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Jump to latest ↓').props.onPress());
    await request; assert.equal(calls, 0);
    if (action !== 'unmount') { await h.release(); assert.equal(calls, 0); await h.close(); }
  }
});

test('cancelled old waiter cannot clear the replacement gesture owner or its progress', async () => {
  let calls = 0, finish;
  const h = await mount({ onOlder: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }, { released: false });
  await h.begin(); let oldRequest, newRequest;
  await act(async () => { oldRequest = h.list().refreshControl.props.onRefresh(); });
  await act(async () => { h.list().onScrollBeginDrag(); newRequest = h.list().refreshControl.props.onRefresh(); });
  await oldRequest; assert.equal(calls, 0);
  assert.equal(h.list().refreshControl.props.refreshing, true);
  await h.release(); assert.equal(calls, 1);
  assert.equal(h.list().refreshControl.props.refreshing, true);
  await act(async () => { finish(); await newRequest; });
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.close();
});

test('release rechecks live availability and uses current callback rather than stale captured props', async () => {
  for (const values of [{ hasOlder: false }, { locatingBusy: true }]) {
    let calls = 0; const h = await mount({ onOlder: () => { calls++; } }, { released: false });
    await h.begin(); let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
    await h.update(values); await h.release(); await request; assert.equal(calls, 0);
    await h.close();
  }
  let oldCalls = 0, newCalls = 0;
  const h = await mount({ onOlder: () => { oldCalls++; } }, { released: false });
  await h.begin(); let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.update({ onOlder: () => { newCalls++; } }); await h.release(); await request;
  assert.equal(oldCalls, 0); assert.equal(newCalls, 1); await h.close();
});

test('real SDK paging with synthetic HTTP and visible 5-block publication do not start before release', async () => {
  const initial = [{ id: '100', ref_seq: 100, role: 'user', text: 'Synthetic user' }, { id: '101', ref_seq: 101, role: 'assistant', text: 'Synthetic reply' }];
  let requests = 0, h;
  const client = new HermesClient({ token: () => 'synthetic-only', http: { request: async () => {
    requests++;
    return { status: 200, body: { messages: [70, 75, 80, 85, 90].flatMap(ref => [
      { id: String(ref), ref_seq: ref, role: 'user', text: 'Synthetic earlier user' },
      { id: String(ref + 1), ref_seq: ref + 1, role: 'assistant', text: 'Synthetic earlier reply' }
    ]), older_cursor: null } };
  } } });
  client.supportsLatest = true; client.messages.set('t', initial);
  h = await mount({ rows: timeline.projectTimeline(initial, null, 't'), startRef: 100, onOlder: async () => {
    const blocks = await loadHistoryBlocks(client, 't', 100, 'synthetic-before');
    await h.update({ rows: timeline.projectTimeline(client.messages.get('t').filter(message => message.ref_seq >= blocks.startRef), null, 't'), startRef: blocks.startRef });
  } }, { released: false });
  await h.begin(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  assert.equal(requests, 0); assert.equal(h.list().data[0].refSeq, 100);
  await act(async () => {
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -80 }, velocity: { y: 0 } } });
    await request;
  });
  assert.equal(requests, 1); assert.equal(h.list().data[0].refSeq, 70);
  await h.flush(); assert.equal(h.scrolls.length, 0);
  await h.close();
});

test('prepending mixed long/short rows and refresh rebound never issue app-level correction scrolls', async () => {
  const h = await mount();
  await act(async () => { h.list().onScroll(event(0)); h.list().onLayout({ nativeEvent: { layout: { height: 600 } } }); await h.list().refreshControl.props.onRefresh(); });
  const original = row(31);
  await h.update({ rows: [{ ...row(1), text: '# Long reply\n' + 'Long markdown paragraph\n'.repeat(300) }, row(2), original], startRef: 1 });
  await act(async () => {
    h.list().onContentSizeChange(400, 6000);
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -80 }, velocity: { y: 1 } } });
    h.list().onScroll(event(0, 6000));
    h.list().onMomentumScrollEnd();
  });
  await h.flush();
  assert.equal(h.scrolls.length, 0, 'only the real library may move its anchor');
  assert.deepEqual(h.list().data.map(item => item.key), ['ref:1', 'ref:2', 'ref:31']);
  assert.equal(h.positions.at(-1).following, false);
  await h.close();
});

test('inactive, locating and exhausted guards; sending busy does not block history', async () => {
  for (const overrides of [{ active: false }, { locatingBusy: true }, { hasOlder: false }, { busy: true }]) {
    let calls = 0; const h = await mount({ ...overrides, onOlder: async () => { calls++; } });
    const control = h.list().refreshControl;
    if (control) await act(async () => { await control.props.onRefresh(); });
    assert.equal(calls, overrides.busy ? 1 : 0);
    await h.close();
  }
});

test('cached completion and failed pagination release lock for retry', async () => {
  let calls = 0; const h = await mount({ onOlder: async () => { if (++calls === 1) throw new Error('offline'); } });
  await act(async () => { await assert.rejects(h.list().refreshControl.props.onRefresh(), /offline/); });
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 2); assert.equal(h.list().refreshControl.props.refreshing, false);
  await h.close();
});

test('stale callbacks and pending completions do not address a blurred/unmounted list', async () => {
  let calls = 0; const h = await mount({ onOlder: async () => { calls++; } });
  const pull = h.list().refreshControl.props.onRefresh;
  await h.update({ active: false }); await act(async () => { await pull(); });
  assert.equal(calls, 0); await h.close();
  for (const blur of [true, false]) {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    const p = await mount({ onOlder: () => pending }); let request;
    await act(async () => { request = p.list().refreshControl.props.onRefresh(); });
    if (blur) await p.update({ active: false }); else await p.close();
    await act(async () => { finish(); await request; });
    assert.equal(p.scrolls.length, 0);
    if (blur) { assert.equal(p.list().refreshControl.props.refreshing, false); await p.close(); }
  }
});

test('App still uses original authoritative pagination and cached window expansion', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onOlder=\{loadOlder\}/);
  assert.match(app, /await loadHistoryBlocks\(client, id, visibleMessages\[0\]\?\.ref_seq \?\? null/);
  assert.doesNotMatch(app, /setStartRef\(olderStart/);
});

// Execute the INSTALLED library's real controller, not a reimplemented anchor
// algorithm. Layout-manager inputs/native anchor commands are controlled doubles;
// this regression does not claim native gesture/paint acceptance.
const controller = load(readFileSync(new URL('../node_modules/@shopify/flash-list/src/recyclerview/hooks/useRecyclerViewController.tsx', import.meta.url), 'utf8'), {
  react: React, 'react-native': { I18nManager: { isRTL: false } },
  '../utils/adjustOffsetForRTL': { adjustOffsetForRTL: value => value },
  '../../native/config/PlatformHelper': { PlatformConfig: { supportsOffsetCorrection: true } },
  '../../errors/WarningMessages': { WarningMessages: {} },
  './useUnmountFlag': { useUnmountFlag: () => React.useRef(false) },
  './useUnmountAwareCallbacks': { useUnmountAwareTimeout: () => ({ setTimeout() {} }) }
}).useRecyclerViewController;

test('installed FlashList controller retains original key through large prepend and later height refinement', async () => {
  const data = [{ key: 'original', y: 0 }]; let offset = 0, nativeOffset = 0, api;
  const corrections = [];
  const manager = {
    props: { data, horizontal: false }, ignoreScrollEvents: false, animationOptimizationsEnabled: false,
    getDataLength: () => data.length, getIsFirstLayoutComplete: () => true,
    hasStableDataKeys: () => true, shouldMaintainVisibleContentPosition: () => true,
    computeVisibleIndices: () => ({ startIndex: data.findIndex(item => item.key === 'original') }),
    getDataKey: index => data[index].key, getLayout: index => ({ x: 0, y: data[index].y, width: 400, height: 600 }),
    // The original anchor moves outside the engaged window after big prepends.
    getEngagedIndices: () => ({ findValue: predicate => data.length === 1 && predicate(0) ? 0 : undefined }),
    getAbsoluteLastScrollOffset: () => offset,
    updateScrollOffset: value => { offset = value; return undefined; }
  };
  function Harness() {
    api = controller(manager, React.useRef(null), React.useRef({}), React.useRef({ scrollBy: delta => { corrections.push(delta); nativeOffset += delta; } }));
    return null;
  }
  let renderer; await act(async () => { renderer = create(React.createElement(Harness)); });
  await act(async () => api.computeFirstVisibleIndexForOffsetCorrection());
  data.unshift({ key: 'older-long', y: 0 }, { key: 'older-short', y: 2000 }); data[2].y = 2100;
  await act(async () => api.applyOffsetCorrection());
  assert.deepEqual(corrections, [2100]); assert.equal(data[2].y - nativeOffset, 0);
  data[2].y = 2350;
  await act(async () => api.applyOffsetCorrection());
  assert.deepEqual(corrections, [2100, 250]); assert.equal(data[2].y - nativeOffset, 0, 'same original top after refinement');
  await act(async () => api.applyOffsetCorrection());
  assert.equal(corrections.length, 2, 'already stable layout is not corrected again');
  await act(async () => renderer.unmount());
});

async function headerHarness(h) {
  let rendered;
  await act(async () => { rendered = create(h.list().ListHeaderComponent); });
  return {
    rendered,
    hint: () => rendered.root.findByProps({ testID: 'history-hint' }),
    async sync() { await act(async () => rendered.update(h.list().ListHeaderComponent)); },
    async close() { await act(async () => rendered.unmount()); }
  };
}
const cell = (h, value, target = 'Cell') => h.list().renderItem({ item: value, target });
async function renderCell(h, value) {
  let rendered; await act(async () => { rendered = create(cell(h, value)); }); return rendered;
}

test('fixed English top hint changes pull/release/loading/exhausted copy without changing its native slot', async () => {
  let finish, calls = 0;
  const h = await mount({ onOlder: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }, { released: false });
  const header = await headerHarness(h), initial = header.hint(), slot = initial.props.style;
  assert.equal(initial.props.accessibilityLabel, 'Pull down for earlier messages');
  assert.equal(slot.height, 44);
  assert.equal(header.rendered.root.findAllByType('ActivityIndicator').length, 0);
  await h.begin(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await header.sync(); assert.equal(calls, 0);
  assert.equal(header.hint().props.accessibilityLabel, 'Release to load');
  await h.release(); await header.sync(); assert.equal(calls, 1);
  assert.equal(header.hint().props.accessibilityLabel, 'Loading history…');
  assert.equal(header.hint().props.accessibilityLiveRegion, 'polite');
  assert.equal(header.rendered.root.findAllByType('ActivityIndicator').length, 1);
  await h.update({ rows: [row(1), row(31)], startRef: 1, hasOlder: false });
  await header.sync(); assert.equal(header.hint().props.accessibilityLabel, 'Loading history…', 'finish the request before declaring exhaustion');
  await act(async () => { finish(); await request; }); await header.sync();
  assert.equal(header.hint().props.accessibilityLabel, 'Start of conversation');
  assert.equal(header.hint(), initial, 'same native header element, not conditional mount');
  assert.equal(header.hint().props.style, slot, 'height and padding unchanged across all statuses');
  assert.equal(header.rendered.root.findAllByType('ActivityIndicator').length, 0);
  assert.equal(h.list().refreshControl, undefined);
  assert.deepEqual(h.scrolls, []);
  await header.close(); await h.close();
});

test('header keeps its slot but does not falsely claim the start while empty or locating; existing locate action survives', async () => {
  let located = 0;
  const h = await mount({ rows: [], hasOlder: false });
  const header = await headerHarness(h), slot = header.hint().props.style;
  assert.equal(header.hint().props.accessibilityLabel, undefined);
  assert.equal(header.hint().props.accessible, false);
  await h.update({ rows: [row(31)], hasOlder: true, locatingMessage: 'Looking for a message', locatingBusy: true, onLocateNext: () => { located++; } });
  await header.sync();
  assert.equal(header.hint().props.accessibilityLabel, undefined);
  assert.ok(header.rendered.root.findAllByType('Text').some(n => n.children.includes('Looking for a message')));
  const button = header.rendered.root.findByProps({ accessibilityLabel: 'Keep looking' });
  assert.equal(button.props.disabled, true);
  await h.update({ locatingBusy: false }); await header.sync();
  header.rendered.root.findByProps({ accessibilityLabel: 'Keep looking' }).props.onPress(); assert.equal(located, 1);
  await h.update({ locatingMessage: undefined, locatingBusy: false }); await header.sync();
  assert.equal(header.hint().props.accessibilityLabel, 'Pull down for earlier messages');
  assert.equal(header.hint().props.style, slot);
  await header.close(); await h.close();
});

test('cancelled and failed pull restore the hint for retry, without creating a reading boundary', async () => {
  const h = await mount({ onOlder: async () => { throw new Error('synthetic page failure'); } }, { released: false });
  const header = await headerHarness(h);
  await h.begin(); let request;
  await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await header.sync(); assert.equal(header.hint().props.accessibilityLabel, 'Release to load');
  await h.app('background'); await request; await header.sync();
  assert.equal(header.hint().props.accessibilityLabel, 'Pull down for earlier messages');
  await h.app('active'); await h.begin(); await h.release();
  await act(async () => { await assert.rejects(h.list().refreshControl.props.onRefresh(), /synthetic page failure/); });
  await header.sync(); assert.equal(header.hint().props.accessibilityLabel, 'Pull down for earlier messages');
  assert.equal(cell(h, row(31)).props.historyBoundary, false);
  assert.equal(h.list().refreshControl.props.refreshing, false);
  await header.close(); await h.close();
});

test('successful prepends mark only the former first key; marker survives reading/remount and moves on the next batch', async () => {
  const original = { ...row(31), role: 'user' }, older = row(10);
  const h = await mount({ rows: [original] });
  const rendered = await renderCell(h, original), contentNode = rendered.root.findByType('MessageContent');
  assert.equal(rendered.root.findAllByProps({ testID: 'history-boundary' }).length, 0);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  await h.update({ rows: [older, original], startRef: 10 });
  assert.equal(cell(h, older).props.historyBoundary, false);
  assert.equal(cell(h, original).props.historyBoundary, true);
  assert.equal(cell(h, original, 'Measurement').props.historyBoundary, true, 'hidden measurement must include the same padding');
  assert.equal(cell(h, original, 'StickyHeader').props.historyBoundary, false);
  await act(async () => rendered.update(cell(h, original)));
  const line = rendered.root.findByProps({ testID: 'history-boundary' });
  assert.equal(line.props.style.paddingVertical, 8);
  assert.equal(line.props.style.position, undefined, 'padding must create real whitespace, not another overlay');
  assert.equal(line.children[0].props.style.height, native.StyleSheet.hairlineWidth);
  let measured;
  await act(async () => { measured = create(cell(h, original, 'Measurement')); });
  assert.equal(measured.root.findByProps({ testID: 'history-boundary' }).props.style, line.props.style);
  await act(async () => measured.unmount());
  assert.equal(line.props.pointerEvents, 'none'); assert.equal(line.props.accessibilityElementsHidden, true);
  assert.equal(line.props.accessibilityLabel, undefined, 'divider is deliberately text-free');
  assert.equal(rendered.root.findByType('MessageContent'), contentNode, 'adding marker does not remount the message');
  await h.begin(); await act(async () => h.list().onScroll(event(200)));
  assert.equal(cell(h, original).props.historyBoundary, true, 'ordinary scrolling does not clear the marker');
  const remount = await renderCell(h, original);
  assert.equal(remount.root.findAllByProps({ testID: 'history-boundary' }).length, 1);
  await act(async () => remount.unmount());
  await h.release(); await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  await h.update({ rows: [row(1), older, original], startRef: 1 });
  assert.equal(cell(h, older).props.historyBoundary, true);
  assert.equal(cell(h, original).props.historyBoundary, false);
  await act(async () => rendered.update(cell(h, original)));
  assert.equal(rendered.root.findAllByProps({ testID: 'history-boundary' }).length, 0);
  assert.equal(rendered.root.findByType('MessageContent'), contentNode);
  await h.update({ threadId: 'another-thread' });
  assert.equal(cell(h, older).props.historyBoundary, false, 'marker is local to this conversation');
  await h.flush(); assert.deepEqual(h.scrolls, []);
  await act(async () => rendered.unmount()); await h.close();
});

test('initial/unsolicited prepends and ordinary appends do not create a divider', async () => {
  const h = await mount({ rows: [row(31)] });
  await h.update({ rows: [row(10), row(31)] });
  assert.equal(cell(h, row(31)).props.historyBoundary, false);
  await h.update({ rows: [row(10), row(31), row(32)] });
  assert.equal(cell(h, row(10)).props.historyBoundary, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  await h.update({ rows: [row(1), row(10), row(31), row(32)] });
  assert.equal(cell(h, row(10)).props.historyBoundary, true);
  await h.update({ rows: [row(31), row(32)] });
  await h.update({ rows: [row(10), row(31), row(32)] });
  assert.equal(cell(h, row(10)).props.historyBoundary, false, 'discarded marker does not resurrect');
  await h.close();
});

test('a deliberate new drag during a started request does not lose the loaded-history divider', async () => {
  let finish;
  const h = await mount({ onOlder: () => new Promise(resolve => { finish = resolve; }) });
  let request; await act(async () => { request = h.list().refreshControl.props.onRefresh(); });
  await h.begin();
  await h.update({ rows: [row(10), row(31)], startRef: 10 });
  assert.equal(cell(h, row(31)).props.historyBoundary, true);
  await act(async () => { finish(); await request; });
  await h.close();
});

test('padded divider stays outside the original assistant, tool and notice roots without remounting them', async () => {
  for (const original of [row(31), { ...row(31), text: '', toolCalls: [{ id: 't', name: 'synthetic' }] }, { ...row(31), displayKind: 'system_notice' }]) {
    const h = await mount({ rows: [original] });
    const rendered = await renderCell(h, original);
    const originalRoot = rendered.root.findAllByType('View')[0];
    await act(async () => { await h.list().refreshControl.props.onRefresh(); });
    await h.update({ rows: [row(1), original], startRef: 1 });
    await act(async () => rendered.update(cell(h, original)));
    const lines = rendered.root.findAllByProps({ testID: 'history-boundary' });
    assert.equal(lines.length, 1); assert.equal(lines[0].props.style.paddingVertical, 8);
    assert.equal(lines[0].children[0].props.style.height, native.StyleSheet.hairlineWidth);
    assert.equal(lines[0].parent, originalRoot.parent, 'spacer and original message are siblings');
    assert.ok(rendered.root.findAllByType('View').includes(originalRoot), 'original native root is retained');
    await h.flush(); assert.deepEqual(h.scrolls, [], 'FlashList remains the only prepend anchor');
    await act(async () => rendered.unmount()); await h.close();
  }
});
