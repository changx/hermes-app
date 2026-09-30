import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { hasRunningReceipt } from '../src/receiptState.ts';

// Execute production routes/components and the pinned controller's arithmetic.
// Native views/hooks are substitutes: these are not UIKit gesture/device tests.
function load(path, modules) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  return exports;
}
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  forwardRef: fn => fn, memo: fn => fn, useCallback: fn => fn, useMemo: fn => fn(),
  useRef: current => ({ current }), useState: value => [value, () => {}],
  useEffect() {}, useImperativeHandle() {},
};
const find = (node, type) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean) ?? null;
  return node.type === type ? node : find(node.props?.children, type);
};
const findByLabel = (node, label) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => findByLabel(child, label)).find(Boolean) ?? null;
  return node.props?.accessibilityLabel === label ? node : findByLabel(node.props?.children, label);
};
function route(id = 't_one') {
  return load('../src/app/threads/[threadId].tsx', {
    react, 'expo-router': { useLocalSearchParams: () => ({ threadId: id }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../App': { Notice: 'Notice', ThreadScreen: 'ThreadScreen' },
    '../../routeId': { routeId: value => value === 't_one' ? value : null },
  }).default();
}
function timeline(bottom = 34, os = 'ios', receipts = []) {
  const tree = load('../src/ChatTimeline.tsx', {
    react,
    'react-native': { FlatList: 'FlatList', ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable',
      Platform: { OS: os }, StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ fontScale: 1 }) },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    './FontSize': { Text: 'Text', TextInput: 'TextInput', useFontSize: () => ({ scale: 1 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom }) },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView',
      KeyboardStickyView: 'KeyboardStickyView', KeyboardGestureArea: 'KeyboardGestureArea', useKeyboardHandler() {} },
    'react-native-reanimated': { useSharedValue: value => ({ value }), runOnJS: fn => fn },
    '@shopify/flash-list': { FlashList: 'FlatList' }, './timeline': {}, './MessageContent': {}, './MessageTime': {}, './messageMarkdown': {}, './receiptState': { hasRunningReceipt },
  }).ChatTimeline({ threadId: 't_one', rows: [], text: '', receipts, interactions: [], answers: {} }, {});
  const list = find(tree, 'FlatList').props;
  return { tree, list, scroll: list.renderScrollComponent(list), sticky: find(tree, 'KeyboardStickyView').props };
}

test('stop control disappears when processing is terminal despite stale running lifecycle', () => {
  const receipt = { id: 'r', client_message_id: 'c', thread_id: 't_one', state: 'running', durable: true };
  assert.ok(findByLabel(timeline(34, 'ios', [receipt]).tree, 'Stop'));
  assert.ok(findByLabel(timeline(34, 'ios', [{ ...receipt, processing: 'running' }]).tree, 'Stop'));
  for (const processing of ['completed', 'failed', 'interrupted', 'unknown']) {
    assert.equal(findByLabel(timeline(34, 'ios', [{ ...receipt, processing }]).tree, 'Stop'), null);
  }
  assert.equal(findByLabel(timeline(34, 'ios', [{ ...receipt, thread_id: 'other' }]).tree, 'Stop'), null);
});

test('thread route owns bottom and landscape safe area, without duplicating native header space', () => {
  const page = route();
  assert.equal(page.type, 'SafeAreaView');
  assert.deepEqual([...page.props.edges].sort(), ['bottom', 'left', 'right']);
  assert.equal(page.props.style.flex, 1);
  const thread = find(page, 'ThreadScreen');
  assert.equal(thread.props.threadId, 't_one');
  assert.equal(thread.props.key, 't_one');
  assert.equal(route('../invalid').type, 'Notice');
});

test('real timeline forwards native dismissal and blank-area touch fix to its scroll component', () => {
  for (const os of ['ios', 'android']) {
    const { tree, list, scroll } = timeline(34, os);
    assert.equal(scroll.type, 'KeyboardChatScrollView');
    assert.equal(scroll.props.applyWorkaroundForContentInsetHitTestBug, true);
    assert.equal(scroll.props.keyboardDismissMode, os === 'ios' ? 'interactive' : 'on-drag');
    assert.equal(scroll.props.alwaysBounceVertical, os === 'ios');
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'always');
    assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
    assert.equal(scroll.props.contentInsetAdjustmentBehavior, 'never');
    assert.notEqual(scroll.props.automaticallyAdjustKeyboardInsets, true);
    assert.equal(scroll.props.keyboardLiftBehavior, 'whenAtEnd');
    assert.equal(list.contentContainerStyle.flexGrow, undefined);
    assert.equal(list.contentContainerStyle.paddingBottom, 96);
    assert.equal(find(tree, 'KeyboardGestureArea').props.textInputNativeID, find(tree, 'TextInput').props.nativeID);
    assert.equal(find(tree, 'KeyboardAvoidingView'), null);
  }
});

test('route safe area and real sticky interpolation align dock above keyboard throughout open/close', () => {
  for (const bottom of [0, 21, 34]) {
    const { sticky, scroll } = timeline(bottom);
    const page = route();
    const safePadding = page.props.edges?.includes('bottom') ? bottom : 0;
    for (const keyboardHeight of [300, 350, 420]) {
      for (const progress of [0, 0.25, 0.5, 1, 0.5, 0]) {
        const Sticky = load('../node_modules/react-native-keyboard-controller/src/components/KeyboardStickyView/index.tsx', {
          react, '../../hooks': { useReanimatedKeyboardAnimation: () => ({ height: { value: -keyboardHeight * progress }, progress: { value: progress } }) },
          'react-native-reanimated': { View: 'AnimatedView', useAnimatedStyle: fn => fn(),
            interpolate: (p, _, [closed, opened]) => closed + (opened - closed) * p },
        }).default;
        const translation = Sticky(sticky, {}).props.style[1].transform[0].translateY;
        const screenBottom = 900;
        const dockBottom = screenBottom - safePadding + translation;
        const expected = screenBottom - keyboardHeight * progress - bottom * (1 - progress);
        assert.equal(dockBottom, expected, 'no safe-area-sized overlap with the keyboard');
        assert.equal(scroll.props.offset, bottom, 'list and dock share the same bottom correction');
      }
    }
  }
});

test('short/near-full/long content fits above the moving dock with current list offset', () => {
  const { clampedScrollTarget } = load('../node_modules/react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard/helpers.ts', {
    'react-native-reanimated': {},
  });
  for (const bottom of [0, 21, 34]) {
    const { scroll } = timeline(bottom);
    for (const dock of [60, 130, 220]) {
      const viewport = 900 - 100 - bottom - dock;
      for (const content of [48, 100, 220, 500, 1700]) {
        const start = Math.max(0, content - viewport);
        for (const keyboard of [0, 120, 330]) {
          const inset = Math.max(0, keyboard - scroll.props.offset);
          const target = clampedScrollTarget(start, inset, content, viewport);
          assert.equal(target, Math.max(0, content + inset - viewport));
          assert.ok(content - target <= viewport - inset);
        }
      }
    }
  }
});
