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
import * as timeline from '../src/timeline.ts';
import * as sendNotice from '../src/sendNotice.ts';
import * as sendErrors from '../../../packages/client/src/sendErrors.ts';
import * as sessionHeaderItems from '../src/sessionHeaderItems.ts';
import * as localDraftMap from '../../../packages/client/src/localDraftMap.ts';
import * as todo from '../../../packages/client/src/todo.ts';


globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const agentTyping = { value: false };
const sdkBundle = await build({ entryPoints: [new URL('../../../packages/client/src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const sdkModule = { exports: {} }; new Function('module', 'exports', sdkBundle.outputFiles[0].text)(sdkModule, sdkModule.exports);
const { LivePageClient } = sdkModule.exports;
const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const code = transpile('../src/App.tsx'), connectionsCode = transpile('../src/connections.tsx'), navigationCode = transpile('../src/sessionNavigation.tsx');
const receiptStateModule = {}; runInNewContext(transpile('../src/receiptState.ts'), { exports: receiptStateModule });
const pageUpdatesModule = {}; runInNewContext(transpile('../src/pageUpdates.ts'), { exports: pageUpdatesModule, require: id => { if (id === 'react') return React; throw Error(id); } });
// Controllable clock/timers for the activity window only; everything else uses real timers.
const activityClock = { now: 1_000_000, timers: new Map(), next: 0 };
const advanceActivity = ms => { activityClock.now += ms; for (const [id, timer] of [...activityClock.timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= activityClock.now) { activityClock.timers.delete(id); timer.fn(); } };
const livenessModule = {}; runInNewContext(transpile('../src/liveness.ts'), { exports: livenessModule,
  setTimeout: (fn, ms) => { const id = ++activityClock.next; activityClock.timers.set(id, { fn, at: activityClock.now + ms }); return id; }, clearTimeout: id => activityClock.timers.delete(id),
  Date: { now: () => activityClock.now }, require: id => { if (id === './receiptState') return receiptStateModule; throw Error(id); } });
const slotsBundle = await build({ entryPoints: [new URL('../src/connectionSlots.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const slotsModule = { exports: {} }; new Function('module', 'exports', slotsBundle.outputFiles[0].text)(slotsModule, slotsModule.exports);

async function harness({ multiple = false, list = false, strict = false, productionOwners = false, holdStatus = false, second = false } = {}) {
  let finishStatus;
  const statusGate = new Promise(resolve => { finishStatus = resolve; });
  let api, shared, sdkCount = 0, boxCount = 0, closed = 0, paused = 0, opened = 0, sendFinish, outboxChanged; const boxes = [];
  const appListeners = new Set();
  const livenessCalls = [], netListeners = new Set(); let networkCalls = 0;
  const appState = { currentState: 'active', addEventListener: (_name, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } };
  const scenes = new Map();
  const timelines = new Map(), reads = [], events = [], retries = [], renders = new Map();
  const Focus = React.createContext(true);
  const router = { push: value => events.push(['push', value]), replace: value => events.push(['replace', value]), back() {}, canGoBack: () => true };
  const config = { id: 'connection-a', baseUrl: 'https://example.test', token: 'synthetic-only' };
  const secondSlot = 'b'.repeat(24), secondConfig = { id: 'connection-b', baseUrl: 'https://other.test', token: 'synthetic-other' };
  const secure = new Map([[slotsModule.exports.slotKeys('primary').config, JSON.stringify(config)]]);
  if (second) { secure.set(slotsModule.exports.INDEX_KEY, JSON.stringify({ version: 1, slots: [secondSlot] })); secure.set(slotsModule.exports.slotKeys(secondSlot).config, JSON.stringify(secondConfig)); }
  const clients = [];
  const name = { name: 'Tuly', ready: true, error: '', saving: false };
  class SDK {
    acquirePage(id) {
      if (!multiple) return this;
      if (!this.pages.has(id)) {
        const page = Object.create(this);
        for (const field of ['messages','receipts','interactions','drafts']) page[field] = new Map();
        page.tailIncomplete = new Set();
        // Like LiveSessionClient pages: a page change notifies that page only, then the app.
        page.subscribers = new Set(); page.changeVersion = 0;
        page.change = () => { page.changeVersion++; for (const listener of [...page.subscribers]) listener(); this.appChange(); };
        this.pages.set(id,page);
      }
      return this.pages.get(id);
    }
    page(id) { return multiple ? this.pages.get(id) : this; }
    releasePage(id) { if (!multiple) this.closeConversation(); else { this.pages.get(id)?.closeConversation(); this.pages.delete(id); } }
    constructor(options) {
      sdkCount++; clients.push(this); this.connectionState = 'online';
      // Like LiveSessionClient: a change notifies this client's subscribers, then the app.
      this.subscribers = new Set(); this.changeVersion = 0; this.appChange = options.onChange;
      this.options = { ...options, onChange: () => { this.changeVersion++; for (const listener of [...this.subscribers]) listener(); options.onChange(); } }; this.supportsLatest = true; this.isCatalogueReady = true;
      this.pages = new Map();
      this.channels = new Map([['p_one', { id: 'p_one' }]]);
      this.threads = new Map(['t_one', 't_two'].map(id => [id, { id, project_id: 'p_one', title: id, last_ref: 8, read_ref: 0, unread_count: 1 }]));
      this.messages = new Map(); this.receipts = new Map(); this.interactions = new Map(); this.vaultPrompts = new Map(); this.drafts = new Map(); this.tailIncomplete = new Set();
    }
    async connect() { this.connectionState = 'online'; this.options.onConnectionState('online'); }
    async getThread() {}
    async markResultRead(...args) { reads.push(args); }
    setLivenessIdle(idle) { livenessCalls.push(idle); } networkChanged() { networkCalls++; }
    suspendConnection() { paused++; this.connectionState = 'suspended'; this.options.onConnectionState('suspended'); }
    close() { closed++; }
    async historyWindow() { return { messages: [], older_cursor: null }; }
    async openConversation(id, _target, timing, contentReady) {
      opened++; this.currentThreadId = id; this.currentConversationKey = id; this.currentOlderCursor = null;
      if (holdStatus) {
        assert.equal(timing, undefined, 'mobile does not register a measurement observer');
        this.messages.set(id, [{ id: 'row', ref_seq: 1, role: 'assistant', text: 'Synthetic content' }]);
        this.options.onChange();
        contentReady?.();
        await statusGate;
      }
    }
    subscribe(listener) { this.subscribers.add(listener); return () => this.subscribers.delete(listener); }
    closeConversation() { this.currentThreadId = null; this.messages.clear(); this.receipts.clear(); this.interactions.clear(); }
    resumeTail() {}

  }
  class Box {
    constructor(storage, _sdk, changed) { boxCount++; this.storage = storage; if (storage.connectionId === config.id) outboxChanged = changed; boxes.push(this); }
    async start() {} async stop() { this.stopped = true; } reconcile() {} setConnection() {}
    enqueue() { return new Promise(resolve => { sendFinish = resolve; }); }
    async retryFailed(...args) { retries.push(args); }
  }
  class ProductionOwners extends LivePageClient {
    constructor(options) {
      super(options); sdkCount++; clients.push(this);
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
  const exports = {}, connectionExports = {}, navigationExports = {};
  const store = { getItemAsync: async key => secure.get(key) ?? null, setItemAsync: async (key, value) => { secure.set(key, value); }, deleteItemAsync: async key => { secure.delete(key); } };
  const mocks = {
    './connections': connectionExports,
    './FormKeyboardAvoidingView': { FormKeyboardAvoidingView: ({ children }) => React.createElement('FormKeyboardAvoidingView', null, children) },
    './connectionSlots': slotsModule.exports,
    './sessionNavigation': navigationExports,
    './pairing': { CONFIG_KEY: 'hermes-app-connection-v1', PAIRING_KEY: 'hermes-app-pairing-v1', restorePairing: () => null, completePairing: async () => { throw Error('not used'); }, newPairing() {}, normalizePairingCode: v => v },

    './RenderResources': loadRenderResources(React),
    react: React,
    '../../../packages/client/src/localDraftMap': localDraftMap,
    './localDraftStorage': { bindLocalDraftStorage: () => () => {} },
    'react-native': { Keyboard: { dismiss() { globalThis.__keyboardDismissals = (globalThis.__keyboardDismissals ?? 0) + 1; } }, KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: appState, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => router, useIsFocused: () => React.useContext(Focus),
      useFocusEffect: cb => { const focused = React.useContext(Focus); React.useEffect(() => focused ? cb() : undefined, [focused, cb]); } },
    './FontSize': { Text: 'Text' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    'expo-secure-store': store,
    'expo-crypto': { randomUUID: () => 'synthetic-send-id', getRandomBytes: () => new Uint8Array(12), getRandomBytesAsync: async () => new Uint8Array(44) },
    'expo-clipboard': { setStringAsync: async () => {} },
    '../../../packages/client/src/sessionLinks': sessionLinks,
    '../../../packages/client/src/todo': todo, './TodoFlag': { TodoFlag: 'TodoFlag', TODO_COLOR: '#d9480f' }, './todoToggle': { setThreadTodo: async () => '' }, './sessionHeaderItems': sessionHeaderItems,
    '../../../packages/client/src/projectDirectory': {},
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String, isRetryableError: () => true },
    './NetworkStatusToast': { NetworkStatusToast: 'NetworkStatusToast' },
    '../../../packages/client/src/liveClient': { LiveSessionClient: SDK },
    '../../../packages/client/src/livePages': { LivePageClient: productionOwners ? ProductionOwners : SDK },
    './transport': { nativeTransport: () => ({}) },
    './liveness': livenessModule,
    '@react-native-community/netinfo': { __esModule: true, default: { addEventListener: fn => { netListeners.add(fn); return () => netListeners.delete(fn); } } },
    './send': { DEFAULT_BASE: config.baseUrl, connection: (baseUrl, token, id) => ({ baseUrl, token, id }), normalizeBase: v => v, newSend: (...args) => args },
    './outbox': { MobileOutbox: Box, OutboxStore: class { constructor(_, config) { this.connectionId = config.id; } async clear() {} } },
    './ChatTimeline': { ChatTimeline: React.forwardRef((props, ref) => {
      const scene = React.useRef({ offset: 0, following: true, media: {}, selection: null }); scenes.set(props.threadId, scene.current);
      React.useEffect(() => () => { scene.current.disposed = true; }, []);
      timelines.set(props.threadId, props); renders.set(props.threadId, (renders.get(props.threadId) ?? 0) + 1); React.useImperativeHandle(ref, () => ({ followLatest() {} }));
      return React.createElement('Chat', { threadId: props.threadId, text: props.text });
    }) },
    './SessionLabels': { LabelPills: 'LabelPills', LabelsEditorPage: 'LabelsEditorPage' }, './ChannelScreens': { ChannelScreens: 'ChannelScreens' },
    './timeline': timeline,
    './sendNotice': sendNotice,
    '../../../packages/client/src/sendErrors': sendErrors,
    './pageUpdates': pageUpdatesModule,
    './receiptHydration': { VisibleReceiptHydrator: class { cancel() {} update() {} } },
    './Attachments': { AttachmentComposer: 'AttachmentComposer', MessageAttachments: 'MessageAttachments', releaseComposerDraft() {} },
    './attachmentFiles': { AttachmentFiles: class { dispose() {} } },
    './TypingIndicator': { isAgentTyping: () => agentTyping.value, TypingIndicator: 'TypingIndicator' },
    './AgentSettings': { useAgentName: () => name },
    './settingsRoutes': { connectionSettingsRoute: connection => ({ pathname: '/settings/connection', params: { connection } }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
  };
  const require = id => { if (!(id in mocks)) throw Error(id); return mocks[id]; };
  runInNewContext(navigationCode, { exports: navigationExports, console, require });
  runInNewContext(connectionsCode, { exports: connectionExports, console, AbortController, queueMicrotask, require });
  runInNewContext(code, { exports, console, AbortController, require });
  function Suspender() { throw new Promise(() => {}); }
  function Probe() { api = exports.useApp(); return null; }
  function Pages({ thread, settings, suspend }) {
    shared = exports.useConnections();
    if (!shared.ready) return null;
    return React.createElement(exports.ConnectionScope, { slot: 'primary' }, React.createElement(Probe), React.createElement(Scoped, { thread, settings, suspend }));
  }
  function Scoped({ thread, settings, suspend }) {
    if (!api?.config || !api?.client) return null;
    return React.createElement(React.Fragment, {},
      list && React.createElement(exports.ChannelsScreen, { channelId: 'p_one' }),
      thread && (Array.isArray(thread) ? thread : [thread]).map((id,index,ids) => React.createElement(Focus.Provider, { key: id, value: !settings && index === ids.length - 1 }, React.createElement(exports.ThreadScreen, { threadId: id }))),
      settings && (typeof settings === 'string' ? React.createElement('Viewer', { id: settings }) : React.createElement('SettingsPage')),
      suspend && React.createElement(Suspender));
  }
  let root;
  async function render(thread = 't_one', settings = false, suspend = false) {
    const contents = React.createElement(exports.AppProvider, {}, React.createElement(React.Suspense, { fallback: null }, React.createElement(Pages, { thread, settings, suspend })));
    const tree = strict ? React.createElement(React.StrictMode, {}, contents) : contents;
    await act(async () => { if (root) root.update(tree); else root = create(tree); });
  }
  await render();
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); });
  await render();
  return { finishStatus, render, timelines, renders, scenes, reads, events, retries, clients, boxes, secure, secondSlot, get shared() { return shared; }, get api() { return api; }, get opens() { return opened; }, get pauses() { return paused; }, livenessCalls, get networkCalls() { return networkCalls; },
    async netInfo(state) { await act(async () => { for (const listener of [...netListeners]) listener(state); }); }, get counts() { return { sdkCount, boxCount, closed }; },
    get draftThreads() { return root.root.findByType('ChannelScreens').props.draftThreads; },
    async network(state, deadline, client = api.client) { await act(async () => { client.options.onRetryScheduled(deadline); client.options.onConnectionState(state); }); },
    async appState(value) { await act(async () => { appState.currentState = value; for (const listener of [...appListeners]) listener(value); }); },
    async revision() { await act(async () => api.client.options.onChange()); },
    async outbox(items, notice) { await act(async () => outboxChanged(items, notice)); },
    async finishSend() { await act(async () => sendFinish()); }, async close() { await act(async () => root.unmount()); } };
}

test('member rejection restores the composer draft, keeps its inline error across reopening, and isolates Threads', async () => {
  const h = await harness();
  const record = { connectionId: 'connection-a', threadId: 't_one', clientMessageId: 'member-rejection', text: '  saved draft\n中文  ', status: 'blocked', blockedReason: 'device_not_bound' };
  try {
    await act(async () => h.timelines.get('t_one').onText(record.text));
    await act(async () => { void h.timelines.get('t_one').onSend(); });
    await h.finishSend();
    assert.equal(h.timelines.get('t_one').text, '');
    await h.outbox([record]);
    assert.equal(h.timelines.get('t_one').text, record.text);
    assert.equal(h.timelines.get('t_one').composerError, sendErrors.DEVICE_NOT_BOUND_MESSAGE);
    assert.equal(h.api.textDrafts.current.get('connection-a:t_one'), record.text);
    await h.render('t_two');
    assert.equal(h.timelines.get('t_two').composerError, undefined);
    assert.equal(h.timelines.get('t_two').text, '');
    await h.render('t_one');
    assert.equal(h.timelines.get('t_one').text, record.text);
    assert.equal(h.timelines.get('t_one').composerError, sendErrors.DEVICE_NOT_BOUND_MESSAGE);
  } finally { await h.close(); }
});

test('late member rejection never overwrites a newer composer draft', async () => {
  const h = await harness();
  try {
    await act(async () => h.timelines.get('t_one').onText('a newer draft'));
    await h.outbox([{ connectionId: 'connection-a', threadId: 't_one', clientMessageId: 'old-rejection', text: 'older text', status: 'blocked', blockedReason: 'device_not_bound' }]);
    assert.equal(h.timelines.get('t_one').text, 'a newer draft');
    assert.equal(h.timelines.get('t_one').composerError, sendErrors.DEVICE_NOT_BOUND_MESSAGE);
  } finally { await h.close(); }
});

const runtime = (h, slot = 'primary') => h.shared.connections.find(c => c.slot === slot);
test('account retry schedule stays on its connection across list, chat and covered routes', async () => {
  const h = await harness({ list: true });
  try {
    await h.network('retrying', 123456);
    assert.equal(runtime(h).status, 'retrying');
    assert.equal(runtime(h).retryAt, 123456);
    const scene = h.scenes.get('t_one');
    await h.render('t_one', true);
    assert.equal(runtime(h).retryAt, 123456);
    assert.equal(h.scenes.get('t_one'), scene);
    await h.render(false);
    assert.equal(runtime(h).status, 'retrying');
    await h.network('online', null);
    assert.equal(runtime(h).retryAt, null);
    assert.equal(runtime(h).status, 'online');
    await h.appState('background');
    assert.equal(runtime(h).status, 'suspended');
    assert.equal(runtime(h).failed, false);
  } finally { await h.close(); }
});

test('only a failed open says the conversation could not load', async () => {
  const h = await harness();
  try {
    // A page that has not started opening (here: covered) is not a failure.
    await h.render(['t_two', 't_one']);
    assert.equal(h.timelines.get('t_two').locatingMessage, undefined, 'no failure text before an open runs');
    assert.equal(h.timelines.get('t_two').locatingBusy, true, 'it shows loading instead');
    const client = h.api.client, open = client.openConversation;
    client.openConversation = async () => { throw new Error('synthetic open failure'); };
    await h.render(['t_one', 't_two']);
    assert.equal(h.timelines.get('t_two').locatingMessage, 'Could not load this conversation. Try opening it again.');
    assert.equal(h.timelines.get('t_two').locatingBusy, false);
    client.openConversation = open;
  } finally { await h.close(); }
});

test('a new session keeps one timeline when the server confirms it', async () => {
  const h = await harness();
  try {
    const create = { channelId: 'p_one', title: 'New topic' };
    await h.outbox([{ connectionId: 'connection-a', threadId: 't_new', clientMessageId: 'mob_first', text: 'first', status: 'sending', create }]);
    await h.render('t_new');
    const scene = h.scenes.get('t_new');
    assert.ok(scene, 'the starting page shows the saved message');
    assert.equal(h.timelines.get('t_new').rows.at(-1).text, 'first');
    h.api.client.threads.set('t_new', { id: 't_new', project_id: 'p_one', title: 'New topic', archived: false });
    await h.revision();
    assert.equal(h.scenes.get('t_new'), scene, 'the confirmed session reuses the same timeline');
    assert.equal(scene.disposed, undefined, 'the timeline is not unmounted (it would hide and reposition)');
    assert.equal(h.timelines.get('t_new').rows.at(-1).text, 'first');
  } finally { await h.close(); }
});

test('removing diagnostics preserves content release before execution status is ready', async () => {
  const h = await harness({ holdStatus:true });
  try {
    assert.equal(h.timelines.get('t_one').rows.length,1,'production App displays content while execution status is pending');
    assert.equal(h.timelines.get('t_one').onMeasuredVisible, undefined);
    assert.equal(typeof h.timelines.get('t_one').onVisibleRefs, 'function');
    await act(async()=>h.finishStatus());
    const opens = h.opens;
    await h.render('t_one', true); await h.render('t_one'); await h.revision();
    assert.equal(h.opens, opens, 'returning a living page does not reopen it');
  } finally { await h.close(); }
});

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
    await act(async () => h.shared.removeConnection('primary'));
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
    await h.revision();
    assert.equal(h.timelines.get('t_one').rows.length,20,'complete transcript is rendered without a window');
    await act(async()=>h.timelines.get('t_one').onText('keep selected draft'));
    const scene=h.scenes.get('t_one');scene.offset=234;scene.following=false;scene.selection={start:3,end:6};const media=scene.media;
    const messages=h.api.client.messages.get('t_one'),owner=h.api.client.currentConversationKey;
    globalThis.__keyboardDismissals=0;
    await h.appState('inactive');await h.appState('background');
    assert.equal(globalThis.__keyboardDismissals,0,'leaving foreground keeps the keyboard and input focus');
    assert.equal(h.scenes.get('t_one'),scene);assert.notEqual(scene.disposed,true);assert.equal(h.api.client.messages.get('t_one'),messages);assert.equal(h.api.client.currentConversationKey,owner);assert.equal(h.counts.closed,0);
    await h.appState('active');assert.equal(h.scenes.get('t_one'),scene);assert.equal(scene.offset,234);assert.equal(scene.following,false);assert.equal(scene.media,media);assert.deepEqual(scene.selection,{start:3,end:6});assert.equal(h.timelines.get('t_one').rows.length,20);assert.equal(h.timelines.get('t_one').text,'keep selected draft');
    await h.render('t_one',true);assert.notEqual(scene.disposed,true);await h.render(null);assert.equal(scene.disposed,true);assert.equal(h.api.client.messages.size,0);
  } finally { await h.close(); }
});

test('tool detail and nested readers preserve the current session scene without reopening on return', async () => {
  const h = await harness();
  try {
    h.api.client.messages.set('t_one', Array.from({length:20},(_,index)=>({id:'m'+index,ref_seq:index+1,role:index%2===0?'user':'assistant',text:'synthetic '+index})));
    await h.revision();
    await act(async()=>h.timelines.get('t_one').onText('reader draft'));
    const scene=h.scenes.get('t_one'),messages=h.api.client.messages.get('t_one'),opens=h.opens;
    scene.offset=456;scene.following=false;const media=scene.media;
    await h.render('t_one','tool-detail');
    assert.equal(scene.disposed,undefined);assert.equal(h.api.client.currentThreadId,'t_one');assert.equal(h.api.client.messages.get('t_one'),messages);
    await h.render('t_one','nested-detail');await h.appState('background');await h.appState('active');
    await h.render('t_one','tool-detail');await h.render('t_one',false);
    assert.equal(h.scenes.get('t_one'),scene);assert.equal(scene.offset,456);assert.equal(scene.following,false);assert.equal(scene.media,media);
    assert.equal(h.timelines.get('t_one').rows.length,20);assert.equal(h.timelines.get('t_one').text,'reader draft');assert.equal(h.opens,opens);
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
    await act(async()=>h.shared.removeConnection('primary'));assert.equal(second.disposed,true);assert.equal(h.shared.connections.length,0);
  } finally { await h.close(); }
});

test('removing the only connection clears its identity and stops the SDK; old chat is not usable', async () => {
  const h = await harness();
  await act(async () => h.timelines.get('t_one').onText('private draft'));
  const drafts = h.api.textDrafts;
  await act(async () => h.shared.removeConnection('primary'));
  assert.equal(h.shared.connections.length, 0);
  assert.equal(drafts.current.size, 0);
  assert.equal(h.counts.closed, 1);
  assert.equal(h.secure.has('hermes-app-connection-v1'), false);
  await h.close();
});

test('two connections run independent clients; removing one keeps the other page, draft and scene', async () => {
  const h = await harness({ second: true, multiple: true });
  try {
    assert.equal(h.shared.connections.length, 2);
    assert.equal(h.counts.sdkCount, 2, 'one SDK client per connection');
    assert.equal(h.counts.boxCount, 2, 'one outbox per connection');
    assert.deepEqual(h.boxes.map(b => b.storage.connectionId).sort(), ['connection-a', 'connection-b']);
    const [primary, other] = ['primary', h.secondSlot].map(slot => runtime(h, slot).client);
    assert.notEqual(primary, other);
    // A failure on one connection does not change its peer.
    await h.network('blocked', null, other);
    assert.equal(runtime(h, h.secondSlot).status, 'blocked');
    assert.equal(runtime(h).status, 'online');
    assert.match(runtime(h, h.secondSlot).error, /Contact your admin/);
    assert.equal(runtime(h).error, '');
    // Draft keys carry the connection identity; equal raw thread IDs stay apart.
    await act(async () => h.timelines.get('t_one').onText('primary draft'));
    await act(async () => h.api.textDrafts.current.set('connection-b:t_one', 'other draft'));
    const scene = h.scenes.get('t_one'), page = primary.page('t_one');
    scene.offset = 321;
    await act(async () => h.shared.removeConnection(h.secondSlot));
    assert.equal(h.shared.connections.length, 1);
    assert.equal(h.boxes.find(b => b.storage.connectionId === 'connection-b').stopped, true);
    assert.equal(h.boxes.find(b => b.storage.connectionId === 'connection-a').stopped, undefined);
    assert.equal(h.api.textDrafts.current.get('connection-a:t_one'), 'primary draft');
    assert.equal(h.api.textDrafts.current.has('connection-b:t_one'), false);
    assert.equal(h.scenes.get('t_one'), scene); assert.equal(scene.disposed, undefined); assert.equal(scene.offset, 321);
    assert.equal(primary.page('t_one'), page);
    assert.equal(h.secure.has('hermes-app-connection-v1'), true);
    assert.equal(h.secure.has('hermes-app-connection-v1.' + h.secondSlot), false);
    assert.equal(h.secure.has('hermes-app-connections-v1'), false);
  } finally { await h.close(); }
});

test('battery: idle connections check less often; use, sends and runs keep the fast check', async () => {
  const h = await harness();
  try {
    const options = h.api.client.options;
    assert.equal(options.livenessMs, 10_000); assert.equal(options.idleLivenessMs, 30_000);
    assert.deepEqual([...options.backoffMs], [200, 500, 1000, 2000, 5000, 10_000, 20_000]); assert.equal(options.backoffJitter, 0.2);
    assert.equal(h.livenessCalls.at(-1), false, 'opening in the foreground counts as recent use');
    await act(async () => advanceActivity(119_000));
    assert.equal(h.livenessCalls.at(-1), false);
    await act(async () => advanceActivity(1_000));
    assert.equal(h.livenessCalls.at(-1), true, 'two quiet minutes switch to the idle check');
    await h.outbox([{ status: 'queued', threadId: 't_one', clientMessageId: 'mob_x' }]);
    assert.equal(h.livenessCalls.at(-1), false, 'an unconfirmed send keeps the fast check');
    await h.outbox([{ status: 'blocked', threadId: 't_one', clientMessageId: 'mob_x' }]);
    assert.equal(h.livenessCalls.at(-1), true, 'a failed send waits for the user');
    h.api.client.threads.set('t_one', { ...h.api.client.threads.get('t_one'), running: true }); await h.revision();
    assert.equal(h.livenessCalls.at(-1), false, 'a running Agent keeps the fast check');
    h.api.client.threads.set('t_one', { ...h.api.client.threads.get('t_one'), running: false }); await h.revision();
    assert.equal(h.livenessCalls.at(-1), true);
    await act(async () => h.shared.noteActivity());
    assert.equal(h.livenessCalls.at(-1), false, 'a touch keeps the fast check');
    await act(async () => advanceActivity(120_000));
    assert.equal(h.livenessCalls.at(-1), true);
  } finally { await h.close(); }
});

test('battery: a device network change wakes each connection once, only in the foreground', async () => {
  const h = await harness();
  try {
    await h.netInfo({ type: 'wifi', isConnected: true });
    assert.equal(h.networkCalls, 0, 'the first report is the starting state');
    await h.netInfo({ type: 'wifi', isConnected: true });
    assert.equal(h.networkCalls, 0, 'no change');
    await h.netInfo({ type: 'cellular', isConnected: true });
    assert.equal(h.networkCalls, 1);
    await h.netInfo({ type: 'none', isConnected: false });
    assert.equal(h.networkCalls, 1, 'losing the network does not retry');
    await h.appState('background');
    await h.netInfo({ type: 'wifi', isConnected: true });
    assert.equal(h.networkCalls, 1, 'background stays paused');
  } finally { await h.close(); }
});

test('battery: a hidden retained page waits for its changes; other pages do not render it', async () => {
  const h = await harness({ multiple: true });
  try {
    await h.render(['t_one', 't_two']);
    const a = h.api.client.page('t_one'), b = h.api.client.page('t_two');
    const shown = () => h.renders.get('t_two'), hidden = () => h.renders.get('t_one');
    const before = { shown: shown(), hidden: hidden() };
    a.messages.set('t_one', [{ id: 'late', ref_seq: 1, role: 'assistant', text: 'Arrived while hidden' }]);
    await act(async () => a.change());
    assert.equal(hidden(), before.hidden, 'a hidden page does not render for its own change');
    assert.equal(shown(), before.shown, 'the shown page does not render for another page');
    b.messages.set('t_two', [{ id: 'own', ref_seq: 1, role: 'assistant', text: 'Shown page reply' }]);
    await act(async () => b.change());
    assert.equal(shown(), before.shown + 1);
    assert.equal(h.timelines.get('t_two').rows.at(-1).text, 'Shown page reply');
    assert.equal(hidden(), before.hidden);
    await h.render('t_one');
    assert.ok(hidden() > before.hidden, 'showing the page applies the waiting change');
    assert.equal(h.timelines.get('t_one').rows.at(-1).text, 'Arrived while hidden');
    assert.equal(h.scenes.get('t_one').disposed, undefined, 'the retained scene is kept');
  } finally { await h.close(); }
});

test('battery: a page renders once when shown again, not once per hidden change', async () => {
  const h = await harness({ multiple: true });
  try {
    await h.render(['t_one', 't_two']);
    const a = h.api.client.page('t_one'), before = h.renders.get('t_one');
    for (let i = 1; i <= 5; i++) {
      a.messages.set('t_one', Array.from({ length: i }, (_, n) => ({ id: 'm' + n, ref_seq: n + 1, role: 'assistant', text: 'Step ' + n })));
      await act(async () => a.change());
    }
    assert.equal(h.renders.get('t_one'), before);
    await h.render('t_one');
    assert.ok(h.renders.get('t_one') - before <= 3, `few renders on return, not one per change (${h.renders.get('t_one') - before})`);
    assert.equal(h.timelines.get('t_one').rows.length, 5);
  } finally { await h.close(); }
});

test('battery: row callbacks keep one identity across renders and still act on this thread', async () => {
  const h = await harness();
  try {
    const first = h.timelines.get('t_one');
    await h.revision();
    await act(async () => first.onText('typing'));
    const later = h.timelines.get('t_one');
    assert.notEqual(later, first, 'the page rendered again');
    for (const name of ['onRetryFailed', 'onDeleteFailed', 'onCancel', 'onAnswerText', 'renderAttachments', 'messageActions'])
      assert.equal(later[name], first[name], name);
    await act(async () => first.onRetryFailed('original-id'));
    assert.deepEqual(h.retries, [['t_one', 'original-id']]);
  } finally { await h.close(); }
});

test('battery: scrolling does not render the page; the completed result row is still marked read', async () => {
  const h = await harness();
  try {
    const timeline = () => h.timelines.get('t_one'), before = h.renders.get('t_one');
    for (const refs of [[1, 2], [2, 3], [3, 4], [4, 5]]) await act(async () => timeline().onVisibleRefs(refs));
    assert.equal(h.renders.get('t_one'), before, 'visible rows alone do not render the page');
    assert.deepEqual(h.reads, []);
    Object.assign(h.api.client.threads.get('t_one'), { completed_unread: true, result_version: 3, result_ref: 7 });
    await h.revision();
    assert.deepEqual(h.reads, [], 'the result row is not in view');
    await act(async () => timeline().onVisibleRefs([6, 7]));
    assert.deepEqual(h.reads, [['t_one', 3, 7]]);
  } finally { await h.close(); }
});

test('battery: a result row already in view is marked read when the result arrives', async () => {
  const h = await harness();
  try {
    await act(async () => h.timelines.get('t_one').onVisibleRefs([6, 7]));
    Object.assign(h.api.client.threads.get('t_one'), { completed_unread: true, result_version: 4, result_ref: 7 });
    await h.revision();
    assert.deepEqual(h.reads, [['t_one', 4, 7]]);
  } finally { await h.close(); }
});

test('battery: the running indicator stops on a covered page and returns when it is shown', async () => {
  agentTyping.value = true;
  const h = await harness({ multiple: true });
  try {
    assert.equal(h.timelines.get('t_one').typingIndicator.props.active, true);
    await h.render(['t_one', 't_two']);
    assert.equal(h.timelines.get('t_one').typingIndicator.props.active, false, 'no animation behind another page');
    assert.equal(h.timelines.get('t_two').typingIndicator.props.active, true);
    await h.render('t_one');
    assert.equal(h.timelines.get('t_one').typingIndicator.props.active, true);
  } finally { agentTyping.value = false; await h.close(); }
});
