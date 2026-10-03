import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import * as historyBlocks from '../src/historyBlocks.ts';
import * as timeline from '../src/timeline.ts';
import * as sendNotice from '../src/sendNotice.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const code = ts.transpileModule(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

async function harness() {
  let api, sdkCount = 0, boxCount = 0, closed = 0, paused = 0, sendFinish, outboxChanged;
  const appListeners = new Set();
  const appState = { currentState: 'active', addEventListener: (_name, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } };
  const scenes = new Map();
  const timelines = new Map(), reads = [], events = [], retries = [];
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
    async connect() { this.connectionState = 'online'; this.options.onConnectionState('online'); }
    suspendConnection() { paused++; this.connectionState = 'suspended'; this.options.onConnectionState('suspended'); }
    close() { closed++; }
    async historyWindow() { return { messages: [], older_cursor: null }; }
    async openConversation(id) { this.currentThreadId = id; this.currentConversationKey = id; this.currentOlderCursor = null; }
    closeConversation() { this.currentThreadId = null; this.messages.clear(); this.receipts.clear(); this.interactions.clear(); }
    resumeTail() {}
    async markRead(...args) { reads.push(args); }
  }
  class Box {
    constructor(storage, _sdk, changed) { boxCount++; this.storage = storage; outboxChanged = changed; }
    async start() {} async stop() {} reconcile() {} setConnection() {}
    enqueue() { return new Promise(resolve => { sendFinish = resolve; }); }
    async retryFailed(...args) { retries.push(args); }
  }
  const exports = {};
  const mocks = {
    react: React,
    'react-native': { Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: appState, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => router, useIsFocused: () => React.useContext(Focus),
      useFocusEffect: cb => { const focused = React.useContext(Focus); React.useEffect(() => focused ? cb() : undefined, [focused, cb]); } },
    './FontSize': { Text: 'Text', FontSizeSettings: 'FontSizeSettings' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    'expo-secure-store': { getItemAsync: async key => key === 'config' ? JSON.stringify(config) : null, deleteItemAsync: async () => {} },
    'expo-crypto': { randomUUID: () => 'synthetic-send-id' },
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String },
    '../../../packages/client/src/liveClient': { LiveSessionClient: SDK },
    './transport': { nativeTransport: () => ({}) },
    './send': { DEFAULT_BASE: config.baseUrl, connection: (baseUrl, token, id) => ({ baseUrl, token, id }), newSend: (...args) => args },
    './ConnectionScreen': { ConnectionScreen: 'ConnectionScreen' },
    './pairing': { CONFIG_KEY: 'config', PAIRING_KEY: 'pairing', restorePairing: () => null },
    './outbox': { MobileOutbox: Box, OutboxStore: class { constructor(_, config) { this.connectionId = config.id; } async clear() {} } },
    './ChatTimeline': { ChatTimeline: React.forwardRef((props, ref) => {
      const scene = React.useRef({ offset: 0, following: true, media: {}, selection: null }); scenes.set(props.threadId, scene.current);
      React.useEffect(() => () => { scene.current.disposed = true; }, []);
      timelines.set(props.threadId, props); React.useImperativeHandle(ref, () => ({ followLatest() {}, holdPosition() {} }));
      return React.createElement('Chat', { threadId: props.threadId, text: props.text });
    }) },
    './ChannelScreens': { ChannelScreens: 'ChannelScreens' },
    './historyBlocks': historyBlocks,
    './timeline': timeline,
    './sendNotice': sendNotice,
    './receiptHydration': { VisibleReceiptHydrator: class { cancel() {} update() {} } },
    './Attachments': { AttachmentComposer: 'AttachmentComposer', MessageAttachments: 'MessageAttachments', releaseComposerDraft() {} },
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
  return { render, timelines, scenes, reads, events, retries, get api() { return api; }, get pauses() { return paused; }, get counts() { return { sdkCount, boxCount, closed }; },
    async appState(value) { await act(async () => { appState.currentState = value; for (const listener of [...appListeners]) listener(value); }); },
    async revision() { await act(async () => api.client.options.onChange()); },
    async outbox(items, notice) { await act(async () => outboxChanged(items, notice)); },
    async finishSend() { await act(async () => sendFinish()); }, async close() { await act(async () => root.unmount()); } };
}

