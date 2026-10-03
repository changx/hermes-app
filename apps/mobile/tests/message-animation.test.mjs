import test from 'node:test';
import * as failedMessageActions from '../src/failedMessageActions.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as historyLayout from '../src/historyLayout.ts';
import * as messageTime from '../src/messageTime.ts';
import { hasRunningReceipt } from '../src/receiptState.ts';

// Invoke the production component and its real event callbacks. React/RN are
// stubbed; this does not measure UIKit animation frames or run on a device.
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const timeline = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/timeline.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: timeline, exports: timeline.exports, require: name => name === './messageTime.ts' ? messageTime : assert.fail(name) });

function mount({ rows = ['a'], position, motion = false, keyboard = false, scale = 1, fontScale = 1, platform = 'ios' } = {}) {
  const calls = [], frames = [], hooks = [], subscriptions = {}, effects = [];
  let index = 0, flatList, sticky, input, field, tree, keyboardHandler, visible = keyboard;
  const list = { getScrollResponder: () => ({ scrollToEnd: options => calls.push({ animated: options.animated }) }), scrollToOffset: options => calls.push({ fallback: { offset: options.offset, animated: options.animated } }) };
  const ref = { current: null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: fn => fn, memo: fn => fn,
    useRef: initial => { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useState: initial => { const slot = index++; hooks[slot] ??= { current: typeof initial === 'function' ? initial() : initial }; return [hooks[slot].current, value => { hooks[slot].current = value; }]; },
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
    FlatList: 'FlatList', Keyboard: { isVisible: () => visible }, Platform: { OS: platform }, useWindowDimensions: () => ({ fontScale }),
    Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: styles => styles },
    Text: 'Text', TextInput: 'TextInput', View: 'View'
  };
  const modules = {
    react: { ...react, default: react }, 'react-native': native,
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    './FontSize': { Text: native.Text, TextInput: native.TextInput, useFontSize: () => ({ scale }) },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler: handlers => { keyboardHandler = handlers; } },
    'react-native-reanimated': { View: 'View', FadeIn: { duration: duration => ({ reduceMotion: reduceMotion => ({ duration, reduceMotion }) }) }, ReduceMotion: { System: 'system' }, runOnJS: fn => fn, useSharedValue: value => { const slot = index++; return hooks[slot] ??= { value }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    './failedMessageActions': failedMessageActions, './historyLayout': historyLayout, '@shopify/flash-list': { FlashList: 'FlatList' }, './timeline': timeline.exports, './send': { sendDescription: () => '' }, './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' }, './messageMarkdown': { messageNeedsViewport: () => false },
    './receiptState': { hasRunningReceipt }
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
      requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: () => {} });
  const props = {
    active: true, threadId: 'th', rows: rows.map(row => typeof row === 'string' ? { key: row, role: 'user', text: row } : row), startRef: null, hasOlder: false,
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
    tree = output.exports.ChatTimeline(props, ref);
    flatList = find(tree, 'FlatList').props;
    sticky = find(tree, 'KeyboardStickyView').props;
    input = find(tree, 'TextInput').props;
    const findField = node => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) return node.map(findField).find(Boolean) ?? null;
      return node.type === 'Pressable' && node.props.children?.some(child => child?.props?.nativeID === input.nativeID)
        ? node.props : findField(node.props?.children);
    };
    field = findField(tree);
    while (effects.length) effects.shift()();
  };
  render();
  // React applies the FlatList ref during commit.
  flatList.ref.current = list;
  const flush = () => { while (frames.length) frames.shift()(); };
  return {
    calls, ref, get flatList() { return flatList; }, get sticky() { return sticky; }, get input() { return input; }, get field() { return field; }, get tree() { return tree; }, flush,
    draft(text, onText) { props.text = text; props.onText = onText; render(); },
    content: height => flatList.onContentSizeChange(0, height),
    layout: height => flatList.onLayout({ nativeEvent: { layout: { height } } }),
    dock: height => sticky.onLayout({ nativeEvent: { layout: { height } } }),
    append: key => { props.rows = [...props.rows, { key, role: 'user', text: key }]; render(); },
    rows: next => { props.rows = next; render(); },
    active: value => { props.active = value; render(); },
    rerender: () => render(),
    keyboard: moving => { if (moving) keyboardHandler.onStart(); else keyboardHandler.onEnd(); },
    interactive: () => keyboardHandler.onInteractive(),
    visible: value => { visible = value; }, motion: value => subscriptions.motion(value), app: state => subscriptions.app(state)
  };
}

