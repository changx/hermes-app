import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  AppState: { addEventListener: () => ({ remove() {} }) } };
for (const name of ['Pressable', 'RefreshControl', 'ScrollView', 'View']) native[name] = name;
// The app wiring tests substitute native list views; they are not device tests.
const modules = {
  react: React, 'react-native': native, '@shopify/flash-list': { FlashList: 'FlashList' },
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
async function mount(overrides = {}) {
  frames.clear(); const positions = [], scrolls = [];
  let props = { active: true, threadId: 'th', rows: [row(31)], startRef: 31, hasOlder: true, onOlder: async () => {},
    onPosition: value => positions.push(value), onVisibleRef() {}, text: '', onText() {}, onSend() {},
    receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false, ...overrides };
  let renderer;
  await act(async () => { renderer = create(React.createElement(ChatTimeline, props), { createNodeMock: node =>
    node.type === 'FlashList' ? { scrollToOffset: value => scrolls.push(value) } : null }); });
  const list = () => renderer.root.findByType('FlashList').props;
  return { renderer, list, positions, scrolls,
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

test('pull starts immediately without release delay, progress covers network, repeats suppressed', async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await mount({ onOlder: () => { calls++; return pending; } });
  assert.equal(h.list().ListHeaderComponent, null);
  const control = h.list().refreshControl;
  assert.equal(h.list().renderScrollComponent({ refreshControl: control }).props.refreshControl, control);
  await act(async () => { h.list().onScrollBeginDrag(); h.list().onScroll(event(-80)); });
  let request; await act(async () => { request = control.props.onRefresh(); });
  assert.equal(calls, 1);
  assert.equal(h.list().refreshControl.props.refreshing, true);
  assert.equal(h.positions.at(-1).following, false);
  await act(async () => { await h.list().refreshControl.props.onRefresh(); });
  assert.equal(calls, 1);
  await h.update({ rows: [row(1), row(31)], startRef: 1, hasOlder: false });
  assert.equal(h.list().refreshControl.props.refreshing, true);
  await act(async () => { finish(); await request; });
  assert.equal(h.list().refreshControl, undefined);
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
