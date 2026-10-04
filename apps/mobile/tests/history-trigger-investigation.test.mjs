import test from 'node:test';
import * as sessionLinks from '../../../packages/client/src/sessionLinks.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadRenderResources } from './render-resource-fixture.mjs';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';
import * as blocks from '../src/historyBlocks.ts';
import * as sendNotice from '../src/sendNotice.ts';
import * as localDraftMap from '../../../packages/client/src/localDraftMap.ts';
import { HermesClient } from '../../../packages/client/dist/index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(process.env.HISTORY_APP_SOURCE ?? new URL('../src/App.tsx', import.meta.url), 'utf8');
const u = ref => ({ id: String(ref), ref_seq: ref, role: 'user', text: 'Synthetic user' });
const a = ref => ({ id: String(ref), ref_seq: ref, role: 'assistant', text: 'Synthetic reply' });
const latest = [u(100), a(101), u(110), a(111), u(120), a(121), u(130), a(131), u(140), a(141)];

async function harness() {
  let sdk, props, api, finishOlder, finishRepair, olderDone = false, latestRequests = 0;
  const Focus = React.createContext(true);
  const trace = [], boundaryHistory = [];
  const config = { id: 'synthetic', baseUrl: 'https://synthetic.invalid', token: 'synthetic-only' };
  class SDK {
    acquirePage() { return this; }
    page() { return this; }
    releasePage() { this.closeConversation(); }
    constructor(options) {
      sdk = this; this.options = options; this.supportsLatest = true; this.connectionState = 'online';
      this.channels = new Map([['p', { id: 'p' }]]); this.threads = new Map([['t', { id: 't', project_id: 'p', title: 'Synthetic', last_ref: 141 }]]);
      this.messages = new Map(); this.receipts = new Map(); this.interactions = new Map(); this.drafts = new Map(); this.tailIncomplete = new Set();
    }
    async connect() { this.options.onConnectionState('online'); }
    close() {}
    async openConversation(id) { this.currentThreadId = id; this.currentConversationKey = {}; const page = await this.historyWindow(id); this.currentOlderCursor = page.older_cursor; }
    closeConversation() { this.currentThreadId = null; this.messages.clear(); this.receipts.clear(); this.interactions.clear(); this.tailIncomplete.clear(); }
    resumeTail(id) { trace.push({ event: 'resume-tail' }); if (this.tailIncomplete.delete(id)) this.options.onChange(); }
    async recoverHistoryTail(id, signal) {
      trace.push({ event: 'history-request', direction: 'tail-repair' });
      const page = await new Promise((resolve, reject) => {
        finishRepair = resolve;
        signal.addEventListener('abort', () => { trace.push({ event: 'repair-aborted' }); reject(new Error('aborted')); }, { once: true });
      });
      if (page.fail) throw new Error('synthetic offline');
      this.messages.set(id, [...this.messages.get(id), a(142)]);
      this.options.onChange();
      trace.push({ event: 'history-response', direction: 'tail-repair' });
      this.resumeTail(id);
    }
    async markRead() {}
    async loadFullHistory(id) {
      let before = this.currentOlderCursor;
      while (before) { const page = await this.historyWindow(id, before, 100); before = page.older_cursor; }
      this.currentOlderCursor = null;
    }
    async historyWindow(id, before, limit) {
      const request = { event: 'history-request', direction: before ? 'older' : 'latest', limit: limit ?? 30 };
      trace.push(request);
      let page;
      if (before) {
        if (!olderDone) {
          page = await new Promise(resolve => { finishOlder = resolve; }); olderDone = true;
        } else if (before === 'synthetic-cursor-80') page = { messages: [u(70), a(71), u(80), a(81)], older_cursor: 'synthetic-cursor-60' };
        else page = { messages: [u(40), a(41), u(50), a(51), u(60), a(61)], older_cursor: null };
      } else if (++latestRequests === 1) {
        page = { messages: latest, older_cursor: 'synthetic-cursor-90' };
      } else page = await new Promise(resolve => { finishRepair = resolve; });
      const byRef = new Map((this.messages.get(id) ?? []).map(item => [item.ref_seq, item]));
      for (const item of page.messages) byRef.set(item.ref_seq, item);
      this.messages.set(id, [...byRef.values()].sort((x, y) => x.ref_seq - y.ref_seq));
      this.options.onChange();
      trace.push({ event: 'history-response', direction: request.direction });
      return page;
    }
  }
  class Box { constructor(storage) { this.storage = storage; } async start() {} async stop() {} reconcile() {} setConnection() {} }
  const mocks = {
    './sessionTimingSwitch': { SESSION_TIMING_AVAILABLE: false, sessionTimingForPage: () => null },
    './SessionTimingPanel': {},
    './RenderResources': loadRenderResources(React),
    react: React,
    '../../../packages/client/src/localDraftMap': localDraftMap,
    './localDraftStorage': { bindLocalDraftStorage: () => () => {} },
    'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => ({ push() {}, replace() {} }), useIsFocused: () => React.useContext(Focus),
      useFocusEffect: callback => { const focused = React.useContext(Focus); React.useEffect(() => focused ? callback() : undefined, [focused, callback]); } },
    './FontSize': { Text: 'Text', FontSizeSettings: 'FontSizeSettings' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    'expo-secure-store': { getItemAsync: async key => key === 'config' ? JSON.stringify(config) : null }, 'expo-crypto': {},
    'expo-clipboard': { setStringAsync: async () => {} }, '../../../packages/client/src/sessionLinks': sessionLinks,
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String, isRetryableError: () => true }, './transport': { nativeTransport: () => ({}) },
    './NetworkStatusToast': { NetworkStatusToast: 'NetworkStatusToast' },
    '../../../packages/client/src/liveClient': { LiveSessionClient: SDK },
    '../../../packages/client/src/livePages': { LivePageClient: SDK },
    './sessionNavigation': { SessionNavigationProvider: ({ children }) => children, useSessionNavigation: () => ({ thread() {}, link() {} }) },
    './send': { DEFAULT_BASE: config.baseUrl, connection: (baseUrl, token, id) => ({ baseUrl, token, id }) },
    './ConnectionScreen': { ConnectionScreen: 'ConnectionScreen' }, './pairing': { CONFIG_KEY: 'config', PAIRING_KEY: 'pairing', restorePairing: () => null },
    './outbox': { MobileOutbox: Box, OutboxStore: class { constructor(_, value) { this.connectionId = value.id; } } },
    './ChatTimeline': { ChatTimeline: React.forwardRef((value, ref) => {
      props = value; boundaryHistory.push(value.rows.map(item => item.refSeq));
      React.useImperativeHandle(ref, () => ({ holdPosition: () => trace.push({ event: 'hold-position' }), followLatest() {} }));
      return React.createElement('Chat');
    }) },
    './SessionLabels': { LabelPills: 'LabelPills', LabelsEditor: 'LabelsEditor' }, './ChannelScreens': {}, './historyBlocks': blocks, './timeline': timeline,
    './sendNotice': sendNotice,
    './receiptHydration': { VisibleReceiptHydrator: class { cancel() {} update() {} } },
    './Attachments': { AttachmentComposer: 'AttachmentComposer', MessageAttachments: 'MessageAttachments' },
    './TypingIndicator': { isAgentTyping: () => false, TypingIndicator: 'TypingIndicator' },
    './AgentSettings': { useAgentName: () => ({ name: '', ready: true }) }, './ModelSettings': {}, 'expo-symbols': { SymbolView: 'SymbolView' }
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, AbortController, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
  function Page() { api = output.exports.useApp(); return api.client ? React.createElement(output.exports.ThreadScreen, { threadId: 't' }) : null; }
  const tree = focused => React.createElement(output.exports.AppProvider, {}, React.createElement(Focus.Provider, { value: focused }, React.createElement(Page)));
  let root; await act(async () => { root = create(tree(true)); });
  assert.deepEqual(props.rows.map(item => item.refSeq), latest.map(item => item.ref_seq));
  trace.length = 0; boundaryHistory.length = 0;
  return { trace, boundaryHistory, get props() { return props; }, get sdk() { return sdk; },
    async pull() { let promise; await act(async () => { trace.push({ event: 'one-user-load-intent' }); promise = props.onOlder(); }); return { promise }; },
    async revision() { await act(async () => sdk.options.onChange()); },
    async flagRecovery() { await act(async () => { sdk.tailIncomplete.add('t'); sdk.options.onChange(); }); },
    async finishOlder() { await act(async () => finishOlder({ messages: [u(90), a(91)], older_cursor: 'synthetic-cursor-80' })); },
    async finishRepair(fail = false) { await act(async () => finishRepair({ messages: latest, older_cursor: 'synthetic-cursor-90', fail })); },
    async focus(value) { await act(async () => root.update(tree(value))); },
    async close() { await act(async () => root.unmount()); }
  };
}

