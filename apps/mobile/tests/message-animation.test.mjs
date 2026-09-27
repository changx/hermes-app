import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Invoke the production component and its real event callbacks. React/RN are
// stubbed; this does not measure UIKit animation frames or run on a device.
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const timeline = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/timeline.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: timeline, exports: timeline.exports });

function mount({ rows = ['a'], position, motion = false, keyboard = false } = {}) {
  const calls = [], frames = [], hooks = [], subscriptions = {};
  let index = 0, flatList, sticky, keyboardHandler, visible = keyboard;
  const list = { getScrollResponder: () => ({ scrollToEnd: options => calls.push({ animated: options.animated }) }), scrollToOffset: options => calls.push({ fallback: { offset: options.offset, animated: options.animated } }) };
  const ref = { current: null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: fn => fn, memo: fn => fn,
    useRef: initial => { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useState: initial => { const slot = index++; hooks[slot] ??= { current: initial }; return [hooks[slot].current, value => { hooks[slot].current = value; }]; },
    useCallback: fn => { index++; return fn; },
    useEffect: fn => { const slot = index++; if (!hooks[slot]) { hooks[slot] = true; fn(); } },
    useImperativeHandle: (target, create) => { index++; target.current = create(); }
  };
  const native = {
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(motion), addEventListener: (_, fn) => { subscriptions.motion = fn; return { remove() {} }; } },
    AppState: { addEventListener: (_, fn) => { subscriptions.app = fn; return { remove() {} }; } },
    FlatList: 'FlatList', Keyboard: { isVisible: () => visible }, Platform: { OS: 'ios' },
    Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: styles => styles },
    Text: 'Text', TextInput: 'TextInput', View: 'View'
  };
  const modules = {
    react: { ...react, default: react }, 'react-native': native,
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler: handlers => { keyboardHandler = handlers; } },
    'react-native-reanimated': { runOnJS: fn => fn, useSharedValue: value => { const slot = index++; return hooks[slot] ??= { value }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    './timeline': timeline.exports, './send': { sendDescription: () => '' }, './MessageContent': { MessageContent: 'MessageContent' }, './messageMarkdown': { messageNeedsViewport: () => false }
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
      requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: () => {} });
  const props = {
    threadId: 'th', rows: rows.map(key => ({ key, role: 'user', text: key })), startRef: null, hasOlder: false,
    onOlder() {}, onPosition() {}, onVisibleRef() {}, text: '', onText() {}, onSend() {}, records: [], receipts: [], interactions: [], answers: {},
    onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false, position
  };
  const find = (node, type) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean) ?? null;
    return node.type === type ? node : find(node.props?.children, type);
  };
  const render = () => {
    index = 0;
    const tree = output.exports.ChatTimeline(props, ref);
    flatList = find(tree, 'FlatList').props;
    sticky = find(tree, 'KeyboardStickyView').props;
  };
  render();
  // React applies the FlatList ref during commit.
  hooks.find(h => h && h.current === null && h !== ref).current = list;
  const flush = () => { while (frames.length) frames.shift()(); };
  return {
    calls, ref, get flatList() { return flatList; }, flush,
    content: height => flatList.onContentSizeChange(0, height),
    layout: height => flatList.onLayout({ nativeEvent: { layout: { height } } }),
    dock: height => sticky.onLayout({ nativeEvent: { layout: { height } } }),
    append: key => { props.rows = [...props.rows, { key, role: 'user', text: key }]; render(); },
    keyboard: moving => { if (moving) keyboardHandler.onStart(); else keyboardHandler.onEnd(); },
    interactive: () => keyboardHandler.onInteractive(),
    visible: value => { visible = value; }, motion: value => subscriptions.motion(value), app: state => subscriptions.app(state)
  };
}

test('static open keyboard permits native animated send/latest and actual append', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.ref.current.followLatest();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.append('b'); h.content(1100); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: true });
});

test('batched append measurements and dock resize never override queued or active animation', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.dock(60); h.append('b'); h.content(1000); h.content(1100); h.content(1120); h.dock(90);
  h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.content(1140); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: true });
  h.flatList.onMomentumScrollEnd();
  h.content(1160); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: false });
});

test('moving keyboard defers append and explicit latest until end, not while moving', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.keyboard(true); h.interactive(); h.append('b'); h.content(1100); h.flush();
  assert.equal(h.calls.length, 0);
  h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.calls.length = 0;
  h.keyboard(true); h.ref.current.followLatest(); h.flush();
  assert.equal(h.calls.length, 0);
  h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
});

test('keyboard geometry alone never issues a competing scroll; reader cancels deferred follow', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.keyboard(true); h.content(1010); h.dock(60); h.dock(90); h.flush(); h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, []);
  h.keyboard(true); h.append('b'); h.content(1100); h.flush();
  h.ref.current.holdPosition(); h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, []);
});

test('user drag cancels an in-flight follow and retains reader mode', () => {
  const h = mount();
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.append('b'); h.content(1100); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.flatList.onScroll({ nativeEvent: { contentOffset: { y: 600 }, contentSize: { height: 1100 }, layoutMeasurement: { height: 500 }, contentInset: { bottom: 0 } } });
  h.flatList.onScrollBeginDrag();
  h.flatList.onScroll({ nativeEvent: { contentOffset: { y: 550 }, contentSize: { height: 1100 }, layoutMeasurement: { height: 500 }, contentInset: { bottom: 0 } } });
  h.content(1200); h.flush();
  assert.equal(h.calls.length, 1);
  h.flatList.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } });
  h.append('c'); h.content(1300); h.flush();
  assert.equal(h.calls.length, 1);
});

test('App send invokes the production animated follow handle after enqueue', async () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const snippet = appSource.slice(appSource.indexOf('  const send = () => run(async () => {'), appSource.indexOf('  const answer = (item:', appSource.indexOf('  const send = () => run(async () => {')));
  assert.ok(snippet.includes('await box.enqueue('), 'execute the production send callback');
  const send = { exports: {} }, enqueued = [];
  runInNewContext(ts.transpileModule(snippet + '\nexports.send = send;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: send.exports, run: callback => callback(), outboxRef: { current: { storage: { connectionId: 'conn' }, enqueue: async record => { enqueued.push(record); } } },
      config: { id: 'conn' }, threadId: 'th', text: 'hello', newSend: (...args) => args, Crypto: { randomUUID: () => 'id' },
      timelineRef: h.ref, setText: fn => fn('hello') });
  await send.exports.send();
  assert.equal(enqueued.length, 1);
  assert.deepEqual(h.calls, [{ animated: true }]);
});

test('initial/restored follows do not animate; reader and reduced motion prevent append follow', () => {
  const h = mount({ position: { following: true, offset: 0, startRef: null }, keyboard: true });
  h.layout(500); h.content(1000); h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.ref.current.holdPosition(); h.append('b'); h.content(1100); h.flush();
  assert.equal(h.calls.length, 1);
  const restored = mount({ position: { following: false, offset: 240, startRef: 1 } });
  restored.layout(500); restored.content(1000); restored.flush();
  assert.deepEqual(restored.calls, [{ fallback: { offset: 240, animated: false } }]);
  const reduced = mount();
  reduced.layout(500); reduced.content(1000); reduced.flush(); reduced.calls.length = 0;
  reduced.motion(true); reduced.append('b'); reduced.content(1100); reduced.flush();
  assert.deepEqual(reduced.calls, [{ animated: false }]);
});
