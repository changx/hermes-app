import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { labels } from './session-labels-fixture.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; return { promise: new Promise((a, b) => { resolve = a; reject = b; }), resolve: v => resolve(v), reject: e => reject(e) }; };
const row = (id, markers, at, project = 'p') => ({ id, project_id: project, title: id, markers, markers_updated_at: 0, last_message_at: at, last_ref: 0 });

async function harness(name, initialProps) {
  let clockCalls = 0, focus = true;
  const alerts = [], Focus = React.createContext(true);
  const mocks = { react: React,
    'react-native': { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
      Platform: { OS: 'ios' }, StyleSheet: { create: x => x }, Alert: { alert: (...args) => alerts.push(args) },
      FlatList: props => React.createElement('List', props, props.ListHeaderComponent, props.data.map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item })))) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 34 }) },
    'expo-router': { useIsFocused: () => React.useContext(Focus), useFocusEffect: fn => { const focused = React.useContext(Focus); React.useEffect(() => focused ? fn() : undefined, [fn, focused]); } },
    'expo-symbols': { SymbolView: 'Symbol' }, './FontSize': { Text: 'Text', TextInput: 'TextInput' },
    '../../../packages/client/src/sessionLabels': labels, './MessageTime': { MessageTime: 'Time' },
    './channel-edits': { threadPatch: title => ({ title }) }, './NewTopicComposer': { NewTopicComposer: 'Composer' },
  };
  function load(file) {
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
      { exports, console, Error, AbortController, Date: class extends Date { static now() { clockCalls++; return 1234; } }, require: id => { assert.ok(id in mocks, id); return mocks[id]; } });
    return exports;
  }
  const module = load('SessionLabels.tsx'); mocks['./SessionLabels'] = module;
  const component = name === 'ChannelScreens' ? load('ChannelScreens.tsx')[name] : module[name];
  let root, props = initialProps;
  const render = async (overrides = {}) => act(async () => { props = { ...props, ...overrides }; const element = React.createElement(Focus.Provider, { value: focus }, React.createElement(component, props)); if (root) root.update(element); else root = create(element); });
  await render();
  const button = label => root.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
  return { get root() { return root; }, module, alerts, get clockCalls() { return clockCalls; }, render, button,
    async press(label) { const b = button(label); assert.ok(b, label); assert.ok(!b.props.disabled, label); await act(async () => b.props.onPress()); },
    async type(value) { await act(async () => root.root.findAllByType('TextInput').find(n => n.props.accessibilityLabel === 'Label text').props.onChangeText(value)); },
    text() { return root.root.findAllByType('Text').map(n => [n.props.accessibilityLabel, ...React.Children.toArray(n.props.children).filter(c => typeof c === 'string' || typeof c === 'number')].join('')).join(' ') + root.root.findAllByType('Pressable').map(n => n.props.accessibilityLabel).join(' '); }, async focus(value) { focus = value; await render(); }, async close() { await act(async () => root.unmount()); } };
}
function clientFixture() {
  const saves = [];
  const client = { connectionState: 'online', supportsSessionLabels: true, channels: new Map([['p', { id: 'p', name: 'P' }], ['q', { id: 'q', name: 'Q' }]]),
    threads: new Map([['A', row('A', ['Original'], 1)], ['B', row('B', ['Reuse'], 3)], ['Empty', row('Empty', [], 2)], ['Foreign', row('Foreign', ['Other channel'], 5, 'q')]]),
    isThreadAvailable(id) { return this.threads.has(id) && !this.threads.get(id).archived; },
    async saveThreadLabels(id, markers, time, signal) { saves.push({ id, markers, time, signal }); return { markers, markers_updated_at: time }; } };
  return { client, saves };
}

