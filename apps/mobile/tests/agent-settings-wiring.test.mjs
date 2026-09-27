import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the production Screen return and its callbacks; native modal behavior remains a device test.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'Screen');
const result = screen.body.statements.filter(ts.isReturnStatement).at(-1);
const code = ts.transpileModule(`(function render() { ${result.getText(source)} })`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
function harness() {
  const calls = [];
  const context = {
    React: { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    styles: {}, config: { id: 'conn' }, settingsOpen: false, error: '', loading: false, threadId: 'th',
    client: { supportsLatest: true, threads: new Map() }, selected: { title: 'Chat' }, rows: [], visibleMessages: [], located: true,
    first: 0, pageCursor: null, historyBusy: false, position: undefined, positions: { current: new Map() },
    timelineRef: { current: { pasteText: value => calls.push(['paste', value]) } }, text: 'draft', draftAttachments: [{ id: 'att' }], attachmentsBusy: false,
    receipts: [], interactions: [], answers: {}, status: 'online', composerScope: 'conn:th', currentComposer: { current: 'conn:th' }, attachmentClearKey: 3,
    busy: false, channelId: null, openingRef: { current: 0 }, agentName: { name: 'Tuly', ready: true, error: '', saving: false, save: async () => true, reload: () => calls.push(['reload']) },
    isAgentTyping: () => true,
  };
  for (const name of ['View', 'Text', 'Button', 'ChatTimeline', 'TypingIndicator', 'AttachmentComposer', 'ChannelScreens', 'KeyboardAvoidingView', 'Modal', 'SafeAreaView', 'AgentSettings']) context[name] = name;
  for (const name of ['setEditing', 'setThreadId', 'setPageCursor', 'locateNext', 'loadOlder', 'visibleRef', 'setText', 'send', 'renderAttachments', 'onAttachmentsChange', 'setAnswers', 'answer', 'run', 'setChannelId', 'openThread']) context[name] = () => {};
  context.setSettingsOpen = value => { context.settingsOpen = value; };
  const render = runInNewContext(code, context);
  return { context, calls, render: () => walk(render()) };
}

test('settings opens over existing chat, names running indicator, and closes by native back', () => {
  const h = harness(); let nodes = h.render();
  const chat = nodes.find(n => n.type === 'ChatTimeline');
  assert.equal(chat.props.text, 'draft');
  assert.equal(chat.props.typingIndicator.props.name, 'Tuly');
  assert.ok(!nodes.some(n => n.type === 'Modal'));
  nodes.find(n => n.type === 'Button' && n.props.title === 'Agent 设置').props.onPress();
  nodes = h.render();
  const modal = nodes.find(n => n.type === 'Modal');
  assert.equal(modal.props.presentationStyle, 'fullScreen');
  const settings = nodes.find(n => n.type === 'AgentSettings');
  assert.equal(settings.props.name, 'Tuly'); assert.equal(settings.props.onSave, h.context.agentName.save);
  settings.props.onRetry(); assert.deepEqual(h.calls, [['reload']]);
  const retained = nodes.find(n => n.type === 'ChatTimeline');
  assert.equal(retained.props.key, chat.props.key); assert.equal(retained.props.text, 'draft'); assert.equal(retained.props.attachmentCount, 1);
  modal.props.onRequestClose(); assert.ok(!h.render().some(n => n.type === 'Modal'));
});

test('composer wraps actual input controls with stable attachment identity and layout callback', () => {
  const h = harness(), chat = h.render().find(n => n.type === 'ChatTimeline');
  const controls = { type: 'TextInput', props: {} }, onHeight = () => {};
  const attachment = chat.props.composerAccessory(controls, onHeight);
  assert.equal(attachment.type, 'AttachmentComposer'); assert.equal(attachment.props.key, 'conn:th');
  assert.equal(attachment.props.children[0], controls); assert.equal(attachment.props.onComposerHeight, onHeight);
  attachment.props.onPasteText('text'); assert.deepEqual(h.calls, [['paste', 'text']]);
  h.context.currentComposer.current = 'other'; attachment.props.onPasteText('stale'); assert.equal(h.calls.length, 1);
});
