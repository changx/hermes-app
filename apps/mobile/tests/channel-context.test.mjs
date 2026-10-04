import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { threadPatch } from '../src/channel-edits.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

async function harness(file, component, client, extra = {}) {
  const Focus = React.createContext(true), alerts = [], navigation = [], actions = [];
  let prevention;
  const mocks = {
    react: React,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable',
      FlatList: props => React.createElement('FlatList', props, props.ListHeaderComponent,
        props.data.length ? props.data.map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item }))) : props.ListEmptyComponent),
      Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: value => value } },
    'expo-router': { useIsFocused: () => React.useContext(Focus), useNavigation: () => ({ dispatch: action => navigation.push(action) }),
      useFocusEffect: callback => { const focused = React.useContext(Focus); React.useEffect(() => focused ? callback() : undefined, [focused, callback]); } },
    'expo-router/react-navigation': { usePreventRemove: (prevent, callback) => { prevention = { prevent, callback }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    './FontSize': { Text: 'Text', TextInput: 'TextInput' }, './MessageContent': { MessageContent: 'Markdown' },
    './channel-edits': { threadPatch }, './NewTopicComposer': { NewTopicComposer: 'Composer' },
    './MessageTime': { MessageTime: 'MessageTime' }, 'expo-symbols': { SymbolView: 'SymbolView' },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, console, AbortController, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } });
  let root;
  const props = { client, channelId: 'p_one', onContext: id => actions.push(['context', id]), onThread: id => actions.push(['thread', id]),
    onChannel: () => {}, onNewChannel: () => {}, enqueueFirstMessage: async () => {}, ...extra };
  const render = async (focus = true) => act(async () => {
    const tree = React.createElement(Focus.Provider, { value: focus }, React.createElement(exports[component], props));
    if (root) root.update(tree); else root = create(tree);
  });
  await render();
  const buttons = () => root.root.findAllByType('Pressable');
  return { get root() { return root; }, alerts, actions, navigation, render,
    async drafts(ids) { props.draftThreads = new Set(ids); await render(); },
    get prevention() { return prevention; },
    button: label => buttons().find(node => node.props.accessibilityLabel === label),
    input: () => root.root.findByType('TextInput'),
    async press(label) { await act(async () => this.button(label).props.onPress()); },
    async type(value) { await act(async () => this.input().props.onChangeText(value)); },
    async close() { await act(async () => root.unmount()); },
  };
}

function contextClient(description = '# Project\nA short summary') {
  let stored = { id: 'p_one', name: 'Original name', description };
  const reads = [], writes = [];
  return { reads, writes, async getChannelInfo(id, signal) { reads.push({ id, signal }); return { ...stored }; },
    async updateChannel(id, patch) { writes.push({ id, patch }); stored = { ...stored, name: 'Renamed elsewhere', ...patch }; return { ...stored }; },
    get stored() { return stored; } };
}

test('production list is latest-first, excludes archived/other channels, and reads no context until navigation', async () => {
  const client = { channels: new Map([['p_one', { id: 'p_one', name: 'Project', description: 'Hidden full description' }]]),
    threads: new Map([
      ['old', { id: 'old', project_id: 'p_one', title: 'Old', last_message_at: 10.5, last_ref: 0 }],
      ['new', { id: 'new', project_id: 'p_one', title: 'New', last_message_at: 30.5, last_ref: 0, running: true }],
      ['empty', { id: 'empty', project_id: 'p_one', title: 'Empty', last_ref: 0 }],
      ['archived', { id: 'archived', project_id: 'p_one', title: 'Archived', last_message_at: 40, archived: true }],
      ['other', { id: 'other', project_id: 'p_two', title: 'Other', last_message_at: 50 }],
    ]), getChannelInfo() { throw Error('Must not prefetch'); } };
  const h = await harness('ChannelScreens.tsx', 'ChannelScreens', client);
  const list = h.root.root.findByType('FlatList');
  assert.deepEqual(plain(list.props.data.map(item => item.id)), ['new', 'old', 'empty']);
  assert.equal(list.props.inverted, undefined);
  assert.equal(list.props.maintainVisibleContentPosition, undefined);
  assert.equal(list.props.ListFooterComponent, undefined);
  assert.ok(!h.root.root.findAllByType('Text').some(node => node.props.children === 'Hidden full description'));
  assert.equal(h.root.root.findByType('Composer').props.channelId, 'p_one');
  assert.equal(h.button('Rename'), undefined);
  await h.press('Channel context');
  await h.press('New');
  assert.deepEqual(h.actions, [['context', 'p_one'], ['thread', 'new']]);
  assert.equal(h.root.root.findAllByProps({ accessibilityLabel: 'Running' }).length, 1);
  await h.close();
});

