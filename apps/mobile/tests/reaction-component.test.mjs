import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { projectTimeline } from '../src/timeline.ts';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';

const native = { Animated: { Text: 'Text', Value: class { constructor(value) { this.value = value; } interpolate({ outputRange }) { return outputRange[this.value]; } }, }, AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' }, StyleSheet: { create: styles => styles } };
for (const key of ['FlatList', 'Image', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View']) native[key] = key;
const react = {
  Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  forwardRef: fn => fn, memo: fn => fn, useRef: current => ({ current }), useState: initial => [initial, () => {}],
  useCallback: fn => fn, useEffect: () => {}, useImperativeHandle: () => {}, useMemo: fn => fn()
};
const modules = {
  react: { ...react, default: react }, 'react-native': native,
  'react-native-keyboard-controller': { KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', KeyboardChatScrollView: 'KeyboardChatScrollView', useKeyboardHandler: () => {} },
  'react-native-reanimated': { runOnJS: fn => fn, useSharedValue: value => ({ value }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  './timeline': { appendedAtEnd: () => false, scrollToExactEnd: () => false, scrollStateFromEvent: () => ({}), shouldFollowContentChange: () => false },
  './MessageContent': { MessageContent: 'MessageContent' }, './messageMarkdown': { parseMessageMarkdown },
  'expo-clipboard': { setStringAsync: async () => {} },
  'expo-video': { VideoView: 'VideoView', useVideoPlayer: () => ({}) },
  'react-native-webview': 'WebView', './markdownWeb': { renderMarkdownHtml: (kind, source) => `${kind}:${source}` }
};
const load = file => { const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  return output.exports;
};
const { ChatTimeline } = load('ChatTimeline.tsx');
const { MessageContent } = load('MessageContent.tsx');
const expand = node => {
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!node || typeof node !== 'object') return [];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return [node, ...expand(node.props?.children)];
};
const named = (nodes, type) => nodes.filter(node => node.type === type);
const text = node => { const all = v => Array.isArray(v) ? v.map(all).join('') : v && typeof v === 'object' ? all(v.props?.children) : String(v ?? ''); return all(node.props.children); };
const msg = { id: 'm', ref_seq: 1, role: 'user', text: 'hello', receipt_id: 'r', client_message_id: 'c' };
const receipt = state => ({ id: 'r', thread_id: 'th', client_message_id: 'c', state, durable: true });
const record = status => ({ connectionId: 'conn', threadId: 'th', clientMessageId: 'c', text: 'hello', status, receiptId: status === 'accepted' ? 'r' : undefined, receiptState: status === 'accepted' ? 'queued' : undefined });
function mount(rows, receipts = [], interactions = [], overrides = {}) {
  const calls = [];
  const props = { threadId: 'th', rows, startRef: 1, hasOlder: false, onOlder() {}, onPosition() {}, onVisibleRef() {},
    text: 'draft', onText: value => calls.push(['text', value]), onSend: () => calls.push(['send']), receipts, interactions, answers: {}, onAnswerText() {}, onAnswer: (item, choice) => calls.push(['answer', item.id, choice]),
    onCancel: item => calls.push(['cancel', item.id]), onStop: () => calls.push(['stop']), busy: false, ...overrides };
  const tree = expand(ChatTimeline(props, null));
  const list = named(tree, 'FlatList')[0];
  const rowTree = expand(list.props.renderItem({ item: rows[0] }));
  return { tree, rowTree, calls };
}
const click = (nodes, label) => { const button = named(nodes, 'Pressable').find(n => n.props.accessibilityLabel === label); assert.ok(button, `missing ${label}`); button.props.onPress(); };

test('assistant fills available width without a bubble; user bubble remains unchanged', () => {
  const rowStyle = role => {
    const rows = projectTimeline([{ ...msg, role }], null, 'th', undefined, true);
    const style = named(mount(rows).rowTree, 'View')[0].props.style;
    return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  };
  const agent = rowStyle('assistant');
  assert.equal(agent.alignSelf, 'stretch');
  assert.equal(agent.marginHorizontal, 14);
  assert.equal(agent.maxWidth, undefined);
  assert.equal(agent.padding, undefined);
  assert.equal(agent.borderWidth, undefined);
  assert.equal(agent.backgroundColor, undefined);
  assert.equal(agent.borderRadius, undefined);
  const user = rowStyle('user');
  assert.equal(user.alignSelf, 'flex-end');
  assert.equal(user.maxWidth, '90%');
  assert.equal(user.padding, 13);
  assert.equal(user.backgroundColor, '#e6f0ff');
  assert.equal(user.borderColor, '#d0e2fb');
  assert.equal(user.borderWidth, 1);
  assert.equal(user.borderRadius, 16);
  assert.equal(user.borderTopRightRadius, 4);
});

test('user and assistant rows render the same complete Markdown and media tree', () => {
  const markdown = '# 标题\n\n**加粗** *斜体* ~~删除~~ [链接](https://example.com)\n\n> 引用\n\n- [x] 任务\n- 普通项\n\n```js\nconst n = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![图片](https://example.com/a.png)\n\n![视频](https://example.com/a.mp4)\n\n前 $x^2$ 后\n\n$$x+y$$\n\n```mermaid\nflowchart LR\nA-->B\n```';
  const signatures = [];
  for (const role of ['user', 'assistant']) {
    const rows = projectTimeline([{ ...msg, role, text: markdown }], null, 'th', undefined, true);
    const content = named(mount(rows).rowTree, 'MessageContent')[0];
    assert.equal(content.props.text, markdown, 'no role-specific stripping');
    const rendered = expand(MessageContent(content.props));
    assert.equal(named(rendered, 'Image').length, 1);
    assert.equal(named(rendered, 'WebView').length, 3);
    assert.ok(named(rendered, 'Pressable').some(n => n.props.accessibilityLabel === '播放视频：视频'));
    assert.ok(named(rendered, 'Pressable').some(n => n.props.accessibilityLabel === '复制代码'));
    assert.ok(rendered.some(n => n.props.accessibilityRole === 'link'));
    assert.ok(rendered.some(n => n.props.accessibilityRole === 'checkbox'));
    assert.ok(named(rendered, 'ScrollView').filter(n => n.props.horizontal).length >= 2);
    const frames = named(rendered, 'View').filter(n => n.props.style?.height === 220);
    assert.equal(frames.length, 2);
    frames.forEach(n => assert.equal(n.props.style.borderWidth, undefined));
    signatures.push(rendered.map(n => String(n.type)));
  }
  assert.deepEqual(signatures[0], signatures[1]);
});

test('real message component renders legible gray text until accepted, then normal even while queued', () => {
  const phases = ['queued', 'sending', 'ambiguous', 'blocked', 'accepted'];
  for (const phase of phases) {
    const rows = projectTimeline([], record(phase), 'th', undefined, true);
    const { rowTree } = mount(rows);
    const content = named(rowTree, 'MessageContent')[0];
    assert.equal(content.props.pending, phase !== 'accepted');
    if (phase === 'accepted') assert.equal(named(rowTree, 'View').some(v => v.props.accessibilityLabel === rows[0].reaction.label), true);
    else assert.equal(rows[0].reaction, undefined);
    assert.equal(named(rowTree, 'Text').some(v => text(v).includes('未发出')), phase === 'blocked');
    const rendered = expand(MessageContent(content.props));
    const paragraph = named(rendered, 'Text').find(n => n.props.selectable && Array.isArray(n.props.style) && n.props.style.some(x => x?.fontSize === 15));
    assert.ok(paragraph);
    const colors = paragraph.props.style.flat().filter(Boolean).map(x => x.color);
    assert.equal(colors.at(-1), phase === 'accepted' ? '#172a40' : '#93a0b0');
  }
  const authoritative = projectTimeline([msg], record('accepted'), 'th', undefined, true);
  assert.equal(authoritative.length, 1);
  assert.equal(named(mount(authoritative).rowTree, 'MessageContent')[0].props.pending, false);
});
test('pill is under corresponding user message with stable footprint; controls remain callbacks, not reaction taps', () => {
  const cache = new Map([['r', receipt('running')]]);
  const interaction = { id: 'ask', kind: 'approval', state: 'pending', thread_id: 'th', receipt_id: 'r', prompt: '允许继续？', choices: ['允许', '拒绝'] };
  const projected = projectTimeline([msg], null, 'th', undefined, true, [], cache, [interaction]);
  const h = mount(projected, [receipt('queued'), receipt('running')], [interaction]);
  const slot = named(h.rowTree, 'View').find(v => v.props.accessibilityLabel === '等待审批');
  assert.ok(slot); assert.equal(slot.props.style.height, 23);
  assert.equal(named(h.rowTree, 'Pressable').length, 0);
  click(h.tree, '停止'); click(h.tree, '允许');
  assert.deepEqual(h.calls, [['stop'], ['answer', 'ask', '允许']]);
  const queued = mount(projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', receipt('queued')]])), [receipt('queued')]);
  click(queued.rowTree, '取消排队');
  assert.deepEqual(queued.calls, [['cancel', 'r']]);
  assert.equal(named(h.tree, 'Pressable').some(n => n.props.accessibilityLabel === '停止当前执行'), false);
  assert.equal(named(h.tree, 'Text').some(node => text(node).includes('本机发送记录')), false);
  assert.equal(named(h.tree, 'Text').some(node => text(node).includes('收据')), false);
  const completed = projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', receipt('completed')]]));
  const changed = mount(completed);
  assert.equal(named(changed.rowTree, 'View').find(v => v.props.accessibilityLabel === '已完成').props.style.height, 23);
  assert.equal(completed[0].key, projected[0].key);
});
test('composer swaps send for stop only in current running thread, preserves draft and empty stop', () => {
  const rows = projectTimeline([msg], null, 'th', undefined, true);
  for (const draft of ['', 'keep this draft']) {
    const h = mount(rows, [receipt('running')], [], { text: draft });
    const buttons = named(h.tree, 'Pressable');
    assert.equal(buttons.some(n => n.props.accessibilityLabel === '发送'), false);
    const stop = buttons.find(n => n.props.accessibilityLabel === '停止');
    assert.equal(stop.props.disabled, false);
    click(h.tree, '停止');
    assert.deepEqual(h.calls, [['stop']]);
    assert.equal(named(h.tree, 'TextInput')[0].props.value, draft);
  }
  for (const state of ['queued', 'completed', 'failed', 'interrupted', 'unknown']) {
    const h = mount(rows, [receipt(state)]);
    click(h.tree, '发送');
    assert.deepEqual(h.calls, [['send']]);
    assert.equal(named(h.tree, 'Pressable').some(n => n.props.accessibilityLabel === '停止'), false);
  }
  const other = mount(rows, [{ ...receipt('running'), thread_id: 'other' }]);
  click(other.tree, '发送');
  const busy = mount(rows, [receipt('running')], [], { busy: true });
  assert.equal(named(busy.tree, 'Pressable').find(n => n.props.accessibilityLabel === '停止').props.disabled, true);
});
test('connection surface omits URL, ID and raw status and keeps pairing choices', () => {
  const { ConnectionScreen } = load('ConnectionScreen.tsx');
  const base = { code: '', onCode() {}, connected: true, pairing: false, busy: false, status: '', error: '', onPair() {}, onBack() {}, onForget() {} };
  const nodes = expand(ConnectionScreen(base));
  const labels = named(nodes, 'Text').map(text).join(' ');
  assert.ok(labels.includes('此设备已连接'));
  assert.doesNotMatch(labels, /https?:|token|receipt|sync|收据|同步|诊断/);
  assert.ok(named(nodes, 'Pressable').length >= 3);
});
