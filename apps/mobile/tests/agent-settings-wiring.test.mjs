import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const appText = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const app = ts.createSourceFile('App.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
function renderReturn(name, values) {
  const screen = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name);
  assert.ok(screen, `production ${name} exists`);
  const result = screen.body.statements.filter(ts.isReturnStatement).at(-1);
  const jsx = ts.transpileModule(`(function render() { ${result.getText(app)} })`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
  return walk(runInNewContext(jsx, { React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, styles: {}, ...values })());
}

test('Expo Router owns entry, native stack and credential-scoped viewer; no modal navigator', () => {
  assert.match(entry, /import 'expo-router\/entry'/);
  assert.match(layout, /<Stack key=\{identity\}/);
  assert.match(layout, /<ViewerProvider key=\{identity\}/);
  assert.match(layout, /<Stack\.Protected guard=\{!ready \|\| \(!!config && !\(editing && pendingPairing\)\)\}/);
  for (const name of ['index', 'channels/[channelId]', 'threads/[threadId]', 'connection', 'settings', 'viewer/[id]'])
    assert.ok(layout.includes(`name="${name}"`), name);
  assert.doesNotMatch(appText, /<Modal|PanResponder|NavigationMotion/);
});

test('channels push native routes; settings remains independent from chat', () => {
  const calls = [], client = { channels: new Map(), connectionState: 'online' };
  const router = { push: path => calls.push(path), back: () => calls.push('back') };
  const channels = renderReturn('ChannelsScreen', {
    ready: true, config: { id: 'conn' }, client, channelId: null, draftThreads: new Set(), error: '', loading: false, router,
    navigation: { thread: threadId => calls.push({ pathname: '/threads/[threadId]', params: { threadId } }) },
    View: 'View', Text: 'Text', HeaderActions: 'HeaderActions', FormKeyboardAvoidingView: 'FormKeyboardAvoidingView', ChannelScreens: 'ChannelScreens', Notice: 'Notice',
  });
  const header = channels.find(n => n.type === 'HeaderActions');
  header.props.onSettings(); header.props.onConnection();
  const list = channels.find(n => n.type === 'ChannelScreens');
  list.props.onChannel('p_one'); list.props.onThread('t_one');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['/settings', '/connection',
    { pathname: '/channels/[channelId]', params: { channelId: 'p_one' } },
    { pathname: '/threads/[threadId]', params: { threadId: 't_one' } }]);
  const agentName = { name: 'Tuly', ready: true, error: '', saving: false, save: async () => true, reload() {} };
  const settings = renderReturn('SettingsRoute', { config: { id: 'conn' }, client, agentName, router,
    FormKeyboardAvoidingView: 'FormKeyboardAvoidingView', AgentSettings: 'AgentSettings', ModelSettings: 'ModelSettings', FontSizeSettings: 'FontSizeSettings', Notice: 'Notice' });
  const form = settings.find(n => n.type === 'AgentSettings');
  assert.equal(form.props.name, 'Tuly'); assert.equal(form.props.onSave, agentName.save);
  assert.equal(settings.find(n => n.type === 'ModelSettings').props.client, client);
  assert.ok(settings.some(n => n.type === 'FontSizeSettings'));
  form.props.onClose(); assert.equal(calls.at(-1), 'back');
});

test('chat composer retains route-local identity and hides callbacks after blur', () => {
  const client = { channels: new Map([['p_one', {}]]), threads: new Map([['t_one', { project_id: 'p_one', title: 'Conversation one' }]]), supportsLatest: true, supportsSessionLabels: true };
  const calls = [], alerts = [], focusedRef = { current: true }, currentComposer = { current: 'conn:t_one' };
  const nodes = renderReturn('MountedThreadScreen', {
    config: { id: 'conn', baseUrl: 'https://synthetic.test' }, client, accountClient: client, editingLabels: false, setEditingLabels: value => calls.push(value), LabelPills: 'LabelPills', LabelsEditor: 'LabelsEditor', Alert: { alert: (...args) => alerts.push(args) }, selected: client.threads.get('t_one'), threadId: 't_one', anchor: undefined, showLatest() {}, router: { push: path => calls.push(path) }, rows: [], visibleMessages: [], located: true, first: 0,

    draftKey: 'conn:t_one', composerDrafts: { current: new Map() }, forgottenConnections: { current: new Set() }, pageCursor: null, historyBusy: false, entryPosition: { offset: 0, following: true, startRef: null }, timelineRef: { current: { pasteText: value => calls.push(value) } },
    text: 'draft', draftAttachments: [{ id: 'att' }], attachmentsBusy: false, receipts: [], interactions: [], answers: {}, status: 'online',
    composerScope: 'conn:t_one', currentComposer, focusedRef, attachmentClearKey: 3, agentName: { name: 'Tuly' }, busy: false,
    loading: false, error: '', connectionError: '', isAgentTyping: () => true, View: 'View', Text: 'Text', Notice: 'Notice',
    Stack: { Screen: 'StackScreen' }, HeaderActions: 'HeaderActions', ChatTimeline: 'ChatTimeline', TypingIndicator: 'TypingIndicator', AttachmentComposer: 'AttachmentComposer',
    renderAttachments() {}, setText() {}, send() {}, locateNext() {}, loadOlder() {}, onVisibleRefs() {}, onAttachmentsChange() {}, setAnswers() {}, answer() {}, run() {},
  });
  assert.equal(nodes.find(n => n.type === 'StackScreen').props.options.title, 'Conversation one');
  const header = nodes.find(n => n.type === 'StackScreen').props.options.headerRight();
  header.props.onSettings(); assert.deepEqual(calls, ['/settings']); calls.length = 0;
  header.props.onSessionMenu();
  assert.deepEqual(JSON.parse(JSON.stringify(alerts[0][2].map(action => action.text))), ['Edit labels', 'Copy session link', 'Cancel']);
  alerts[0][2][0].onPress(); assert.deepEqual(calls, [true]); calls.length = 0;
  const timeline = nodes.find(n => n.type === 'ChatTimeline');
  assert.equal(timeline.props.threadId, 't_one'); assert.equal(timeline.props.text, 'draft');
  assert.equal(timeline.props.typingIndicator.props.name, 'Tuly');
  const controls = { type: 'input' }, height = () => {};
  const attachment = timeline.props.composerAccessory(controls, height);
  assert.equal(attachment.props.key, 'conn:t_one'); assert.equal(attachment.props.onComposerHeight, height);
  attachment.props.onPasteText('keep'); focusedRef.current = false; attachment.props.onPasteText('hidden');
  assert.deepEqual(calls, ['keep']);
});
