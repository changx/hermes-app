import test from 'node:test';
import * as workPresentation from '../../../packages/client/src/workPresentation.ts';
import * as failedMessageActions from '../src/failedMessageActions.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as historyLayout from '../src/historyLayout.ts';
import { projectTimeline } from '../src/timeline.ts';

const input = [
  { id: 'a1', ref_seq: 1, role: 'assistant', text: 'Before' },
  { id: 'n1', ref_seq: 2, role: 'system', text: '💾 Self-improvement review: Memory updated', display_kind: 'system_notice', created_at: 12 },
  { id: 'a2', ref_seq: 3, role: 'assistant', text: 'After' },
  { id: 'a3', ref_seq: 4, role: 'assistant', text: 'Continued' },
];

test('system notices keep a distinct timeline kind and split assistant grouping', () => {
  const rows = projectTimeline(input, null, 'thread');
  assert.deepEqual(rows.map(row => row.displayKind), [undefined, 'system_notice', undefined, undefined]);
  assert.deepEqual(rows.map(row => row.continuation), [false, undefined, false, true]);
  assert.equal(rows[1].timestamp, 12);
  assert.equal(rows[1].role, 'system');
});

function loadTimeline() {
  const exports = {};
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: fn => fn, memo: fn => fn, useCallback: fn => fn, useMemo: fn => fn(),
    useRef: current => ({ current }), useState: value => [value, () => {}],
    useEffect() {}, useImperativeHandle() {},
  };
  const modules = {
    '../../../packages/client/src/workPresentation': workPresentation,
    react,
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'react-native': { FlatList: 'FlatList', ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable',
      AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
      AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, StyleSheet: { create: value => value } },
    './FontSize': { Text: 'Text', TextInput: 'TextInput' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardStickyView: 'KeyboardStickyView',
      KeyboardGestureArea: 'KeyboardGestureArea', useKeyboardHandler() {} },
    'react-native-reanimated': { View: 'View', FadeIn: { duration: duration => ({ reduceMotion: reduceMotion => ({ duration, reduceMotion }) }) }, ReduceMotion: { System: 'system' }, useSharedValue: value => ({ value }), runOnJS: fn => fn },
    './failedMessageActions': failedMessageActions, './historyLayout': historyLayout, '@shopify/flash-list': { FlashList: 'FlatList' }, './timeline': { agentOutputAdded: () => false, appendedAtEnd: () => false, scrollStateFromEvent() {}, scrollToExactEnd: () => false, shouldFollowContentChange: () => false },
    './MessageContent': { MessageContent: 'MessageContent' }, './WorkChevron': { WorkChevron: 'WorkChevron' }, './MessageTime': { MessageTime: 'MessageTime' },
    './messageMarkdown': { messageNeedsViewport: () => false }, './receiptState': { hasRunningReceipt: () => false },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: id => modules[id], requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  return exports.ChatTimeline;
}

const find = (node, type) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean) ?? null;
  return node.type === type ? node : find(node.props?.children, type);
};

test('system notice renders as compact plain UI rather than Hermes Markdown', () => {
  const ChatTimeline = loadTimeline();
  const tree = ChatTimeline({ active: true, threadId: 'thread', rows: projectTimeline(input, null, 'thread'), startRef: null,
    hasOlder: false, onOlder() {}, onPosition() {}, onVisibleRef() {}, text: '', onText() {}, onSend() {},
    receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false }, {});
  const list = find(tree, 'FlatList');
  const element = list.props.renderItem({ item: projectTimeline(input, null, 'thread')[1] });
  const notice = find(element.type(element.props), 'View');
  assert.equal(notice.type, 'View');
  assert.equal(notice.props.accessible, true);
  assert.match(notice.props.accessibilityLabel, /^System notice:/);
  assert.equal(find(notice, 'MessageContent'), null);
  assert.ok(find(notice, 'MessageTime'));
});