test('local draft labels update without changing catalogue rows, running or unread state', async () => {
  const thread = { id: 't_one', project_id: 'p_one', title: 'One', last_ref: 0, running: true, completed_unread: true };
  const client = { channels: new Map([['p_one', { id: 'p_one', name: 'Project' }]]), threads: new Map([[thread.id, thread]]) };
  const h = await harness('ChannelScreens.tsx', 'ChannelScreens', client);
  try {
    assert.equal(h.root.root.findAllByProps({ accessibilityLabel: 'Draft' }).length, 0);
    await h.drafts(['t_one', 'not-in-this-list']);
    assert.equal(h.root.root.findByProps({ accessibilityLabel: 'Draft' }).props.children, 'draft');
    const draft = h.root.root.findByProps({ accessibilityLabel: 'Draft' });
    assert.equal(draft.props.style.color, '#8a4b00');
    assert.equal(draft.props.style.fontWeight, '700');
    assert.equal(draft.props.style.fontSize, 13);
    assert.equal(draft.parent.props.style.backgroundColor, '#fff1cc');
    assert.equal(draft.parent.props.style.borderColor, '#e8b454');
    assert.equal(draft.parent.props.style.flexShrink, 0);
    assert.ok(draft.parent.parent.findAllByType('Text').some(node => node.props.children === 'One'), 'badge shares the title row, not metadata');
    assert.ok(h.button('One, draft'));
    assert.equal(h.root.root.findByType('FlatList').props.extraData.has('t_one'), true);
    assert.equal(h.root.root.findAllByProps({ accessibilityLabel: 'Running' }).length, 1);
    assert.equal(h.root.root.findAllByProps({ accessibilityLabel: 'Completed, unread' }).length, 1);
    assert.equal(h.root.root.findByType('FlatList').props.data[0], thread);
    await h.drafts([]);
    assert.equal(h.root.root.findAllByProps({ accessibilityLabel: 'Draft' }).length, 0);
    assert.equal(client.threads.get('t_one'), thread);
  } finally { await h.close(); }
});

test('rename stays available via long press and accessibility, without per-session edit icons', async () => {
  const writes = [];
  const client = { channels: new Map([['p_one', { id: 'p_one', name: 'Project' }]]),
    threads: new Map([['t_one', { id: 't_one', project_id: 'p_one', title: 'One', last_ref: 0 }]]),
    async updateThread(id, patch) { writes.push({ id, patch }); } };
  const h = await harness('ChannelScreens.tsx', 'ChannelScreens', client);
  await act(async () => h.button('One').props.onLongPress());
  assert.equal(h.actions.length, 0);
  assert.equal(h.alerts[0][2][0].text, 'Rename session');
  await act(async () => h.alerts[0][2][0].onPress());
  await h.type('Updated'); await h.press('Save');
  assert.deepEqual(plain(writes), [{ id: 't_one', patch: { title: 'Updated' } }]);
  await act(async () => h.button('One').props.onAccessibilityAction({ nativeEvent: { actionName: 'rename' } }));
  assert.equal(h.input().props.value, 'One');
  await h.close();
});

test('channel overflow renames only the name, never sends cached description', async () => {
  const writes = [];
  const client = { channels: new Map([['p_one', { id: 'p_one', name: 'Project' }]]), threads: new Map(),
    async updateChannel(id, patch) { writes.push({ id, patch }); } };
  const h = await harness('ChannelScreens.tsx', 'ChannelScreens', client);
  await h.press('Channel options');
  await act(async () => h.alerts[0][2][0].onPress());
  await h.type('Renamed'); await h.press('Save');
  assert.deepEqual(plain(writes), [{ id: 'p_one', patch: { name: 'Renamed' } }]);
  await h.close();
});

test('context reads full detail, renders Markdown, saves description only and verifies exact target', async () => {
  const client = contextClient();
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  assert.equal(h.root.root.findByType('Markdown').props.text, '# Project\nA short summary');
  assert.equal(client.reads.length, 1);
  await h.press('Edit');
  assert.equal(h.input().props.maxLength, 4000);
  await h.type('New summary');
  assert.equal(h.prevention.prevent, true);
  await h.press('Save');
  assert.deepEqual(plain(client.writes), [{ id: 'p_one', patch: { description: 'New summary' } }]);
  assert.equal(client.reads.length, 2);
  assert.equal(client.reads[1].id, 'p_one');
  assert.equal(client.stored.name, 'Renamed elsewhere');
  assert.equal(h.root.root.findByType('Markdown').props.text, 'New summary');
  assert.equal(h.prevention.prevent, false);
  await h.close();
});