test('production editor adds/edits/removes/clears/reuses exact labels; Date.now only on Save', async () => {
  const f = clientFixture(); let closed = 0;
  const h = await harness('LabelsEditor', { client: f.client, threadId: 'A', onClose: () => closed++ });
  try {
    assert.equal(h.clockCalls, 0); assert.ok(h.root.root.findAllByType('View').some(n => n.props.accessibilityViewIsModal === true));
    await h.type(' Foo '); await h.press('Add'); assert.ok(h.text().includes(' Foo '));
    await h.type(' Foo '); await h.press('Add'); assert.ok(h.text().includes('already in this list'));
    await h.type('foo'); await h.press('Add');
    await h.press('Edit label Original'); await h.type('👩🏽‍💻'); await h.press('Update');
    await h.press('Remove label foo'); await h.press('Reuse label Reuse');
    assert.equal(h.clockCalls, 0); await h.press('Save');
    assert.deepEqual(plain(f.saves[0].markers), ['👩🏽‍💻', ' Foo ', 'Reuse']); assert.equal(f.saves[0].time, 1234); assert.equal(closed, 1);
    assert.deepEqual(f.client.threads.get('A').markers, ['Original']); // editor has no directory authority
    await h.press('Clear labels'); await h.press('Save'); assert.deepEqual(plain(f.saves[1].markers), []);
  } finally { await h.close(); }
});
test('failed and stale saves preserve draft, guard duplicate submissions, and disable offline editing', async () => {
  const f = clientFixture(), gate = deferred(); let closed = 0, calls = 0;
  f.client.saveThreadLabels = async () => { calls++; return gate.promise; };
  const h = await harness('LabelsEditor', { client: f.client, threadId: 'A', onClose: () => closed++ });
  try {
    await h.type('Draft'); await h.press('Add');
    const save = h.button('Save').props.onPress;
    await act(async () => { save(); save(); }); assert.equal(calls, 1);
    await act(async () => { gate.reject(new Error('synthetic failure')); });
    assert.equal(closed, 0); assert.ok(h.text().includes('Draft')); assert.ok(h.text().includes('Could not confirm'));
    f.client.saveThreadLabels = async () => ({ markers: ['Remote'] });
    await h.press('Save'); assert.equal(closed, 0); assert.ok(h.text().includes('changed on another device')); assert.ok(h.text().includes('Draft'));
    f.client.connectionState = 'retrying'; await h.render(); assert.equal(h.button('Save').props.disabled, true);
    assert.equal(h.root.root.findByType('TextInput').props.editable, false); assert.equal(h.button('Add').props.disabled, true);
    await h.press('Cancel'); assert.equal(closed, 1);
  } finally { await h.close(); }
});
test('unsubmitted label edit blocks save and cancellation sends no requests', async () => {
  const f = clientFixture(), h = await harness('LabelsEditor', { client: f.client, threadId: 'A', onClose() {} });
  try { await h.type('Pending'); await h.press('Save'); assert.equal(f.saves.length, 0); assert.equal(h.clockCalls, 0); await h.press('Cancel'); assert.equal(f.saves.length, 0); }
  finally { await h.close(); }
});
test('Channel filter uses current Channel candidates, OR/No labels, newest-first and retains composer instance', async () => {
  const f = clientFixture(), opens = [], h = await harness('ChannelScreens', { client: f.client, channelId: 'p', onThread: id => opens.push(id), onContext() {}, onFiles() {}, onAgents() {}, enqueueFirstMessage: async () => {} });
  try {
    const composer = h.root.root.findByType('Composer');
    const filter = () => h.root.root.findByType(h.module.LabelsFilter);
    assert.deepEqual(plain(filter().props.rows.map(t => t.id)), ['B', 'Empty', 'A']);
    assert.ok(!h.text().includes('Other channel'));
    await act(async () => filter().props.onChange({ labels: ['Original'], noLabels: true }));
    assert.deepEqual(plain(h.root.root.findByType('List').props.data.map(t => t.id)), ['Empty', 'A']);
    assert.equal(h.root.root.findByType('Composer'), composer); assert.deepEqual(opens, []);
    const session = h.root.root.findAllByType('Pressable').find(n => n.props.onLongPress && n.props.accessibilityLabel?.startsWith('A,'));
    await act(async () => session.props.onLongPress());
    assert.ok(h.alerts.at(-1)[2].some(action => action.text === 'Edit labels'));
    await act(async () => h.alerts.at(-1)[2].find(action => action.text === 'Edit labels').onPress());
    assert.equal(h.root.root.findByType(h.module.LabelsEditor).props.threadId, 'A');
    const other = clientFixture(); await h.render({ client: other.client });
    assert.equal(h.root.root.findAllByType(h.module.LabelsEditor).length, 0);
    assert.deepEqual(plain(filter().props.value), { labels: [], noLabels: false });
    other.client.supportsSessionLabels = false; await h.render(); assert.equal(h.root.root.findAllByType(h.module.LabelsFilter).length, 0);
  } finally { await h.close(); }
});
test('production filter candidates remain exact and searchable; clear has a separate No labels selection', async () => {
  let value = { labels: [], noLabels: false };
  const h = await harness('LabelsFilter', { rows: [row('A', ['Foo', 'foo', 'No labels'], 1)], value, onChange(next) { value = next; } });
  try {
    await act(async () => h.root.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === 'Label: Foo').props.onPress());
    await h.render({ value }); assert.deepEqual(plain(value.labels), ['Foo']);
    await act(async () => h.root.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === 'No labels').props.onPress());
    await h.render({ value }); assert.equal(value.noLabels, true); assert.deepEqual(plain(value.labels), ['Foo']);
    await act(async () => h.root.root.findByType('TextInput').props.onChangeText('foo')); assert.ok(h.text().includes('Label: Foo')); assert.ok(h.text().includes('Label: foo'));
    await h.press('Clear filters'); assert.deepEqual(plain(value), { labels: [], noLabels: false });
  } finally { await h.close(); }
});
test('production pills use layout measurements, truncate long text and never own row touches', async () => {
  const h = await harness('LabelPills', { markers: ['Long label', 'Second', 'Third'] });
  try {
    const outer = h.root.root.findAllByType('View').find(n => n.props.pointerEvents === 'none');
    await act(async () => { outer.props.onLayout({ nativeEvent: { layout: { width: 190 } } });
      for (const text of h.root.root.findAllByType('Text').filter(n => n.props.onLayout)) text.props.onLayout({ nativeEvent: { layout: { width: String(text.props.children).startsWith('+') ? 28 : 120, height: 32 } } }); });
    const rendered = h.root.root.findAllByType('Text').filter(n => n.props.numberOfLines === 1);
    assert.equal(rendered.length, 2); assert.equal(React.Children.toArray(rendered.at(-1).props.children).join(''), '+2'); assert.equal(rendered[0].props.ellipsizeMode, 'tail');
    assert.equal(outer.props.style.at(-1).height, 32);
    await h.render({ markers: [] }); assert.equal(h.root.root.findAllByType('View').length, 0);
  } finally { await h.close(); }
});
