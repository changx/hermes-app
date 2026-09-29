import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const code = ts.transpileModule(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

async function harness() {
  let api, sdkCount = 0, boxCount = 0, closed = 0, sendFinish;
  const timelines = new Map(), reads = [], events = [];
  const Focus = React.createContext(true);
  const router = { push: value => events.push(['push', value]), replace: value => events.push(['replace', value]), back() {}, canGoBack: () => true };
  const config = { id: 'connection-a', baseUrl: 'https://example.test', token: 'synthetic-only' };
  const name = { name: 'Tuly', ready: true, error: '', saving: false };
  class SDK {
    constructor(options) {
      sdkCount++; this.options = options; this.connectionState = 'online'; this.supportsLatest = true;
      this.channels = new Map([['p_one', { id: 'p_one' }]]);
      this.threads = new Map(['t_one', 't_two'].map(id => [id, { id, project_id: 'p_one', title: id, last_ref: 8, read_ref: 0, unread_count: 1 }]));
      this.messages = new Map(); this.receipts = new Map(); this.interactions = new Map(); this.drafts = new Map(); this.tailIncomplete = new Set();
    }
    async connect() { this.options.onConnectionState('online'); }
    close() { closed++; }
    async historyWindow() { return { messages: [], older_cursor: null }; }
    resumeTail() {}
    async markRead(...args) { reads.push(args); }
  }
  class Box {
    constructor(storage) { boxCount++; this.storage = storage; }
    async start() {} async stop() {} reconcile() {} setConnection() {}
    enqueue() { return new Promise(resolve => { sendFinish = resolve; }); }
  }
  const exports = {};
  const mocks = {
    react: React,
    'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => router, useIsFocused: () => React.useContext(Focus),
      useFocusEffect: cb => { const focused = React.useContext(Focus); React.useEffect(() => focused ? cb() : undefined, [focused, cb]); } },
    './FontSize': { Text: 'Text', FontSizeSettings: 'FontSizeSettings' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    'expo-secure-store': { getItemAsync: async key => key === 'config' ? JSON.stringify(config) : null, deleteItemAsync: async () => {} },
    'expo-crypto': { randomUUID: () => 'synthetic-send-id' },
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String },
    './transport': { nativeTransport: () => ({}) },
    './send': { DEFAULT_BASE: config.baseUrl, connection: (baseUrl, token, id) => ({ baseUrl, token, id }), newSend: (...args) => args },
    './ConnectionScreen': { ConnectionScreen: 'ConnectionScreen' },
    './pairing': { CONFIG_KEY: 'config', PAIRING_KEY: 'pairing', restorePairing: () => null },
    './outbox': { MobileOutbox: Box, OutboxStore: class { constructor(_, config) { this.connectionId = config.id; } async clear() {} } },
    './ChatTimeline': { ChatTimeline: React.forwardRef((props, ref) => {
      timelines.set(props.threadId, props); React.useImperativeHandle(ref, () => ({ followLatest() {}, holdPosition() {} }));
      return React.createElement('Chat', { threadId: props.threadId, text: props.text });
    }) },
    './ChannelScreens': { ChannelScreens: 'ChannelScreens' },
    './timeline': { windowStart: () => 0, projectTimeline: () => [] },
    './receiptHydration': { VisibleReceiptHydrator: class { cancel() {} update() {} } },
    './Attachments': { AttachmentComposer: 'AttachmentComposer', MessageAttachments: 'MessageAttachments' },
    './TypingIndicator': { isAgentTyping: () => false, TypingIndicator: 'TypingIndicator' },
    './AgentSettings': { AgentSettings: 'AgentSettings', useAgentName: () => name },
    './ModelSettings': { ModelSettings: 'ModelSettings' },
    'expo-symbols': { SymbolView: 'SymbolView' },
  };
  runInNewContext(code, { exports, console, AbortController, require: id => { if (!(id in mocks)) throw Error(id); return mocks[id]; } });
  function Pages({ thread, settings }) {
    api = exports.useApp();
    if (!api.config || !api.client) return null;
    return React.createElement(React.Fragment, {},
      thread && React.createElement(Focus.Provider, { value: !settings }, React.createElement(exports.ThreadScreen, { key: thread, threadId: thread })),
      settings && React.createElement(exports.SettingsRoute));
  }
  let root;
  async function render(thread = 't_one', settings = false) {
    const tree = React.createElement(exports.AppProvider, {}, React.createElement(Pages, { thread, settings }));
    await act(async () => { if (root) root.update(tree); else root = create(tree); });
  }
  await render();
  return { render, timelines, reads, events, get api() { return api; }, get counts() { return { sdkCount, boxCount, closed }; },
    async finishSend() { await act(async () => sendFinish()); }, async close() { await act(async () => root.unmount()); } };
}

test('entering chat marks its latest ref read; hidden chat cannot mark read; SDK and draft survive navigation', async () => {
  const h = await harness();
  assert.deepEqual(h.reads, [['t_one', 8]]);
  await act(async () => h.timelines.get('t_one').onText('keep this draft'));
  await h.render('t_one', true);
  h.timelines.get('t_one').onVisibleRef(9);
  assert.equal(h.reads.length, 1);
  assert.equal(h.timelines.get('t_one').text, 'keep this draft');
  await h.render('t_one', false);
  h.timelines.get('t_one').onVisibleRef(9);
  assert.equal(h.reads.length, 2);
  await h.render(null);
  await h.render('t_two');
  assert.equal(h.timelines.get('t_two').text, '');
  await h.render('t_one');
  assert.equal(h.timelines.get('t_one').text, 'keep this draft');
  assert.deepEqual(h.counts, { sdkCount: 1, boxCount: 1, closed: 0 });
  await h.close();
  assert.equal(h.counts.closed, 1);
});

test('send committing behind settings clears its retained composer, preventing duplicate resend', async () => {
  const h = await harness();
  await act(async () => h.timelines.get('t_one').onText('send once'));
  await act(async () => { void h.timelines.get('t_one').onSend(); });
  await h.render('t_one', true);
  await h.finishSend();
  await h.render('t_one', false);
  assert.equal(h.timelines.get('t_one').text, '');
  assert.equal(h.timelines.get('t_one').busy, false);
  assert.equal(h.api.textDrafts.current.has('t_one'), false);
  await h.close();
});

test('forget clears identity and stops the SDK; old chat is not usable', async () => {
  const h = await harness();
  await act(async () => h.timelines.get('t_one').onText('private draft'));
  const oldIdentity = h.api.identity;
  await act(async () => h.api.forget());
  assert.equal(h.api.identity, oldIdentity + 1);
  assert.equal(h.api.config, null);
  assert.equal(h.api.client, null);
  assert.equal(h.api.textDrafts.current.size, 0);
  assert.equal(h.counts.closed, 1);
  assert.deepEqual(h.events.at(-1), ['replace', '/connection']);
  await h.close();
});
