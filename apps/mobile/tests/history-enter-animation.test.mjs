import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as historyLayout from '../src/historyLayout.ts';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(source, modules, extra = {}) {
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, ...extra });
  return output.exports;
}
// Execute the installed FadeIn builder itself. Timing/native rendering are
// substitutes; these checks are not an iPhone animation-frame measurement.
class Builder {
  static duration(duration) { const instance = this.createInstance(); instance.durationV = duration; return instance; }
  reduceMotion(mode) { this.reduceMotionV = mode; return this; }
  getDelayFunction() { return (_delay, animation) => animation; }
  getAnimationAndConfig() { return [(target, config) => ({ target, config }), { duration: this.durationV }]; }
  getDelay() { return 0; }
}
const { FadeIn } = load(readFileSync(new URL('../node_modules/react-native-reanimated/src/layoutReanimation/defaultAnimations/Fade.ts', import.meta.url), 'utf8'), {
  '../animationBuilder': { ComplexAnimationBuilder: Builder },
  './utils': { animateTransformToValues() { assert.fail('FadeIn must not animate transforms'); }, pickTransformValues() { assert.fail('FadeIn must not animate transforms'); } }
});
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const row = (ref, role = 'assistant') => ({ key: `ref:${ref}`, refSeq: ref, role, text: `Synthetic ${ref}` });
async function harness({ reduced = false } = {}) {
  const callbacks = {}, frames = new Map(), scrolls = [], lifecycle = { contentMounts: 0 };
  let frameID = 0;
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
    AppState: { currentState: 'active', addEventListener: (_event, callback) => { callbacks.app = callback; return { remove() {} }; } },
    AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: (_event, callback) => { callbacks.reduce = callback; return { remove() {} }; } } };
  for (const name of ['View', 'Pressable', 'RefreshControl', 'ScrollView']) native[name] = name;
  function MessageContent() { React.useEffect(() => { lifecycle.contentMounts++; }, []); return React.createElement('MessageContent'); }
  const modules = {
    react: React, 'react-native': native, './historyLayout': historyLayout, '@shopify/flash-list': { FlashList: 'FlashList' },
    'react-native-reanimated': { View: 'HistoryAnimatedView', FadeIn, ReduceMotion: { System: 'system' }, runOnJS: fn => fn, useSharedValue: value => React.useRef({ value }).current },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' }, './FontSize': { Text: 'Text', TextInput: 'TextInput' },
    './timeline': timeline, './MessageContent': { MessageContent }, './MessageTime': { MessageTime: 'MessageTime' },
    './messageMarkdown': { messageNeedsViewport: () => false }, './receiptState': { hasRunningReceipt: () => false }
  };
  const { ChatTimeline } = load(source, modules, { requestAnimationFrame: fn => { frames.set(++frameID, fn); return frameID; }, cancelAnimationFrame: id => frames.delete(id) });
  let props = { active: true, threadId: 't', rows: [row(100)], startRef: 100, hasOlder: true, onOlder: async () => {},
    onPosition() {}, onVisibleRef() {}, text: '', onText() {}, onSend() {}, receipts: [], interactions: [], answers: {},
    onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false }, root;
  await act(async () => { root = create(React.createElement(ChatTimeline, props), { createNodeMock: node => node.type === 'FlashList' ? { scrollToOffset: params => scrolls.push(params) } : null }); });
  const list = () => root.root.findByType('FlashList').props;
  const item = (value, target = 'Cell') => list().renderItem({ item: value, target });
  return { root, list, item, scrolls, lifecycle,
    async pull() { await act(async () => {
      list().onScrollBeginDrag();
      list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: -80 }, velocity: { y: 0 } } });
      await list().refreshControl.props.onRefresh();
    }); },
    async update(values) { props = { ...props, ...values }; await act(async () => root.update(React.createElement(ChatTimeline, props))); },
    async mountRow(value) { let rendered; await act(async () => { rendered = create(item(value)); }); return rendered; },
    async flush() { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }); },
    async app(state) { await act(async () => callbacks.app(state)); },
    async reduce(value) { await act(async () => callbacks.reduce(value)); },
    async close() { await act(async () => root.unmount()); }
  };
}

