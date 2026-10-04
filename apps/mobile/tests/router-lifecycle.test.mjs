import test from 'node:test';
import * as sessionLinks from '../../../packages/client/src/sessionLinks.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { loadRenderResources } from './render-resource-fixture.mjs';
import { build } from 'esbuild';
import * as historyBlocks from '../src/historyBlocks.ts';
import * as timeline from '../src/timeline.ts';
import * as sendNotice from '../src/sendNotice.ts';
import * as localDraftMap from '../../../packages/client/src/localDraftMap.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sdkBundle = await build({ entryPoints: [new URL('../../../packages/client/src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const sdkModule = { exports: {} }; new Function('module', 'exports', sdkBundle.outputFiles[0].text)(sdkModule, sdkModule.exports);
const { LivePageClient } = sdkModule.exports;
const code = ts.transpileModule(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

async function harness({ multiple = false, list = false, strict = false, productionOwners = false } = {}) {
  let api, sdkCount = 0, boxCount = 0, closed = 0, paused = 0, opened = 0, sendFinish, outboxChanged;
  const appListeners = new Set();
  const appState = { currentState: 'active', addEventListener: (_name, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } };
  const scenes = new Map();
  const timelines = new Map(), reads = [], events = [], retries = [];
  const Focus = React.createContext(true);
  const router = { push: value => events.push(['push', value]), replace: value => events.push(['replace', value]), back() {}, canGoBack: () => true };
  const config = { id: 'connection-a', baseUrl: 'https://example.test', token: 'synthetic-only' };
  const name = { name: 'Tuly', ready: true, error: '', saving: false };
  class SDK {
    acquirePage(id) {
      if (!multiple) return this;
      if (!this.pages.has(id)) {
        const page = Object.create(this);
        for (const field of ['messages','receipts','interactions','drafts']) page[field] = new Map();
        page.tailIncomplete = new Set();
        this.pages.set(id,page);
      }
      return this.pages.get(id);
    }
    page(id) { return multiple ? this.pages.get(id) : this; }
    releasePage(id) { if (!multiple) this.closeConversation(); else { this.pages.get(id)?.closeConversation(); this.pages.delete(id); } }
    constructor(options) {
      sdkCount++; this.options = options; this.connectionState = 'online'; this.supportsLatest = true;
      this.pages = new Map();
      this.channels = new Map([['p_one', { id: 'p_one' }]]);
      this.threads = new Map(['t_one', 't_two'].map(id => [id, { id, project_id: 'p_one', title: id, last_ref: 8, read_ref: 0, unread_count: 1 }]));
      this.messages = new Map(); this.receipts = new Map(); this.interactions = new Map(); this.drafts = new Map(); this.tailIncomplete = new Set();
    }
    async connect() { this.connectionState = 'online'; this.options.onConnectionState('online'); }
    suspendConnection() { paused++; this.connectionState = 'suspended'; this.options.onConnectionState('suspended'); }
    close() { closed++; }
    async historyWindow() { return { messages: [], older_cursor: null }; }
    async openConversation(id) { opened++; this.currentThreadId = id; this.currentConversationKey = id; this.currentOlderCursor = null; }
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
  class ProductionOwners extends LivePageClient {
    constructor(options) {
      super(options); sdkCount++;
      this.channels.set('p_one', { id: 'p_one' });
      for (const id of ['t_one', 't_two']) this.threads.set(id, { id, project_id: 'p_one', title: id, archived: false });
      this.directoryReady = true;
    }
    async connect() { this.state('online'); }
    acquirePage(id) {
      const page = super.acquirePage(id);
      // Ownership, mirrors and close are real SDK code; only network opening is
      // replaced in this native-view test. Socket/GC tests run separately.
      page.openConversation = async thread => { opened++; page.wanted = thread; page.older = null; };
      return page;
    }
    close() { closed++; super.close(); }
  }
  const exports = {};
  const mocks = {
    './RenderResources': loadRenderResources(React),
    react: React,
    '../../../packages/client/src/localDraftMap': localDraftMap,
    './localDraftStorage': { bindLocalDraftStorage: () => () => {} },
    'react-native': { Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: appState, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => router, useIsFocused: () => React.useContext(Focus),
      useFocusEffect: cb => { const focused = React.useContext(Focus); React.useEffect(() => focused ? cb() : undefined, [focused, cb]); } },
    './FontSize': { Text: 'Text', FontSizeSettings: 'FontSizeSettings' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    'expo-secure-store': { getItemAsync: async key => key === 'config' ? JSON.stringify(config) : null, deleteItemAsync: async () => {} },
    'expo-crypto': { randomUUID: () => 'synthetic-send-id' },
    'expo-clipboard': { setStringAsync: async () => {} },
    '../../../packages/client/src/sessionLinks': sessionLinks,
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String },
    '../../../packages/client/src/liveClient': { LiveSessionClient: SDK },
    '../../../packages/client/src/livePages': { LivePageClient: productionOwners ? ProductionOwners : SDK },
    './sessionNavigation': { SessionNavigationProvider: ({ children }) => children, useSessionNavigation: () => ({ thread() {}, link() {} }) },
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
    './SessionLabels': { LabelPills: 'LabelPills', LabelsEditor: 'LabelsEditor' }, './ChannelScreens': { ChannelScreens: 'ChannelScreens' },
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
  function Suspender() { throw new Promise(() => {}); }
  function Pages({ thread, settings, suspend }) {
    api = exports.useApp();
    if (!api.config || !api.client) return null;
    return React.createElement(React.Fragment, {},
      list && React.createElement(exports.ChannelsScreen, { channelId: 'p_one' }),
      thread && (Array.isArray(thread) ? thread : [thread]).map((id,index,ids) => React.createElement(Focus.Provider, { key: id, value: !settings && index === ids.length - 1 }, React.createElement(exports.ThreadScreen, { threadId: id }))),
      settings && (typeof settings === 'string' ? React.createElement('Viewer', { id: settings }) : React.createElement(exports.SettingsRoute)),
      suspend && React.createElement(Suspender));
  }
  let root;
  async function render(thread = 't_one', settings = false, suspend = false) {
    const contents = React.createElement(exports.AppProvider, {}, React.createElement(React.Suspense, { fallback: null }, React.createElement(Pages, { thread, settings, suspend })));
    const tree = strict ? React.createElement(React.StrictMode, {}, contents) : contents;
    await act(async () => { if (root) root.update(tree); else root = create(tree); });
  }
  await render();
  return { render, timelines, scenes, reads, events, retries, get api() { return api; }, get opens() { return opened; }, get pauses() { return paused; }, get counts() { return { sdkCount, boxCount, closed }; },
    get draftThreads() { return root.root.findByType('ChannelScreens').props.draftThreads; },
    async appState(value) { await act(async () => { appState.currentState = value; for (const listener of [...appListeners]) listener(value); }); },
    async revision() { await act(async () => api.client.options.onChange()); },
    async outbox(items, notice) { await act(async () => outboxChanged(items, notice)); },
    async finishSend() { await act(async () => sendFinish()); }, async close() { await act(async () => root.unmount()); } };
}

test('discarded route renders never acquire pages; committed cleanup releases all owners', async () => {
  const h = await harness({ multiple: true, productionOwners: true });
  const account = h.api.client;
  try {
    await h.render(false);
    for (let i = 0; i < 20; i++) {
      await h.render('discarded_' + i, false, true);
      assert.equal(account.pages.size, 0);
    }
    await h.render('t_one');
    assert.equal(account.pages.size, 1);
    await h.render(false);
    assert.equal(account.pages.size, 0);
  } finally { await h.close(); }
});

test('Suspense covering a committed route retains its owner and reading scene', async () => {
  const h = await harness({ multiple: true, productionOwners: true });
  try {
    const account = h.api.client, page = account.page('t_one'), scene = h.scenes.get('t_one');
    scene.offset = 345;
    await h.render(['t_one', 'discarded'], false, true);
    assert.equal(account.page('t_one'), page);
    assert.equal(account.page('discarded'), undefined);
    await h.render('t_one');
    assert.equal(account.page('t_one'), page);
    assert.equal(h.scenes.get('t_one'), scene);
    assert.equal(scene.offset, 345);
  } finally { await h.close(); }
});

test('StrictMode committed page is registered after effect replay and released on unmount', async () => {
  const h = await harness({ multiple: true, strict: true, productionOwners: true });
  const account = h.api.client;
  try {
    const page = account.page('t_one');
    assert.ok(page);
    assert.equal(page.currentThreadId, 't_one');
    assert.equal(account.pages.size, 1);
    await h.render(['t_one', 't_two']);
    assert.equal(account.page('t_one'), page);
    assert.equal(account.pages.size, 2);
    await h.render('t_one');
    assert.equal(account.page('t_one'), page);
    assert.equal(account.pages.size, 1);
  } finally { await h.close(); }
  assert.equal(account.pages.size, 0);
});

test('authoritative target removal releases owner instead of reopening a detached page', async () => {
  const h = await harness({ multiple: true, productionOwners: true });
  try {
    const account = h.api.client, page = account.page('t_one'), scene = h.scenes.get('t_one');
    account.threads.delete('t_one');
    await h.revision();
    assert.equal(account.page('t_one'), undefined);
    assert.equal(page.messages.size, 0);
    assert.equal(scene.disposed, true);
    const count = h.opens;
    await h.revision();
    assert.equal(h.opens, count);
  } finally { await h.close(); }
});

test('typing and directory revisions reuse timeline rows; receipt updates still change reactions', async () => {
  const h = await harness({ multiple: true });
  try {
    const page = h.api.client.page('t_one');
    page.messages.set('t_one', [{ id: 'input', ref_seq: 1, role: 'user', text: 'hello', receipt_id: 'r', client_message_id: 'c', attachments: [] }]);
    await h.revision();
    const rows = h.timelines.get('t_one').rows;
    await act(async () => h.timelines.get('t_one').onText('typing'));
    assert.equal(h.timelines.get('t_one').rows, rows);
    await h.revision();
    assert.equal(h.timelines.get('t_one').rows, rows);
    page.receipts.set('r', { id: 'r', thread_id: 't_one', client_message_id: 'c', state: 'running', processing: 'running', durable: true });
    await h.revision();
    assert.notEqual(h.timelines.get('t_one').rows, rows);
    assert.equal(h.timelines.get('t_one').rows[0].reaction.label, 'Working');
  } finally { await h.close(); }
});

test('list observes local composer drafts, isolates connections and clears after durable send', async () => {
  const h = await harness({ list: true, multiple: true });
  try {
    const ids = () => Array.from(h.draftThreads).sort();
    assert.deepEqual(ids(), []);
    await act(async () => h.timelines.get('t_one').onText(' \n '));
    assert.deepEqual(ids(), []);
    await act(async () => h.timelines.get('t_one').onText('unfinished'));
    assert.deepEqual(ids(), ['t_one']);
    await h.render(['t_one', 't_two']);
    assert.deepEqual(ids(), ['t_one']);
    await act(async () => h.api.composerDrafts.current.set('connection-a:t_two', { items: [{ id: 1 }], files: [] }));
    assert.deepEqual(ids(), ['t_one', 't_two']);
    await act(async () => h.api.textDrafts.current.set('connection-b:foreign', 'private other connection'));
    assert.deepEqual(ids(), ['t_one', 't_two']);
    await h.render('t_one');
    await act(async () => { void h.timelines.get('t_one').onSend(); });
    assert.deepEqual(ids(), ['t_one', 't_two'], 'pending storage must retain draft');
    await h.finishSend();
    assert.deepEqual(ids(), ['t_two']);
    await act(async () => h.api.composerDrafts.current.delete('connection-a:t_two'));
    assert.deepEqual(ids(), []);
    assert.deepEqual(h.reads, []);
  } finally { await h.close(); }
});

test('two mounted session routes retain independent scenes; returning A releases only B', async () => {
  const h = await harness({ multiple: true });
  try {
    const a = h.api.client.page('t_one'), scene = h.scenes.get('t_one');
    scene.offset = 240; scene.following = false; scene.selection = 'retained';
    await h.render(['t_one','t_two']);
    assert.equal(h.api.client.page('t_one'),a);
    assert.equal(h.scenes.get('t_one'),scene); assert.equal(scene.disposed,undefined);
    const b = h.api.client.page('t_two'); assert.ok(b); assert.notEqual(a,b);
    const opens = h.opens; await h.render('t_one');
    assert.equal(h.opens,opens); assert.equal(h.api.client.page('t_two'),undefined);
    assert.equal(h.scenes.get('t_one'),scene); assert.equal(scene.offset,240);
    assert.equal(scene.following,false); assert.equal(scene.selection,'retained');
  } finally { await h.close(); }
});

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

test('covered chat retains its scene; actual route removal releases content and user draft survives', async () => {
  const h = await harness();
  assert.deepEqual(h.reads, []);
  await act(async () => h.timelines.get('t_one').onText('keep this draft'));
  await h.render('t_one', true);
  assert.equal(h.api.client.currentThreadId, 't_one');
  assert.equal(h.timelines.get('t_one').text, 'keep this draft');
  await h.render('t_one', false);
  assert.equal(h.timelines.get('t_one').onVisibleRef, undefined);
  assert.equal(h.reads.length, 0);
  await h.render(null);
  assert.equal(h.api.client.currentThreadId, null);
  assert.equal(h.api.client.messages.size, 0);
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
    await h.render('t_one',true);assert.notEqual(scene.disposed,true);await h.render(null);assert.equal(scene.disposed,true);assert.equal(h.api.client.messages.size,0);
  } finally { await h.close(); }
});

test('tool detail and nested readers preserve the current session scene without reopening on return', async () => {
  const h = await harness();
  try {
    h.api.client.messages.set('t_one', Array.from({length:20},(_,index)=>({id:'m'+index,ref_seq:index+1,role:index%2===0?'user':'assistant',text:'synthetic '+index})));
    await h.revision(); await act(async()=>h.timelines.get('t_one').onOlder());
    await act(async()=>h.timelines.get('t_one').onText('reader draft'));
    const scene=h.scenes.get('t_one'),messages=h.api.client.messages.get('t_one'),opens=h.opens;
    scene.offset=456;scene.following=false;const media=scene.media;
    await h.render('t_one','tool-detail');
    assert.equal(scene.disposed,undefined);assert.equal(h.api.client.currentThreadId,'t_one');assert.equal(h.api.client.messages.get('t_one'),messages);
    await h.render('t_one','nested-detail');await h.appState('background');await h.appState('active');
    await h.render('t_one','tool-detail');await h.render('t_one',false);
    assert.equal(h.scenes.get('t_one'),scene);assert.equal(scene.offset,456);assert.equal(scene.following,false);assert.equal(scene.media,media);
    assert.equal(h.timelines.get('t_one').startRef,1);assert.equal(h.timelines.get('t_one').text,'reader draft');assert.equal(h.opens,opens);
    await h.render(null);assert.equal(scene.disposed,true);assert.equal(h.api.client.messages.size,0);
    await h.render('t_one','standalone');assert.equal(h.api.client.currentThreadId,null);assert.equal(h.opens,opens);
  } finally { await h.close(); }
});

test('viewer cannot keep old conversation content after another session takes ownership or identity is forgotten', async () => {
  const h = await harness();
  try {
    const scene=h.scenes.get('t_one');await h.render('t_one','tool-detail');
    h.api.client.currentThreadId='t_two';h.api.client.currentConversationKey={};h.api.client.messages.clear();await h.revision();assert.notEqual(scene.disposed,true);assert.equal(h.api.client.currentThreadId,'t_two');
    const opens=h.opens;await h.render('t_one');assert.equal(h.opens,opens+1);assert.equal(h.api.client.currentThreadId,'t_one');
    await h.render('t_two');const second=h.scenes.get('t_two');await h.render('t_two','second');
    await act(async()=>h.api.forget());assert.equal(second.disposed,true);assert.equal(h.api.client,null);
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