test('composer centers a content-sized native input inside its bordered shell', () => {
  for (const scale of [1, 1.1, 1.15, 1.3]) for (const fontScale of [1, 1.5, 2]) {
    const h = mount({ scale, fontScale });
    const style = () => h.input.style;
    const empty = style();
    assert.equal(empty.fontSize, undefined, 'keep the existing platform font baseline');
    assert.equal(empty.lineHeight, undefined);
    assert.equal(empty.includeFontPadding, undefined);
    assert.equal(empty.textAlignVertical, undefined);
    assert.equal(empty.height, undefined);
    assert.equal(empty.minHeight, undefined);
    assert.equal(empty.flex, undefined, 'input must not fill the shell vertically');
    assert.equal(empty.padding, 0);
    assert.equal(empty.borderWidth, undefined);
    assert.equal(h.field.style.minHeight, 42);
    assert.equal(h.field.style.height, undefined, 'large native fonts can grow the shell');
    assert.equal(h.field.style.justifyContent, 'center');
    assert.equal(h.field.style.borderWidth, 1);
    assert.equal(h.field.style.paddingVertical, 8);
    assert.equal(empty.maxHeight + 2 * h.field.style.paddingVertical + 2 * h.field.style.borderWidth, 120);
    assert.equal(h.field.style.maxHeight, 120);
    assert.equal(h.input.numberOfLines, 1);
    assert.equal(h.input.placeholder, 'Message…');
    h.draft('first line\nsecond line', () => {});
    assert.equal(style().height, undefined);
    assert.equal(style().lineHeight, undefined);
    assert.equal(style().includeFontPadding, undefined);
    assert.equal(style().textAlignVertical, undefined);
    assert.equal(style().padding, 0);
    assert.equal(style().maxHeight, 102);
    assert.equal(h.input.numberOfLines, undefined);
    assert.notEqual(h.input.scrollEnabled, false, 'long content retains native scrolling');
    assert.equal(h.input.multiline, true);
    h.draft('', () => {});
    assert.deepEqual(style(), empty);
    assert.equal(h.input.numberOfLines, 1);
  }
});

test('composer shell whitespace focuses the same input without becoming an accessibility group', () => {
  const h = mount(); let focused = 0, changed;
  h.input.ref.current = { focus: () => { focused++; } };
  const ref = h.input.ref;
  h.field.onPress();
  assert.equal(focused, 1);
  assert.equal(h.field.accessible, false);
  assert.equal(h.field.focusable, false);
  assert.equal(h.field.onStartShouldSetResponderCapture, undefined, 'do not intercept native selection touches');
  assert.equal(h.input.accessibilityLabel, 'Message text');
  assert.equal(h.input.underlineColorAndroid, 'transparent');
  h.draft('draft', value => { changed = value; });
  h.input.onChangeText('draft\nnext');
  assert.equal(changed, 'draft\nnext');
  assert.equal(h.input.ref, ref);
  h.field.onPress();
  assert.equal(focused, 2);
  assert.deepEqual(h.calls, [], 'focus does not send or force timeline scrolling');
  h.input.ref.current = null;
  assert.doesNotThrow(() => h.field.onPress());
});

test('Android composer leaves line count and height native through edit and clear', () => {
  const h = mount({ platform: 'android' });
  for (const text of ['', 'first\nsecond', '', 'next']) {
    h.draft(text, () => {});
    assert.equal(h.input.numberOfLines, undefined, 'do not fix Android EditText lines');
    assert.equal(h.input.style.height, undefined);
    assert.equal(h.input.multiline, true);
    assert.equal(h.input.style.maxHeight, 102);
    assert.equal(h.field.style.justifyContent, 'center');
  }
});