test('real SDK produces the recovery flag after an over-budget tail catch-up', async () => {
  const requests = [], flags = [];
  let client;
  client = new HermesClient({ token: () => 'synthetic-only', onChange: () => flags.push(client.tailIncomplete.has('t')),
    http: { request: async (_method, path) => {
      const query = new URL(path, 'https://synthetic.invalid').searchParams;
      requests.push(query.get('after') ?? query.get('after_ref_seq'));
      const page = requests.length;
      return { status: 200, body: { messages: Array.from({ length: 100 }, (_, i) => a(page * 100 + 200 + i)), next_cursor: `synthetic-forward-${page + 1}`, incomplete_turns: [], turn_outcomes: [] } };
    } } });
  client.supportsLatest = true; client.messages.set('t', latest);
  await assert.rejects(client.historyTail('t'), /message catch-up exceeds 300 refs/);
  assert.equal(client.tailIncomplete.has('t'), true);
  assert.equal(flags.at(-1), true);
  assert.equal(requests.length, 3);
  console.log('REAL_SDK_RECOVERY_FLAG', JSON.stringify({ network_pages: requests.length, flag_emitted: flags.at(-1), synthetic_http: true }));
});

test('one load intent plus ordinary SDK revisions only continues older cursors, not a second loader', async () => {
  const h = await harness(); const { promise } = await h.pull();
  await h.revision(); await h.revision();
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older']);
  await h.finishOlder(); await promise;
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'older', 'older']);
  assert.equal(h.props.rows[0].refSeq, 40);
  console.log('NORMAL_SINGLE_INTENT', JSON.stringify(h.trace));
  await h.close();
});