test('only newly prepended history cells get entrance; old rows, measurement and initial content do not', async () => {
  const h = await harness();
  assert.equal(h.item(row(100)).props.animateHistory, false);
  await h.pull(); await h.update({ rows: [row(70), row(80), row(90), row(100)], startRef: 70 });
  assert.equal(h.item(row(70)).props.animateHistory, true);
  assert.equal(h.item(row(80)).props.animateHistory, true);
  assert.equal(h.item(row(100)).props.animateHistory, false);
  assert.equal(h.item(row(70), 'Measurement').props.animateHistory, false);
  assert.equal(h.item(row(70), 'StickyHeader').props.animateHistory, false);
  assert.equal(h.list().CellRendererComponent, undefined);
  assert.equal(h.list().maintainVisibleContentPosition.disabled, false);
  assert.doesNotMatch(source, /prepareForLayoutAnimationRender|LayoutAnimation\.configureNext|FadeInDown|FadeInUp|\.springify\(/);
  await h.flush(); assert.equal(h.scrolls.length, 0);
  await h.close();
});

test('actual installed FadeIn preset only interpolates opacity for 220ms, with system reduced motion', async () => {
  const h = await harness(); await h.pull(); await h.update({ rows: [row(90), row(100)], startRef: 90 });
  const rendered = await h.mountRow(row(90));
  const animation = rendered.root.findByType('HistoryAnimatedView').props.entering;
  assert.equal(animation.durationV, 220); assert.equal(animation.reduceMotionV, 'system');
  const config = animation.build()();
  assert.deepEqual(Object.keys(config.initialValues), ['opacity']);
  assert.deepEqual(Object.keys(config.animations), ['opacity']);
  assert.equal(config.initialValues.opacity, 0); assert.equal(config.animations.opacity.target, 1);
  assert.equal(config.animations.opacity.config.duration, 220);
  await act(async () => rendered.unmount()); await h.close();
});

test('committed history does not replay on remount and removing entrance flag does not remount message content', async () => {
  const h = await harness(); await h.pull(); await h.update({ rows: [row(90), row(100)], startRef: 90 });
  const rendered = await h.mountRow(row(90));
  const view = rendered.root.findByType('HistoryAnimatedView'), animation = view.props.entering;
  assert.ok(animation); assert.equal(h.lifecycle.contentMounts, 1);
  assert.equal(h.item(row(90)).props.animateHistory, false, 'committed row consumed the pending entrance');
  await act(async () => rendered.update(h.item(row(90))));
  assert.equal(rendered.root.findByType('HistoryAnimatedView'), view, 'same root native element shape retained');
  assert.equal(view.props.entering, animation, 'native entering config stays stable until unmount');
  assert.equal(h.lifecycle.contentMounts, 1);
  await act(async () => rendered.unmount());
  const remounted = await h.mountRow(row(90));
  assert.equal(remounted.root.findByType('HistoryAnimatedView').props.entering, undefined);
  await act(async () => remounted.unmount()); await h.close();
});

test('user bubble gets one root fade, system notice accessibility and original styles remain intact', async () => {
  const h = await harness(); await h.pull();
  const user = row(80, 'user'), notice = { ...row(90, 'system'), displayKind: 'system_notice' };
  await h.update({ rows: [user, notice, row(100)], startRef: 80 });
  const userView = await h.mountRow(user);
  assert.equal(userView.root.findAllByType('HistoryAnimatedView').filter(node => node.props.entering).length, 1);
  const systemView = await h.mountRow(notice);
  const system = systemView.root.findByType('HistoryAnimatedView');
  assert.equal(system.props.accessible, true); assert.match(system.props.accessibilityLabel, /^System notice:/);
  assert.equal(system.props.style.marginVertical, 5);
  await act(async () => { userView.unmount(); systemView.unmount(); }); await h.close();
});

test('append, in-place Markdown height/text updates, and non-history prepends do not animate existing rows', async () => {
  const h = await harness();
  await h.update({ rows: [row(90), row(100)], startRef: 90 });
  assert.equal(h.item(row(90)).props.animateHistory, false);
  await h.pull(); await h.update({ rows: [row(80), row(90), row(100)], startRef: 80 });
  assert.equal(h.item(row(80)).props.animateHistory, true);
  await h.update({ rows: [row(80), row(90), { ...row(100), text: '# Markdown\n' + 'long line\n'.repeat(200) }, row(110)] });
  assert.equal(h.item(row(80)).props.animateHistory, false);
  assert.equal(h.item(row(110)).props.animateHistory, false);
  await h.flush(); assert.equal(h.scrolls.length, 0);
  await h.close();
});

test('reduced motion and background/blur prevent pending entrance, new deliberate drag drops unread animation flags', async () => {
  const reduced = await harness({ reduced: true }); await reduced.pull();
  await reduced.update({ rows: [row(90), row(100)], startRef: 90 });
  assert.equal(reduced.item(row(90)).props.animateHistory, false); await reduced.close();
  const h = await harness(); await h.pull(); await h.update({ rows: [row(90), row(100)], startRef: 90 });
  assert.equal(h.item(row(90)).props.animateHistory, true);
  await h.app('background'); assert.equal(h.item(row(90)).props.animateHistory, false);
  await h.update({ rows: [row(80), row(90), row(100)], startRef: 80 });
  assert.equal(h.item(row(80)).props.animateHistory, false);
  await h.app('active'); await h.pull(); await h.update({ rows: [row(70), row(80), row(90), row(100)], startRef: 70 });
  assert.equal(h.item(row(70)).props.animateHistory, true);
  await act(async () => h.list().onScrollBeginDrag());
  assert.equal(h.item(row(70)).props.animateHistory, false);
  await h.update({ active: false, rows: [row(60), row(70), row(80), row(90), row(100)], startRef: 60 });
  assert.equal(h.item(row(60)).props.animateHistory, false);
  await h.close();
});