test('transparent latest row overlaps by its measured height and resets when hidden', () => {
  const h = mount();
  h.layout(500); h.content(1600); h.flush(); h.calls.length = 0;
  assert.equal(h.sticky.style.marginTop, 0);
  h.ref.current.holdPosition(); h.rerender();
  for (const height of [54, 82]) {
    h.sticky.children[0].props.onLayout({ nativeEvent: { layout: { height } } });
    h.rerender(); h.flush();
    assert.equal(h.sticky.style.marginTop, -height);
    assert.equal(h.sticky.pointerEvents, 'box-none');
    assert.equal(h.sticky.children[0].props.pointerEvents, 'box-none');
    assert.deepEqual(h.calls, [], 'row measurement must preserve the reading position');
  }
  h.ref.current.followLatest(); h.rerender();
  assert.equal(h.sticky.style.marginTop, 0);
});

test('latest button follows the shared dock, preserves reading on resize and restores following on tap', () => {
  const h = mount();
  const latest = node => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(latest).find(Boolean) ?? null;
    return node.props?.accessibilityLabel === 'Jump to latest ↓' ? node : latest(node.props?.children);
  };
  h.layout(500); h.content(1600); h.flush(); h.calls.length = 0;
  assert.equal(latest(h.tree), null);
  h.ref.current.holdPosition(); h.rerender();
  assert.ok(latest(h.tree));
  h.dock(120); h.dock(200); h.layout(420); h.flush();
  assert.deepEqual(h.calls, [], 'composer/button resizing cannot force a reader to latest');
  h.keyboard(true); h.rerender();
  assert.ok(latest(h.tree), 'button remains available during keyboard movement');
  latest(h.tree).props.onPress(); h.rerender(); h.flush();
  assert.equal(latest(h.tree), null);
  assert.deepEqual(h.calls, [], 'tap respects the existing moving-keyboard scheduler');
  h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.dock(80); h.layout(540); h.flush();
  assert.equal(latest(h.tree), null);
  assert.ok(h.calls.length > 1, 'removing button row reuses dock geometry correction');
});

const user = key => ({ key, role: 'user', text: key });
const agent = (key, text = '', toolCalls) => ({ key, role: 'assistant', text, toolCalls });

test('empty composer explicitly shrinks after long send without replacing the native input', () => {
  const h = mount({ keyboard: true });
  const style = () => h.input.style;
  h.draft('long line\n'.repeat(80), () => {});
  const nativeID = h.input.nativeID, key = h.input.key;
  assert.equal(style().maxHeight, 102);
  assert.equal(style().height, undefined, 'nonempty input retains native auto sizing');
  h.draft('', () => {});
  assert.equal(style().height, undefined, 'empty font height remains native');
  assert.equal(h.input.numberOfLines, 1, 'cleared text explicitly restores one-line native measurement');
  h.dock(150); h.rerender();
  assert.equal(h.input.numberOfLines, 1, 'late old dock measurement cannot remove the empty line constraint');
  assert.equal(h.input.nativeID, nativeID); assert.equal(h.input.key, key);
  assert.equal(h.input.multiline, true);
  h.draft('new draft', () => {});
  assert.equal(style().height, undefined, 'new typing restores native multiline growth');
  assert.equal(h.input.numberOfLines, undefined);
  assert.equal(h.input.nativeID, nativeID); assert.equal(h.input.key, key);
  h.draft('   ', () => {});
  assert.equal(style().height, undefined, 'whitespace is still an unsent draft');
  assert.equal(h.input.numberOfLines, undefined);
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
  assert.equal(h.flatList.contentContainerStyle.paddingBottom, 96);
});

