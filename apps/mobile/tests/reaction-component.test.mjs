import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { projectTimeline } from '../src/timeline.ts';
import { parseMessageMarkdown, messageNeedsViewport, safeLinkUrl } from '../src/messageMarkdown.ts';

const native = { Animated: { Text: 'Text', Value: class { constructor(value) { this.value = value; } interpolate({ outputRange }) { return outputRange[this.value]; } }, }, AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' }, StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }) };
for (const key of ['FlatList', 'Image', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View', 'Modal']) native[key] = key;
const react = {
  Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  forwardRef: fn => fn, memo: fn => fn, useRef: current => ({ current }), useState: initial => [initial, () => {}],
  useCallback: fn => fn, useEffect: () => {}, useImperativeHandle: () => {}, useMemo: fn => fn()
};
const modules = {
  react: { ...react, default: react }, 'react-native': native,
  'expo-blur': { BlurView: 'BlurView' },
  'expo-router': { useIsFocused: () => true }, './Viewers': { useViewer: () => ({ openViewer() {} }) },
  './FontSize': { Text: native.Text, TextInput: native.TextInput, AnimatedText: native.Animated.Text, useFontSize: () => ({ scale: 1 }) },

  'react-native-keyboard-controller': { KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', KeyboardChatScrollView: 'KeyboardChatScrollView', useKeyboardHandler: () => {} },
  'react-native-reanimated': { runOnJS: fn => fn, useSharedValue: value => ({ value }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  './timeline': { appendedAtEnd: () => false, scrollToExactEnd: () => false, scrollStateFromEvent: () => ({}), shouldFollowContentChange: () => false },
  './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' }, './messageMarkdown': { parseMessageMarkdown, messageNeedsViewport, safeLinkUrl },
  './articleHtml': { ARTICLE_TEXT_LIMIT: 200000, renderArticleHtml: () => ({ html: '<article></article>', expansions: [], links: [] }) },
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
const text = node => { const all = v => Array.isArray(v) ? v.map(all).join('') : v && typeof v === 'object' ? typeof v.type === 'function' ? all(v.type(v.props)) : all(v.props?.children) : String(v ?? ''); return all(node.props.children); };
const msg = { id: 'm', ref_seq: 1, role: 'user', text: 'hello', receipt_id: 'r', client_message_id: 'c' };
const receipt = state => ({ id: 'r', thread_id: 'th', client_message_id: 'c', state, durable: true });
const record = status => ({ connectionId: 'conn', threadId: 'th', clientMessageId: 'c', text: 'hello', status, receiptId: status === 'accepted' ? 'r' : undefined, receiptRefSeq: status === 'accepted' ? 1 : undefined, receiptState: status === 'accepted' ? 'queued' : undefined });
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

test('owned timeline labels are English while message and attachment names stay verbatim', () => {
  const row = { ...projectTimeline([{ ...msg, text: '原文' }], null, 'th')[0], attachments: [
    { id: 'unnamed', name: '', state: 'available' }, { id: 'named', name: '照片.png', state: 'missing' }
  ] };
  const { rowTree, tree } = mount([row]);
  const visible = named(rowTree, 'Text').map(text).join(' ');
  assert.match(visible, /You/);
  assert.match(visible, /Attachment: Unnamed attachment \(Available\)/);
  assert.match(visible, /Attachment: 照片\.png \(Unavailable for now\)/);
  assert.equal(named(rowTree, 'MessageContent')[0].props.text, '原文');
  const composer = named(tree, 'TextInput')[0];
  assert.equal(composer.props.accessibilityLabel, 'Message text');
  assert.equal(composer.props.placeholder, 'Message…');
});

test('sender and time are adjacent for each full message, not assistant continuations', () => {
  const messages = [
    { ...msg, created_at: 0 },
    { id: 'a1', ref_seq: 2, role: 'assistant', text: 'First', created_at: 123 },
    { id: 'a2', ref_seq: 3, role: 'assistant', text: '', tool_calls: [{ id: 'tool', name: 'search', label: 'Searching' }], created_at: 124 },
    { id: 'a3', ref_seq: 4, role: 'assistant', text: 'Last', created_at: 125 },
    { ...msg, id: 'u2', ref_seq: 5, client_message_id: 'c2', receipt_id: 'r2', created_at: 126 }
  ];
  const rows = projectTimeline(messages, null, 'th');
  assert.deepEqual(rows.map(r => r.key), ['local:c', 'ref:2', 'ref:3', 'ref:4', 'local:c2']);
  for (const [index, expected] of [[0, 'You'], [1, 'Hermes'], [4, 'You']]) {
    const { rowTree } = mount([rows[index]]);
    const byline = named(rowTree, 'View').find(v => v.props.style?.flexDirection === 'row' && v.props.style?.gap === 8);
    assert.ok(byline, `byline for row ${index}`);
    const children = byline.props.children.filter(n => n && typeof n === 'object');
    assert.equal(children[0].type, 'Text'); assert.equal(text(children[0]), expected);
    assert.equal(children[1].type, 'MessageTime');
    assert.equal(children[1].props.seconds, messages[index].created_at);
    assert.equal(named(rowTree, 'MessageContent')[0].props.text, messages[index].text);
  }
  for (const index of [2, 3]) {
    const { rowTree } = mount([rows[index]]);
    assert.equal(named(rowTree, 'MessageTime').length, 0);
    assert.equal(named(rowTree, 'MessageContent')[0].props.text, messages[index].text);
  }
});

test('followup callback reaction stays visible without changing row identity or footprint', () => {
  let previous;
  let footprint;
  for (const [state, processing, label] of [['queued', null, undefined], ['running', 'running', 'Working'], ['running', 'completed', 'Completed'], ['received', null, undefined]]) {
    const r = { ...receipt(state), admission: 'followup', handed_off: true, processing };
    const row = projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', r]]))[0];
    const { rowTree } = mount([row]);
    const slot = named(rowTree, 'View').find(n => n.props.style?.height === 23);
    assert.ok(slot, 'reserve the same height to avoid scroll jumps');
    assert.equal(slot.props.accessibilityLabel, label);
    assert.equal(named(expand(slot), 'Text').map(text).join(''), `${label ? `${row.reaction.emoji} ${label}` : ''}${state === 'queued' ? 'Cancel' : ''}`);
    assert.equal(named(rowTree, 'MessageContent')[0].props.text, msg.text);
    assert.equal(named(rowTree, 'MessageContent')[0].props.pending, false);
    assert.equal(row.receipt, r);
    if (previous) assert.equal(row.key, previous.key);
    if (footprint) assert.deepEqual(slot.props.style, footprint);
    previous = row; footprint = slot.props.style;
  }
});

test('native busy ACK appears below exact user input, independent of processing reaction', () => {
  const modes = [
    '⏩ Steered into current run (iteration 2/500). Your message arrives after the next tool call.',
    '⏩ Steered into current run and its active subagent(s). Your message arrives after their next tool call.',
    "↪ Redirected current run. I'll adjust using your correction.",
    "⏳ Queued for the next turn. I'll respond once the current task finishes.",
    '⏳ Subagent working — your message is queued for when it finishes (use /stop to cancel everything).',
    '⏳ Compressing context — your message is queued for when it finishes (use /stop to cancel everything).',
    "⚡ Interrupting current task. I'll respond to your message shortly."
  ];
  for (const feedback of modes) {
    const r = { ...receipt('running'), admission: 'followup', feedback, processing: 'running' };
    const optimistic = projectTimeline([], { ...record('accepted'), receiptState: 'running', receiptFeedback: feedback, receiptProcessing: 'running' }, 'th', undefined, true);
    const authoritative = projectTimeline([msg, { ...msg, id: 'm2', ref_seq: 2, client_message_id: 'other', receipt_id: 'other', text: 'same' }], null, 'th', undefined, true, [], new Map([['r', r]]));
    for (const rows of [optimistic, authoritative]) {
      const { rowTree } = mount(rows);
      const label = named(rowTree, 'Text').find(n => n.props.accessibilityLabel === `Feedback after receipt: ${feedback}`);
      assert.ok(label); assert.equal(text(label), feedback);
      assert.equal(label.props.style.fontSize, 12);
      assert.equal(label.props.style.flexShrink, 1);
      assert.equal(rows[0].reaction?.label, 'Working');
      assert.equal(named(rowTree, 'MessageContent')[0].props.text, msg.text);
      assert.equal(named(rowTree, 'View').find(n => n.props.accessibilityLabel === 'Working').props.style.height, 23);
    }
    assert.equal(authoritative[1].feedback, undefined);
    assert.equal(authoritative.length, 2);
    assert.equal(optimistic[0].key, authoritative[0].key);
  }
  const cold = projectTimeline([msg], { ...record('accepted'), receiptState: 'running', receiptFeedback: modes[0] }, 'th', undefined, true);
  assert.equal(cold[0].feedback, modes[0], 'durable fallback survives missing receipt cache');
  assert.equal(cold[0].reaction, undefined, 'ACK never implies a successful callback');
  const failed = projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', { ...receipt('failed'), feedback: modes[0], processing: 'failed' }]]));
  assert.equal(failed[0].feedback, modes[0]);
  assert.equal(failed[0].reaction?.label, 'Failed', 'admission feedback cannot hide final processing failure');
  const noAck = projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', { ...receipt('completed'), processing: 'failed' }]]));
  assert.equal(noAck[0].feedback, undefined);
  assert.equal(noAck[0].reaction?.label, 'Failed');
});

test('composer accepts ready attachments without text and blocks incomplete uploads; accessories remain in dock', () => {
  const rows = projectTimeline([msg], null, 'th', undefined, true);
  const accessory = controls => ({ type: 'AttachmentComposer', props: { children: controls } }), indicator = { type: 'TypingIndicator', props: {} };
  const preview = row => ({ type: 'AttachmentPreview', props: { attachmentIds: row.attachments?.map(a => a.id) } });
  rows[0].attachments = [{ id: 'att_a', state: 'available' }];
  const ready = mount(rows, [], [], { text: '', attachmentCount: 2, composerAccessory: accessory, typingIndicator: indicator, renderAttachments: preview });
  const send = named(ready.tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Send');
  assert.equal(send.props.disabled, false); send.props.onPress();
  assert.deepEqual(ready.calls, [['send']]);
  assert.equal(named(ready.rowTree, 'AttachmentPreview').length, 1);
  const dock = named(ready.tree, 'KeyboardStickyView')[0];
  const dockChildren = expand(dock.props.children);
  assert.ok(dockChildren.some(n => n.type === 'AttachmentComposer'));
  assert.ok(dockChildren.findIndex(n => n.type === 'TypingIndicator') < dockChildren.findIndex(n => n.type === 'TextInput'));
  for (const overrides of [{ attachmentsBusy: true, attachmentCount: 1 }, { attachmentCount: 0 }, { busy: true, attachmentCount: 1 }]) {
    const h = mount(rows, [], [], { text: '', ...overrides });
    assert.equal(named(h.tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Send').props.disabled, true);
  }
});

test('assistant fills available width without a bubble; user bubble remains unchanged', () => {
  const rowStyle = role => {
    const rows = projectTimeline([{ ...msg, role }], null, 'th', undefined, true);
    const views = named(mount(rows).rowTree, 'View');
    if (role === 'user') {
      assert.equal(views[0].props.style.alignSelf, 'stretch');
      assert.equal(views[0].props.style.marginHorizontal, 14);
    }
    const style = views[role === 'user' ? 1 : 0].props.style;
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
  assert.equal(user.width, undefined, 'short messages must shrink to their content');
  assert.equal(user.maxWidth, '80%');
  assert.equal(user.marginHorizontal, 0, 'gutters belong to the definite-width parent');
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
    assert.equal(content.props.canExpand, role === 'assistant', 'whole-message fullscreen belongs to Agent replies');
    const originalState = modules.react.useState;
    const states = [];
    let cursor = 0;
    modules.react.useState = initial => {
      const at = cursor++;
      if (!(at in states)) states[at] = initial;
      return [states[at], next => { states[at] = typeof next === 'function' ? next(states[at]) : next; }];
    };
    let rendered;
    try {
      // Compare the common Markdown body with role-specific whole-message UI off.
      const bodyProps = { ...content.props, canExpand: false };
      const initial = expand(MessageContent(bodyProps));
      initial.filter(n => n.props.onLayout).forEach(n => n.props.onLayout({ nativeEvent: { layout: { width: 260, height: n.props.style.height } } }));
      cursor = 0;
      rendered = expand(MessageContent(bodyProps));
    } finally { modules.react.useState = originalState; }
    assert.equal(named(rendered, 'Image').length, 1);
    assert.equal(named(rendered, 'WebView').length, 3);
    assert.ok(named(rendered, 'Pressable').some(n => n.props.accessibilityLabel === 'Play video: 视频'));
    assert.ok(named(rendered, 'Pressable').some(n => n.props.accessibilityLabel === 'Copy code'));
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

test('public commentary and safe tool summaries remain ordered without repeated agent headers', () => {
  const calls = [
    { id: 'read-1', name: 'read_file', label: '读取 AGENTS.md' },
    { id: 'cmd-1', name: 'terminal', label: '运行命令', detail: 'git status --short\nnode --version' }
  ];
  const messages = [
    { id: '1', ref_seq: 1, role: 'user', text: '检查项目' },
    { id: '2', ref_seq: 2, role: 'assistant', text: '先读取文件。', tool_calls: calls },
    { id: '3', ref_seq: 3, role: 'assistant', text: '', tool_calls: [{ id: 'search-1', name: 'search_files', label: '搜索 zoomScale' }] },
    { id: '4', ref_seq: 4, role: 'assistant', text: '**检查完成**' }
  ];
  const rows = projectTimeline(messages, null, 'th');
  assert.deepEqual(rows.map(r => r.key), ['ref:1', 'ref:2', 'ref:3', 'ref:4']);
  assert.equal(rows[1].continuation, false);
  assert.equal(rows[2].continuation, true);
  assert.equal(rows[3].continuation, true);
  assert.equal(rows[1].toolCalls, calls);
  const rendered = [];
  for (const row of rows.slice(1)) {
    const { rowTree } = mount([row]);
    assert.equal(named(rowTree, 'Text').some(n => text(n) === 'Hermes'), !row.continuation);
    const body = named(rowTree, 'MessageContent')[0];
    assert.equal(body.props.toolCalls, row.toolCalls);
    const nodes = expand(MessageContent(body.props));
    rendered.push(...named(nodes, 'Text').map(text));
    for (const detail of named(nodes, 'ScrollView')) if (detail.props.horizontal) {
      assert.equal(detail.props.nestedScrollEnabled, true);
    }
  }
  const output = rendered.join('\n');
  const marks = ['先读取文件。', '读取 AGENTS.md', '运行命令', 'git status --short', '搜索 zoomScale', '检查完成'];
  for (let i = 1; i < marks.length; i++) assert.ok(output.indexOf(marks[i]) > output.indexOf(marks[i - 1]), output);
  assert.doesNotMatch(output, /cmd-1|read-1|search-1|undefined|执行成功/);
  assert.equal(projectTimeline(messages.slice(2), null, 'th')[0].continuation, false, 'new history window starts with a visible author');
  assert.deepEqual(projectTimeline(messages, null, 'th').map(r => r.key), rows.map(r => r.key));
});

test('tool-only rows are compact without changing prose, mixed messages or user bubbles', () => {
  const toolCalls = [{ id: 'c', name: 'web_search', label: '搜索网页：Hermes' }];
  const styleFor = (role, body, calls) => {
    const rows = projectTimeline([{ ...msg, role, text: body, tool_calls: calls }], null, 'th');
    const views = named(mount(rows).rowTree, 'View');
    const style = views[role === 'user' ? 1 : 0].props.style;
    return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  };
  assert.equal(styleFor('assistant', '', toolCalls).marginVertical, 2);
  assert.equal(styleFor('assistant', '   ', toolCalls).marginVertical, 2);
  assert.equal(styleFor('assistant', '公开说明', toolCalls).marginVertical, 5);
  assert.equal(styleFor('assistant', '最终回复').marginVertical, 5);
  assert.equal(styleFor('user', '我的消息').marginVertical, 5);
});

test('legacy and user messages never turn body text or injected fields into tool activity', () => {
  const tool_calls = [{ id: 'x', name: 'terminal', label: '运行命令', detail: 'fake command' }];
  const row = projectTimeline([{ ...msg, text: 'terminal: my text', tool_calls }], null, 'th')[0];
  assert.equal(row.toolCalls, undefined);
  assert.equal(named(mount([row]).rowTree, 'MessageContent')[0].props.toolCalls, undefined);
  const legacy = projectTimeline([{ ...msg, role: 'assistant' }], null, 'th')[0];
  assert.equal(legacy.toolCalls, undefined);
});

test('real message component renders legible gray text until accepted, then normal even while queued', () => {
  const phases = ['queued', 'sending', 'ambiguous', 'blocked', 'accepted'];
  for (const phase of phases) {
    const rows = projectTimeline([], record(phase), 'th', undefined, true);
    const { rowTree } = mount(rows);
    const content = named(rowTree, 'MessageContent')[0];
    assert.equal(content.props.pending, phase !== 'accepted');
    assert.equal(rows[0].reaction, undefined);
    assert.equal(named(rowTree, 'Text').some(v => text(v).includes('Not sent. Check your message or contact your administrator.')), phase === 'blocked');
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
  const cache = new Map([['r', { ...receipt('running'), processing: 'running' }]]);
  const interaction = { id: 'ask', kind: 'approval', state: 'pending', thread_id: 'th', receipt_id: 'r', prompt: '允许继续？', choices: ['允许', '拒绝'] };
  const projected = projectTimeline([msg], null, 'th', undefined, true, [], cache, [interaction]);
  const h = mount(projected, [receipt('queued'), receipt('running')], [interaction]);
  const slot = named(h.rowTree, 'View').find(v => v.props.accessibilityLabel === 'Awaiting approval');
  assert.ok(slot); assert.equal(slot.props.style.height, 23);
  assert.equal(named(h.rowTree, 'Pressable').length, 0);
  click(h.tree, 'Stop'); click(h.tree, '允许');
  assert.deepEqual(h.calls, [['stop'], ['answer', 'ask', '允许']]);
  const queued = mount(projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', receipt('queued')]])), [receipt('queued')]);
  click(queued.rowTree, 'Cancel queued message');
  assert.deepEqual(queued.calls, [['cancel', 'r']]);
  assert.equal(named(h.tree, 'Pressable').some(n => n.props.accessibilityLabel === '停止当前执行'), false);
  assert.equal(named(h.tree, 'Text').some(node => text(node).includes('本机发送记录')), false);
  assert.equal(named(h.tree, 'Text').some(node => text(node).includes('收据')), false);
  const completed = projectTimeline([msg], null, 'th', undefined, true, [], new Map([['r', { ...receipt('completed'), processing: 'completed' }]]));
  const changed = mount(completed);
  assert.equal(named(changed.rowTree, 'View').find(v => v.props.accessibilityLabel === 'Completed').props.style.height, 23);
  assert.equal(completed[0].key, projected[0].key);
});
test('latest action sits above the composer at the right in its shared keyboard dock', () => {
  const rows = projectTimeline([msg], null, 'th', undefined, true);
  for (const accessory of [false, true]) {
  const h = mount(rows, [], [], { position: { offset: 20, following: false },
    ...(accessory ? { composerAccessory: controls => react.createElement('Accessory', {}, controls) } : {}) });
  const latest = named(h.tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Jump to latest ↓');
  assert.ok(latest);
  assert.equal(latest.props.style.position, undefined);
  const sticky = named(h.tree, 'KeyboardStickyView')[0];
  assert.equal(named(h.tree, 'KeyboardStickyView').length, 1);
  const row = sticky.props.children[0];
  assert.equal(row.type, 'View');
  assert.equal(row.props.style.alignItems, 'flex-end');
  assert.equal(row.props.style.backgroundColor, 'transparent');
  assert.equal(row.props.pointerEvents, 'box-none');
  assert.equal(sticky.props.pointerEvents, 'box-none');
  assert.equal(typeof row.props.onLayout, 'function');
  assert.equal(latest.props.style.backgroundColor, '#e7eef7');
  assert.ok(row.props.style.paddingHorizontal > 0);
  assert.ok(expand(row).includes(latest));
  const composer = accessory ? named(h.tree, 'Accessory')[0] : named(h.tree, 'View').find(n => n.props.style?.paddingVertical === 7 && n.props.style?.flexDirection === 'row');
  assert.ok(expand(sticky).includes(composer));
  const blurs = named(h.tree, 'BlurView');
  assert.equal(blurs.length, 1, 'one native blur for the complete composer');
  const surfaces = named(h.tree, 'View').filter(n => n.props.style?.backgroundColor?.startsWith?.('rgba(246, 249, 253'));
  assert.equal(surfaces.length, 1, 'one translucent fallback surface');
  const surface = surfaces[0];
  assert.ok(expand(surface).includes(blurs[0]));
  assert.ok(expand(surface).includes(composer), 'the entire accessory, including its menu, is inside the blur');
  assert.ok(!expand(surface).includes(latest), 'latest row must remain transparent outside the blur surface');
  assert.equal(surface.props.style.overflow, 'hidden');
  assert.equal(named(h.tree, 'View').some(n => n.props.style?.boxShadow), false);
  assert.ok(!expand(composer).includes(latest), 'button must not consume input-row width');
  assert.ok(expand(sticky).indexOf(latest) < expand(sticky).indexOf(composer));
  assert.equal(named(h.rowTree, 'Pressable').some(n => n.props.accessibilityLabel === 'Jump to latest ↓'), false);
  }
});

test('composer keeps send while running with an independent stop that preserves draft', () => {
  const rows = projectTimeline([msg], null, 'th', undefined, true);
  for (const draft of ['', 'keep this draft']) {
    const h = mount(rows, [receipt('running')], [], { text: draft });
    const buttons = named(h.tree, 'Pressable');
    const send = buttons.find(n => n.props.accessibilityLabel === 'Send');
    assert.ok(send); assert.equal(send.props.disabled, draft === '');
    const stop = buttons.find(n => n.props.accessibilityLabel === 'Stop');
    assert.equal(stop.props.disabled, false);
    click(h.tree, 'Stop');
    assert.deepEqual(h.calls, [['stop']]);
    if (draft) { click(h.tree, 'Send'); assert.deepEqual(h.calls, [['stop'], ['send']]); }
    assert.equal(named(h.tree, 'TextInput')[0].props.value, draft);
  }
  for (const state of ['queued', 'completed', 'failed', 'interrupted', 'unknown']) {
    const h = mount(rows, [receipt(state)]);
    click(h.tree, 'Send');
    assert.deepEqual(h.calls, [['send']]);
    assert.equal(named(h.tree, 'Pressable').some(n => n.props.accessibilityLabel === 'Stop'), false);
  }
  const other = mount(rows, [{ ...receipt('running'), thread_id: 'other' }]);
  click(other.tree, 'Send');
  const busy = mount(rows, [receipt('running')], [], { busy: true });
  assert.equal(named(busy.tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Stop').props.disabled, true);
});
test('connection surface omits URL, ID and raw status and keeps pairing choices', () => {
  const { ConnectionScreen } = load('ConnectionScreen.tsx');
  const base = { code: '', onCode() {}, connected: true, pairing: false, busy: false, status: '', error: '', onPair() {}, onBack() {}, onForget() {} };
  const nodes = expand(ConnectionScreen(base));
  const labels = named(nodes, 'Text').map(text).join(' ');
  assert.ok(labels.includes('This device is connected. It will reconnect automatically if the network drops.'));
  assert.doesNotMatch(labels, /https?:|token|receipt|sync|收据|同步|诊断/);
  assert.ok(named(nodes, 'Pressable').length >= 3);
});
