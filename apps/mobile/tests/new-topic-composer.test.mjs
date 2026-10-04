import { labels, labelComponentStubs } from './session-labels-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { newSend } from '../src/send.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const code = ts.transpileModule(readFileSync(new URL('../src/NewTopicComposer.tsx', import.meta.url), 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
async function harness(overrides = {}) {
  let focused = true, sequence = 0, mounts = 0, uploads = [], selected = [];
  const calls = [], opened = [], queued = [];
  function Input(props) {
    React.useEffect(() => { mounts++; }, []);
    return React.createElement('Input', props);
  }
  function Attachments(props) {
    React.useEffect(() => {
      props.handleRef.current = { uploadTo: async thread => { uploads.push(thread); return selected.map(item => ({ ...item, thread_id: thread })); } };
      return () => { props.handleRef.current = null; };
    }, []);
    React.useEffect(() => { selected = []; }, [props.clearKey]);
    return React.createElement('Attachments', props, props.children);
  }
  const modules = {
    react: React, 'react-native': { Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { useIsFocused: () => focused },
    'expo-crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    './FontSize': { Text: 'Text', TextInput: Input }, './Attachments': { AttachmentComposer: Attachments },
  };
  const exports = {};
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  const client = { async createThread(channel, title, id) { calls.push(['create', channel, title, id]); return { id }; }, async getThread(id) { calls.push(['get', id]); }, ...overrides.client };
  const props = { client, channelId: 'p_one', enqueue: async (...args) => queued.push(args), onCreated: id => opened.push(id), ...overrides };
  props.client = client;
  let tree;
  await act(async () => { tree = create(React.createElement(exports.NewTopicComposer, props)); });
  const input = () => tree.root.findByType('Input');
  const attachment = () => tree.root.findByType('Attachments');
  const button = () => tree.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === 'Send');
  return { calls, opened, queued, uploads, input, attachment, button, get mounts() { return mounts; },
    async type(text) { await act(async () => input().props.onChangeText(text)); },
    async send() { await act(async () => { button().props.onPress(); }); },
    async pick() { await act(async () => { selected = [{ id: 'att_one', name: 'photo.png', mime: 'image/png', size: 2, state: 'available', receipt_id: null }]; attachment().props.onSelectionChange(1); }); },
    async focus(value) { focused = value; await act(async () => tree.update(React.createElement(exports.NewTopicComposer, props))); },
    async close() { await act(async () => tree.unmount()); },
  };
}

test('production channel list docks the composer below a top-first list and leaves channel creation unchanged', async () => {
  const source = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
  const modules = {
    react: React, 'react-native': { FlatList: 'List', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { useIsFocused: () => true, useFocusEffect: cb => React.useEffect(cb, [cb]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    './FontSize': { Text: 'Text', TextInput: 'Input' }, './NewTopicComposer': { NewTopicComposer: 'Composer' },
    './channel-edits': { channelPatch: () => ({}), threadPatch: () => ({}) }, '../../../packages/client/src/sessionLabels': labels, './SessionLabels': labelComponentStubs, './MessageTime': { MessageTime: 'Time' },
    'expo-symbols': { SymbolView: 'Symbol' }, './threadListState': { isThreadRunning: () => false },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  const client = { channels: new Map([['p_one', { name: 'Channel one' }]]), threads: new Map(), receipts: new Map() };
  const props = { client, channelId: 'p_one', onChannel() {}, onThread() {}, onNewChannel() {}, enqueueFirstMessage: async () => {} };
  let tree;
  await act(async () => { tree = create(React.createElement(exports.ChannelScreens, props)); });
  const list = tree.root.findByType('List'), composer = tree.root.findByType('Composer');
  assert.equal(list.props.style.flex, 1); assert.equal(list.props.maintainVisibleContentPosition, undefined);
  assert.equal(list.props.inverted, undefined);
  assert.equal(composer.props.enqueue, props.enqueueFirstMessage); assert.equal(composer.props.onCreated, props.onThread);
  assert.equal(composer.parent.children.indexOf(composer) > list.parent.children.indexOf(list), true);
  assert.equal(tree.root.findAllByType('Pressable').some(n => n.props.accessibilityLabel === 'New topic'), false);
  await act(async () => tree.update(React.createElement(exports.ChannelScreens, { ...props, channelId: null })));
  assert.equal(tree.root.findAllByType('Composer').length, 0);
  assert.ok(tree.root.findAllByType('Pressable').some(n => n.props.accessibilityLabel === 'New channel'));
  await act(async () => tree.unmount());
});

test('inline composer starts unfocused, is multiline/bounded and disallows empty send', async () => {
  const h = await harness();
  assert.equal(h.input().props.autoFocus, undefined); assert.equal(h.input().props.multiline, true);
  assert.equal(h.input().props.placeholder, 'Start a new conversation…');
  assert.equal(h.input().props.style.maxHeight, 102);
  assert.equal(h.button().props.disabled, true);
  await h.send(); assert.equal(h.calls.length, 0);
  await h.type('  \n'); await h.send(); assert.equal(h.calls.length, 0);
  await h.close();
});

test('first message creates, hydrates, stages attachments and enters only after durable enqueue', async () => {
  const commit = deferred();
  const h = await harness({ enqueue: async (...args) => { h.queued.push(args); await commit.promise; } });
  await h.type('第一条消息\nsecond line'); await h.pick();
  const send = h.button().props.onPress;
  await act(async () => { send(); send(); });
  assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(h.queued.length, 1); assert.equal(h.opened.length, 0);
  assert.equal(h.input().props.editable, false);
  assert.equal(h.queued[0][2], '第一条消息\nsecond line');
  assert.equal(h.queued[0][3][0].id, 'att_one');
  await act(async () => commit.resolve());
  assert.deepEqual(h.opened, [h.queued[0][0]]);
  assert.equal(h.input().props.value, ''); assert.equal(h.button().props.disabled, true);
  assert.equal(h.calls.filter(c => c[0] === 'get').length, 1, 'no failure-prone read after enqueue');
  await h.type('another'); await h.send();
  assert.notEqual(h.queued[1][0], h.queued[0][0]); assert.notEqual(h.queued[1][1], h.queued[0][1]);
  await h.close();
});

test('attachment-only conversation uses the same complete attachment composer', async () => {
  const h = await harness();
  assert.equal(h.attachment().props.threadId, null);
  await h.pick(); assert.equal(h.button().props.disabled, false);
  await h.send(); assert.equal(h.queued[0][2], ''); assert.equal(h.queued[0][3].length, 1);
  await h.close();
});

test('creation response loss retries the same thread identity and retains draft', async () => {
  let fail = true;
  const ids = [];
  const h = await harness({ client: { async createThread(channel, title, id) { ids.push(id); if (fail) throw new Error('lost response'); return { id }; } } });
  await h.type('keep me'); await h.send(); assert.equal(h.input().props.value, 'keep me'); assert.equal(h.opened.length, 0);
  fail = false; await h.send(); assert.equal(ids[0], ids[1]); assert.equal(h.queued.length, 1);
  await h.close();
});

test('queue failure retries the same message and thread, without another creation', async () => {
  let fail = true;
  const h = await harness({ enqueue: async (...args) => { h.queued.push(args); if (fail) throw new Error('storage unavailable'); } });
  await h.type('original'); await h.pick(); await h.send();
  assert.equal(h.input().props.value, 'original'); assert.equal(h.opened.length, 0);
  assert.equal(h.input().props.editable, false); assert.equal(h.attachment().props.disabled, true);
  await h.type('cannot change a possibly committed identity');
  await act(async () => h.attachment().props.onPasteText('cannot paste'));
  assert.equal(h.input().props.value, 'original');
  fail = false; await h.send();
  assert.deepEqual(h.queued[0], h.queued[1]); assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'get').length, 1, 'sealed retry needs no network hydration');
  await h.close();
});

test('native Stack retention keeps text and attachments across blur without remount or cross-channel leakage', async () => {
  const one = await harness(), two = await harness({ channelId: 'p_two' });
  await one.type('channel one draft'); await one.pick(); const first = one.input();
  await one.focus(false); await one.send(); assert.equal(one.calls.length, 0);
  await one.focus(true); assert.equal(one.input(), first); assert.equal(one.mounts, 1);
  assert.equal(one.input().props.value, 'channel one draft'); assert.equal(one.button().props.disabled, false);
  assert.equal(two.input().props.value, ''); assert.equal(two.button().props.disabled, true);
  await one.send(); assert.equal(one.queued[0][3].length, 1);
  await one.close(); await two.close();
});

test('late durable commit clears retained draft but does not hijack another screen', async () => {
  const commit = deferred();
  const h = await harness({ enqueue: () => commit.promise });
  await h.type('message'); await h.send(); await h.focus(false);
  await act(async () => commit.resolve());
  assert.equal(h.opened.length, 0); await h.focus(true); assert.equal(h.input().props.value, '');
  await h.close();
});

test('unmount before create response cannot upload or enqueue from the old channel', async () => {
  const creation = deferred();
  const h = await harness({ client: { createThread: () => creation.promise } });
  await h.type('old channel'); await h.send(); await h.close();
  await act(async () => creation.resolve({ id: 'th_old' }));
  assert.equal(h.uploads.length, 0); assert.equal(h.queued.length, 0); assert.equal(h.opened.length, 0);
});

test('menu paste replaces text selection and retained keyboard updates preserve input identity', async () => {
  const h = await harness(); await h.type('hello world');
  const first = h.input();
  await act(async () => { first.props.onSelectionChange({ nativeEvent: { selection: { start: 6, end: 11 } } }); h.attachment().props.onPasteText('世界'); });
  assert.equal(h.input().props.value, 'hello 世界'); assert.equal(h.input(), first);
  await h.close();
});

test('production composer feeds the real outbox with test storage and recovers offline enqueue', async () => {
  const config = { id: 'conn_one', baseUrl: 'https://example.test', token: 'synthetic-only' };
  const data = new Map();
  const store = { async getItemAsync(k) { return data.get(k) ?? null; }, async setItemAsync(k, v) { data.set(k, v); }, async deleteItemAsync(k) { data.delete(k); } };
  const sdk = { receipts: new Map(), messages: new Map(), supportsSendIdentity: true };
  const box = new MobileOutbox(new OutboxStore(store, config), sdk, () => {});
  await box.start(); box.setConnection('suspended');
  const h = await harness({ enqueue: (thread, id, text, attachments) => box.enqueue(newSend(config, thread, text, id, attachments)) });
  await h.type('offline after thread creation'); await h.pick(); await h.send();
  assert.equal(h.opened.length, 1); assert.equal(box.records.length, 1);
  await box.stop();
  const restored = new OutboxStore(store, config); const rows = await restored.load();
  assert.equal(rows.length, 1); assert.equal(rows[0].threadId, h.opened[0]);
  assert.equal(rows[0].text, 'offline after thread creation'); assert.equal(rows[0].attachments[0].id, 'att_one');
  assert.equal(rows[0].status, 'queued'); await h.close();
});