test('App retry handler addresses exact thread/connection and refuses stale hidden or forgotten scene', async () => {
  const h = await harness();
  try {
    const retry = h.timelines.get('t_one').onRetryFailed;
    await act(async () => retry('original-id'));
    assert.deepEqual(h.retries, [['t_one', 'original-id']]);
    await h.render('t_one', true);
    await act(async () => retry('hidden-id'));
    assert.equal(h.retries.length, 1);
    await h.render('t_two');
    await act(async () => h.timelines.get('t_two').onRetryFailed('second-id'));
    assert.deepEqual(h.retries.at(-1), ['t_two', 'second-id']);
    const oldRetry = h.timelines.get('t_two').onRetryFailed;
    await act(async () => h.api.forget());
    await act(async () => oldRetry('forgotten-id'));
    assert.equal(h.retries.length, 2);
  } finally { await h.close(); }
});

test('App clears resolved failed-send banner across navigation but preserves actual storage failure', async () => {
  const h = await harness();
  try {
    const notice = 'Sending could not be confirmed. Check your connection permissions or message.';
    await h.outbox([{ status: 'blocked' }], notice);
    assert.equal(h.api.error, notice);
    await h.outbox([]);
    assert.equal(h.api.error, '');
    await h.render(null); await h.render('t_one');
    assert.equal(h.api.error, '');
    const failure = 'Your received message could not be updated here. Keep your app data.';
    await h.outbox([], failure); await h.outbox([]);
    assert.equal(h.api.error, failure);
  } finally { await h.close(); }
});

test('hidden chat unmounts its timeline and releases content; SDK and user draft survive navigation without read reporting', async () => {
  const h = await harness();
  assert.deepEqual(h.reads, []);
  await act(async () => h.timelines.get('t_one').onText('keep this draft'));
  await h.render('t_one', true);
  assert.equal(h.api.client.currentThreadId, null);
  assert.equal(h.api.client.messages.size, 0);
  assert.equal(h.timelines.get('t_one').text, 'keep this draft');
  await h.render('t_one', false);
  assert.equal(h.timelines.get('t_one').onVisibleRef, undefined);
  assert.equal(h.reads.length, 0);
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
  assert.equal(h.api.textDrafts.current.has('connection-a:t_one'), false);
  await h.close();
});

test('background and foreground retain timeline instance, older reading boundary, draft and media scene', async () => {
  const h = await harness();
  try {
    h.api.client.messages.set('t_one', Array.from({length:20},(_,index)=>({id:'m'+index,ref_seq:index+1,role:index%2===0?'user':'assistant',text:'synthetic '+index})));
    await h.revision(); await act(async()=>h.timelines.get('t_one').onOlder());
    assert.equal(h.timelines.get('t_one').startRef,1);
    await act(async()=>h.timelines.get('t_one').onText('keep selected draft'));
    const scene=h.scenes.get('t_one');scene.offset=234;scene.following=false;scene.selection={start:3,end:6};const media=scene.media;
    const messages=h.api.client.messages.get('t_one'),owner=h.api.client.currentConversationKey;
    await h.appState('inactive');await h.appState('background');
    assert.equal(h.scenes.get('t_one'),scene);assert.notEqual(scene.disposed,true);assert.equal(h.api.client.messages.get('t_one'),messages);assert.equal(h.api.client.currentConversationKey,owner);assert.equal(h.counts.closed,0);
    await h.appState('active');assert.equal(h.scenes.get('t_one'),scene);assert.equal(scene.offset,234);assert.equal(scene.following,false);assert.equal(scene.media,media);assert.deepEqual(scene.selection,{start:3,end:6});assert.equal(h.timelines.get('t_one').startRef,1);assert.equal(h.timelines.get('t_one').text,'keep selected draft');
    await h.render('t_one',true);assert.equal(scene.disposed,true);assert.equal(h.api.client.messages.size,0);
  } finally { await h.close(); }
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