test('new Agent output follows without animating the whole timeline', () => {
  const h = mount({ rows: [user('old'), user('recent')] });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello')]); // fixed-count latest page
  h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello again')]);
  h.flush(); // no onContentSizeChange (same rendered height)
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.calls.length = 0;
  h.rows([user('recent'), agent('reply', 'Hello again', [{ id: 'tool-1', name: 'web_search', label: '搜索' }])]);
  h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
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
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.content(1150); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: false }, 'late geometry correction remains non-animated');
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
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.calls.length = 0;
  h.ref.current.holdPosition();
  h.rows([user('u'), agent('a', 'first'), agent('tool', 'Done', [{ id: 'call', name: 'web_search', label: '搜索' }])]);
  h.content(1120); h.flush();
  assert.deepEqual(h.calls, [], 'reader position is never forced to latest');
});

test('timeline content has real bottom padding without flex filler; native end owns offset', () => {
  const h = mount();
  assert.equal(h.flatList.contentContainerStyle.paddingTop, 12);
  assert.equal(h.flatList.contentContainerStyle.paddingBottom, 96);
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

test('static open keyboard animates explicit latest but not automatic append correction', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.ref.current.followLatest();
  assert.deepEqual(h.calls, [{ animated: true }]);
  h.append('b'); h.content(1100); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: false });
});

test('batched append measurements and dock resize settle without inherited animation', () => {
  const h = mount({ keyboard: true });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.dock(60); h.append('b'); h.content(1000); h.content(1100); h.content(1120); h.dock(90);
  h.flush();
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.content(1140); h.flush();
  assert.deepEqual(h.calls.at(-1), { animated: false });
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
  assert.deepEqual(h.calls, [{ animated: false }]);
  h.calls.length = 0;
  h.keyboard(true); h.ref.current.followLatest(); h.flush();
  assert.equal(h.calls.length, 0);
  h.keyboard(false); h.flush();
  assert.deepEqual(h.calls, [{ animated: true }]);
});

test('losing route focus cancels queued follows and ignores departing native layout events', () => {
  const h = mount({ rows: [user('question')] });
  h.layout(500); h.content(1000); h.flush(); h.calls.length = 0;
  h.rows([user('question'), agent('answer', 'Answer')]);
  h.active(false);
  h.content(1100); h.layout(480); h.dock(120); h.flush();
  h.ref.current.followLatest();
  assert.deepEqual(h.calls, [], 'a swipe-back transition must not scroll the departing native list');
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
  assert.deepEqual(h.calls, [{ animated: false }]);
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
      draftKey: 'conn:th', composerDrafts: { current: new Map() }, releaseComposerDraft() {}, config: { id: 'conn' }, threadId: 'th', focusedRef: { current: true }, textDrafts: { current: new Map() }, text: 'hello', newSend: (...args) => args, Crypto: { randomUUID: () => 'id' },
      anchor: undefined, timelineRef: h.ref, setText: fn => fn('hello'), attachmentsBusy: false, draftAttachments: [], composerScope: 'conn:th', currentComposer: { current: 'conn:th' }, setAttachmentDraft() {}, setAttachmentClearKey() {} });
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
        draftKey: 'conn:th', composerDrafts: { current: new Map() }, releaseComposerDraft() {}, config: { id: 'conn' }, threadId: 'th', focusedRef: { current: true }, textDrafts: { current: new Map() }, text: original, newSend: (...args) => args, Crypto: { randomUUID: () => 'id' },
        anchor: undefined, timelineRef: h.ref, setText: update => { draft = update(draft); h.draft(draft, () => {}); }, attachmentsBusy: false, draftAttachments: [],
        composerScope: 'conn:th', currentComposer: { current: 'conn:th' }, setAttachmentDraft() {}, setAttachmentClearKey() {} });
    const sending = output.exports.send();
    assert.equal(draft, original, 'never clear before enqueue commits');
    if (scenario === 'edited') { draft = 'new unsent draft'; h.draft(draft, () => {}); }
    if (scenario === 'failed') { fail(new Error('storage')); await assert.rejects(sending, /storage/); }
    else { finish(); await sending; }
    assert.equal(draft, scenario === 'saved' ? '' : scenario === 'edited' ? 'new unsent draft' : original);
    assert.equal(h.input.numberOfLines, scenario === 'saved' ? 1 : undefined);
    assert.equal(h.input.style.height, undefined);
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