test('tail repair during an older load keeps the visible rows and does not reopen the conversation', async () => {
  const h = await harness(); const { promise } = await h.pull();
  await h.flagRecovery();
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'tail-repair']);
  assert.equal(h.props.rows[0].refSeq, 100);
  await h.revision();
  await h.revision();
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'tail-repair']);
  await h.finishOlder(); await promise;
  assert.equal(h.props.rows[0].refSeq, 40, 'the original pull expands all history');
  await h.finishRepair();
  assert.equal(h.props.rows[0].refSeq, 40, 'repair does not reset startRef');
  assert.equal(h.boundaryHistory.some(rows => rows.length === 0), false);
  assert.equal(h.props.locatingBusy, false);
  console.log('RECOVERY_FIXED', JSON.stringify({ trace: h.trace, rows_were_cleared: false, native_refresh_events_simulated: 0 }));
  await h.close();
});

test('repair completing first leaves full-history loading alive; later pulls need no history reads', async () => {
  const h = await harness(); const { promise } = await h.pull();
  await h.flagRecovery(); await h.finishRepair();
  assert.equal(h.props.rows[0].refSeq, 100);
  await h.finishOlder(); await promise;
  assert.equal(h.props.rows[0].refSeq, 40);
  const next = await h.pull(); await next.promise;
  assert.equal(h.trace.filter(item => item.event === 'one-user-load-intent').length, 2);
  assert.equal(h.props.hasOlder, false);
  assert.equal(h.props.rows[0].refSeq, 40, 'the next ordinary request can load the remaining older block');
  await h.close();
});

test('failed repair keeps current reading and old pagination usable, and a later revision can retry', async () => {
  const h = await harness(); const { promise } = await h.pull();
  await h.flagRecovery(); await h.finishRepair(true);
  assert.equal(h.props.rows[0].refSeq, 100); assert.equal(h.sdk.tailIncomplete.has('t'), true);
  await h.finishOlder(); await promise;
  assert.equal(h.props.rows[0].refSeq, 40);
  await h.revision(); await h.finishRepair();
  assert.equal(h.sdk.tailIncomplete.has('t'), false);
  assert.equal(h.props.rows[0].refSeq, 40);
  assert.equal(h.boundaryHistory.some(rows => rows.length === 0), false);
  await h.close();
});

test('covering route aborts active repair without releasing the scene; actual unmount releases it', async () => {
  const h = await harness(); await h.flagRecovery();
  const messages=h.sdk.messages.get('t');
  await h.focus(false);
  assert.equal(h.trace.filter(item => item.event === 'repair-aborted').length, 1);
  assert.equal(h.sdk.tailIncomplete.has('t'), true);
  assert.equal(h.sdk.messages.get('t'), messages);
  assert.equal(h.sdk.currentThreadId, 't');
  await h.close();
  assert.equal(h.sdk.messages.size, 0);
  assert.equal(h.sdk.currentThreadId, null);
  assert.equal(h.trace.filter(item => item.event === 'repair-aborted').length, 1);
});