test('empty context can be added and existing context can be cleared', async () => {
  const client = contextClient('');
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.press('Add context'); await h.type('Summary'); await h.press('Save');
  await h.press('Edit'); await h.type(''); await h.press('Save');
  assert.equal(client.stored.description, '');
  assert.ok(h.button('Add context'));
  await h.close();
});

test('cancel and native back both protect unsaved changes; discard never writes', async () => {
  const client = contextClient('Original');
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.press('Edit'); await h.type('Unsaved'); await h.press('Cancel');
  assert.equal(h.alerts[0][0], 'Discard changes?');
  assert.equal(h.input().props.value, 'Unsaved');
  await act(async () => h.prevention.callback({ data: { action: { type: 'GO_BACK' } } }));
  await act(async () => h.alerts[1][2][1].onPress());
  assert.deepEqual(h.navigation, [{ type: 'GO_BACK' }]);
  assert.equal(h.root.root.findByType('Markdown').props.text, 'Original');
  assert.equal(client.writes.length, 0);
  await h.close();
});

test('loading failure has retry, not a misleading empty context editor', async () => {
  let fail = true;
  const client = { async getChannelInfo() { if (fail) throw Error('network'); return { id: 'p_one', name: 'Project', description: 'Loaded' }; } };
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  assert.ok(h.button('Try again'));
  assert.equal(h.button('Edit'), undefined);
  fail = false; await h.press('Try again');
  assert.equal(h.root.root.findByType('Markdown').props.text, 'Loaded');
  await h.close();
});

test('failed save/readback preserves the draft and does not claim success', async () => {
  const client = contextClient('Original');
  client.updateChannel = async () => { throw Error('network'); };
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.press('Edit'); await h.type('Keep me'); await h.press('Save');
  assert.equal(h.input().props.value, 'Keep me');
  assert.equal(h.button('Save').props.disabled, false);
  assert.match(JSON.stringify(h.root.toJSON()), /Could not confirm your changes/);
  client.updateChannel = async () => {};
  await h.press('Save'); // authoritative reread still says Original
  assert.equal(h.input().props.value, 'Keep me');
  assert.equal(h.prevention.prevent, true);
  await h.close();
});

test('blur aborts a pending read and ignores its late result; refocus reloads', async () => {
  const wait = deferred(); let count = 0, signal;
  const client = { getChannelInfo(id, s) { signal = s; return ++count === 1 ? wait.promise : Promise.resolve({ id, name: 'Project', description: 'Fresh' }); } };
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.render(false);
  assert.equal(signal.aborted, true);
  await act(async () => wait.resolve({ id: 'p_one', name: 'Project', description: 'Stale' }));
  assert.equal(h.root.root.findAllByType('Markdown').length, 0);
  await h.render(true);
  assert.equal(h.root.root.findByType('Markdown').props.text, 'Fresh');
  await h.close();
});

test('temporary navigation while editing retains draft and does not reread context', async () => {
  const client = contextClient('Original');
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.press('Edit'); await h.type('Draft');
  await h.render(false); await h.render(true);
  assert.equal(h.input().props.value, 'Draft');
  assert.equal(client.reads.length, 1);
  await h.close();
});

test('pending save blocks duplicate writes and prevents navigation until verified', async () => {
  const client = contextClient('Original'), wait = deferred();
  const originalUpdate = client.updateChannel; let calls = 0;
  client.updateChannel = async (...args) => { calls++; await wait.promise; return originalUpdate(...args); };
  const h = await harness('ChannelContextScreen.tsx', 'ChannelContextScreen', client);
  await h.press('Edit'); await h.type('Saved');
  await act(async () => { h.button('Save').props.onPress(); });
  assert.equal(h.button('Saving…').props.disabled, true);
  assert.equal(h.input().props.editable, false);
  await act(async () => { h.button('Saving…').props.onPress(); h.prevention.callback({ data: { action: { type: 'GO_BACK' } } }); });
  assert.equal(calls, 1);
  assert.equal(h.alerts.length, 0);
  await act(async () => wait.resolve());
  assert.equal(h.root.root.findByType('Markdown').props.text, 'Saved');
  assert.equal(h.prevention.prevent, false);
  await h.close();
});

test('context native route validates opaque ID and uses existing keyboard-safe stack', () => {
  const route = readFileSync(new URL('../src/app/channels/[channelId]/context.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(route, /routeId\(rawId\)/);
  assert.match(route, /<FormKeyboardAvoidingView>/);
  assert.match(app, /onContext=\{id => router\.push\(\{ pathname: '\/channels\/\[channelId\]\/context'/);
  assert.match(layout, /name="channels\/\[channelId\]\/context"/);
});
