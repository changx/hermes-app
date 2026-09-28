import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as messageTime from '../src/messageTime.ts';

// Invoke the production component and its real event callbacks. React/RN are
// stubbed; this does not measure UIKit animation frames or run on a device.
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const timeline = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/timeline.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: timeline, exports: timeline.exports, require: name => name === './messageTime.ts' ? messageTime : assert.fail(name) });

function mount({ rows = ['a'], position, motion = false, keyboard = false } = {}) {
  const calls = [], frames = [], hooks = [], subscriptions = {}, effects = [];
  let index = 0, flatList, sticky, input, keyboardHandler, visible = keyboard;
  const list = { getScrollResponder: () => ({ scrollToEnd: options => calls.push({ animated: options.animated }) }), scrollToOffset: options => calls.push({ fallback: { offset: options.offset, animated: options.animated } }) };
  const ref = { current: null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: fn => fn, memo: fn => fn,
    useRef: initial => { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useState: initial => { const slot = index++; hooks[slot] ??= { current: initial }; return [hooks[slot].current, value => { hooks[slot].current = value; }]; },
    useCallback: fn => { index++; return fn; },
    useEffect: (fn, deps) => {
      const slot = index++;
      const previous = hooks[slot]?.deps;
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) {
        hooks[slot] = { deps };
        effects.push(fn);
      }
    },
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
    './FontSize': { Text: native.Text, TextInput: native.TextInput },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler: handlers => { keyboardHandler = handlers; } },
    'react-native-reanimated': { runOnJS: fn => fn, useSharedValue: value => { const slot = index++; return hooks[slot] ??= { value }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    './timeline': timeline.exports, './send': { sendDescription: () => '' }, './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' }, './messageMarkdown': { messageNeedsViewport: () => false }
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
      requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: () => {} });
  const props = {
    threadId: 'th', rows: rows.map(row => typeof row === 'string' ? { key: row, role: 'user', text: row } : row), startRef: null, hasOlder: false,
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
    input = find(tree, 'TextInput').props;
    while (effects.length) effects.shift()();
  };
  render();
  // React applies the FlatList ref during commit.
  flatList.ref.current = list;
  const flush = () => { while (frames.length) frames.shift()(); };
  return {
    calls, ref, get flatList() { return flatList; }, get input() { return input; }, flush,
    draft(text, onText) { props.text = text; props.onText = onText; render(); },
    content: height => flatList.onContentSizeChange(0, height),
    layout: height => flatList.onLayout({ nativeEvent: { layout: { height } } }),
    dock: height => sticky.onLayout({ nativeEvent: { layout: { height } } }),
    append: key => { props.rows = [...props.rows, { key, role: 'user', text: key }]; render(); },
    rows: next => { props.rows = next; render(); },
    rerender: () => render(),
    keyboard: moving => { if (moving) keyboardHandler.onStart(); else keyboardHandler.onEnd(); },
    interactive: () => keyboardHandler.onInteractive(),
    visible: value => { visible = value; }, motion: value => subscriptions.motion(value), app: state => subscriptions.app(state)
  };
}

const user = key => ({ key, role: 'user', text: key });
const agent = (key, text = '', toolCalls) => ({ key, role: 'assistant', text, toolCalls });

test('empty composer explicitly shrinks after long send without replacing the native input', () => {
  const h = mount({ keyboard: true });
  const style = () => Object.assign({}, ...h.input.style.filter(Boolean));
  h.draft('long line\n'.repeat(80), () => {});
  const nativeID = h.input.nativeID, key = h.input.key;
  assert.equal(style().maxHeight, 120);
  assert.equal(style().height, undefined, 'nonempty input retains native auto sizing');
  h.draft('', () => {});
  assert.equal(style().height, 42, 'cleared text must explicitly restore one line');
  h.dock(150); h.rerender();
  assert.equal(style().height, 42, 'late old dock measurement cannot stretch the empty input');
  assert.equal(h.input.nativeID, nativeID); assert.equal(h.input.key, key);
  assert.equal(h.input.multiline, true);
  h.draft('new draft', () => {});
  assert.equal(style().height, undefined, 'new typing restores native multiline growth');
  assert.equal(h.input.nativeID, nativeID); assert.equal(h.input.key, key);
  h.draft('   ', () => {});
  assert.equal(style().height, undefined, 'whitespace is still an unsent draft');
});

test('clipboard text replaces composer selection without sending or scrolling', () => {
  const h = mount({ keyboard: true }); let draft;
  h.draft('hello world', value => { draft = value; });
  h.input.onSelectionChange({ nativeEvent: { selection: { start: 6, end: 11 } } });
  h.ref.current.pasteText('Jamie'); assert.equal(draft, 'hello Jamie');
  h.draft(draft, value => { draft = value; }); h.ref.current.pasteText('!'); assert.equal(draft, 'hello Jamie!');
  assert.deepEqual(h.calls, []);
});

test('text taps keep the composer keyboard, while interactive drag dismissal remains native', () => {
  const h = mount({ keyboard: true });
  assert.equal(h.flatList.keyboardShouldPersistTaps, 'always');
  assert.equal(h.flatList.keyboardDismissMode, 'interactive');
  assert.equal(h.flatList.contentContainerStyle.paddingBottom, 48);
});

test('new Agent output follows with same-height layout and sliding latest window', () => {
  const h = mount({ rows: [user('old'), user('recent')] });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello')]); // fixed-count latest page
  h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello again')]);
  h.flush(); // no onContentSizeChange (same rendered height)
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello again', [{ id: 'tool-1', name: 'web_search', label: '搜索' }])]);
  h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello again', [{ id: 'tool-1', name: 'web_search', label: '搜索' }])]);
  h.rerender(); h.flush();
  assert.deepEqual(h.calls, [], 'a fresh projection with identical output is not a new scroll');
});

test('Agent append follows when onScroll reports the new extent before onContentSizeChange', () => {
  const h = mount({ rows: [user('question')] });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.rows([user('question'), agent('answer', 'Answer')]);
  h.flatList.onScroll({ nativeEvent: { contentOffset: { y: 500 }, contentSize: { height: 1100 }, layoutMeasurement: { height: 500 } } });
  h.content(1100); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.content(1150); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: true }, 'late geometry correction retains animation');
});

test('Agent changes preserve reader and prepend anchors; keyboard movement defers output', () => {
  const h = mount({ rows: [user('u'), agent('a', 'first')] });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.ref.current.holdPosition();
  h.rows([user('older'), user('u'), agent('a', 'first')]); h.content(1050); h.flush();
  assert.deepEqual(h.calls, [], 'prepend is not new Agent output');
  h.ref.current.followLatest(false); h.calls.length = 0;
  h.keyboard(true);
  h.rows([user('u'), agent('a', 'first'), agent('tool', '', [{ id: 'call', name: 'web_search', label: '搜索' }])]);
  h.content(1100); h.flush();
  assert.deepEqual(h.calls, [], 'keyboard moving cannot scroll immediately');
  h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.calls.length = 0;
  h.ref.current.holdPosition();
  h.rows([user('u'), agent('a', 'first'), agent('tool', 'Done', [{ id: 'call', name: 'web_search', label: '搜索' }])]);
  h.content(1120); h.flush();
  assert.deepEqual(h.calls, [], 'reader position is never forced to latest');
});

test('timeline content has real bottom padding without flex filler; native end owns offset', () => {
  const h = mount();
  assert.equal(h.flatList.contentContainerStyle.paddingTop, 12);
  assert.equal(h.flatList.contentContainerStyle.paddingBottom, 48);
  assert.equal(h.flatList.contentContainerStyle.flexGrow, undefined);
  h.layout(500); h.content(1048); h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
});

test('Agent output honors reduced motion and does not animate first restored mount', () => {
  const h = mount({ rows: [agent('history', 'first')] });
  h.layout(500); h.content(1000); h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.calls.length = 0;
  h.motion(true);
  h.rows([agent('history', 'first'), agent('answer', 'next')]); h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
});

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
  h.rows([user('a'), user('b'), user('c'), agent('response', 'Answer')]);
  h.content(1400); h.flush();
  assert.equal(h.calls.length, 1, 'real upscroll keeps reader mode through Agent output');
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
      config: { id: 'conn' }, threadId: 'th', focusedRef: { current: true }, textDrafts: { current: new Map() }, text: 'hello', newSend: (...args) => args, Crypto: { randomUUID: () => 'id' },
      timelineRef: h.ref, setText: fn => fn('hello'), attachmentsBusy: false, draftAttachments: [], composerScope: 'conn:th', currentComposer: { current: 'conn:th' }, setAttachmentDraft() {}, setAttachmentClearKey() {} });
  await send.exports.send();
  assert.equal(enqueued.length, 1);
  assert.deepEqual(h.calls, [{ animated: true }]);
});

test('send clears and shrinks only a durably saved unchanged draft', async () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = appSource.indexOf('  const send = () => run(async () => {');
  const snippet = appSource.slice(start, appSource.indexOf('  const answer = (item:', start));
  for (const scenario of ['saved', 'failed', 'edited']) {
    const h = mount({ keyboard: true });
    const original = 'paragraph\n'.repeat(80); let draft = original;
    h.draft(draft, () => {});
    let finish, fail;
    const gate = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const output = { exports: {} };
    runInNewContext(ts.transpileModule(snippet + '\nexports.send = send;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports: output.exports, run: callback => callback(), outboxRef: { current: { storage: { connectionId: 'conn' }, enqueue: () => gate } },
        config: { id: 'conn' }, threadId: 'th', focusedRef: { current: true }, textDrafts: { current: new Map() }, text: original, newSend: (...args) => args, Crypto: { randomUUID: () => 'id' },
        timelineRef: h.ref, setText: update => { draft = update(draft); h.draft(draft, () => {}); }, attachmentsBusy: false, draftAttachments: [],
        composerScope: 'conn:th', currentComposer: { current: 'conn:th' }, setAttachmentDraft() {}, setAttachmentClearKey() {} });
    const sending = output.exports.send();
    assert.equal(draft, original, 'never clear before enqueue commits');
    if (scenario === 'edited') { draft = 'new unsent draft'; h.draft(draft, () => {}); }
    if (scenario === 'failed') { fail(new Error('storage')); await assert.rejects(sending, /storage/); }
    else { finish(); await sending; }
    assert.equal(draft, scenario === 'saved' ? '' : scenario === 'edited' ? 'new unsent draft' : original);
    const style = Object.assign({}, ...h.input.style.filter(Boolean));
    assert.equal(style.height, scenario === 'saved' ? 42 : undefined);
  }
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
