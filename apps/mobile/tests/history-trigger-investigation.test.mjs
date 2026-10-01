import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';
import * as blocks from '../src/historyBlocks.ts';
import { HermesClient } from '../../../packages/client/dist/index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const u = ref => ({ id: String(ref), ref_seq: ref, role: 'user', text: 'Synthetic user' });
const a = ref => ({ id: String(ref), ref_seq: ref, role: 'assistant', text: 'Synthetic reply' });
const latest = [u(100), a(101), u(110), a(111), u(120), a(121)];

async function harness() {
  let sdk, props, api, finishOlder, finishRepair, olderDone = false, latestRequests = 0;
  const trace = [], boundaryHistory = [];
  const config = { id: 'synthetic', baseUrl: 'https://synthetic.invalid', token: 'synthetic-only' };
  class SDK {
    constructor(options) {
      sdk = this; this.options = options; this.supportsLatest = true; this.connectionState = 'online';
      this.channels = new Map([['p', { id: 'p' }]]); this.threads = new Map([['t', { id: 't', project_id: 'p', title: 'Synthetic', last_ref: 121 }]]);
      this.messages = new Map(); this.receipts = new Map(); this.interactions = new Map(); this.drafts = new Map(); this.tailIncomplete = new Set();
    }
    async connect() { this.options.onConnectionState('online'); }
    close() {}
    resumeTail(id) { trace.push({ event: 'resume-tail' }); if (this.tailIncomplete.delete(id)) this.options.onChange(); }
    async markRead() {}
    async historyWindow(id, before, limit) {
      const request = { event: 'history-request', direction: before ? 'older' : 'latest', limit: limit ?? 30 };
      trace.push(request);
      let page;
      if (before) {
        if (!olderDone) {
          page = await new Promise(resolve => { finishOlder = resolve; }); olderDone = true;
        } else page = { messages: [u(70), a(71), u(80), a(81)], older_cursor: null };
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
    react: React,
    'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'expo-router': { Stack: { Screen: () => null }, useRouter: () => ({ push() {}, replace() {} }), useIsFocused: () => true,
      useFocusEffect: callback => React.useEffect(callback, [callback]) },
    './FontSize': { Text: 'Text', FontSizeSettings: 'FontSizeSettings' },
    'react-native-keyboard-controller': { useKeyboardState: selector => selector({ isVisible: false }) },
    'expo-router/react-navigation': { useHeaderHeight: () => 100 }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    'expo-secure-store': { getItemAsync: async key => key === 'config' ? JSON.stringify(config) : null }, 'expo-crypto': {},
    '../../../packages/client/src/index': { HermesClient: SDK, connectionFailure: String }, './transport': { nativeTransport: () => ({}) },
    './send': { DEFAULT_BASE: config.baseUrl, connection: (baseUrl, token, id) => ({ baseUrl, token, id }) },
    './ConnectionScreen': { ConnectionScreen: 'ConnectionScreen' }, './pairing': { CONFIG_KEY: 'config', PAIRING_KEY: 'pairing', restorePairing: () => null },
    './outbox': { MobileOutbox: Box, OutboxStore: class { constructor(_, value) { this.connectionId = value.id; } } },
    './ChatTimeline': { ChatTimeline: React.forwardRef((value, ref) => {
      props = value; boundaryHistory.push(value.rows.map(item => item.refSeq));
      React.useImperativeHandle(ref, () => ({ holdPosition: () => trace.push({ event: 'hold-position' }), followLatest() {} }));
      return React.createElement('Chat');
    }) },
    './ChannelScreens': {}, './historyBlocks': blocks, './timeline': timeline,
    './receiptHydration': { VisibleReceiptHydrator: class { cancel() {} update() {} } },
    './Attachments': { AttachmentComposer: 'AttachmentComposer', MessageAttachments: 'MessageAttachments' },
    './TypingIndicator': { isAgentTyping: () => false, TypingIndicator: 'TypingIndicator' },
    './AgentSettings': { useAgentName: () => ({ name: '', ready: true }) }, './ModelSettings': {}, 'expo-symbols': { SymbolView: 'SymbolView' }
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
  function Page() { api = output.exports.useApp(); return api.client ? React.createElement(output.exports.ThreadScreen, { threadId: 't' }) : null; }
  let root; await act(async () => { root = create(React.createElement(output.exports.AppProvider, {}, React.createElement(Page))); });
  assert.deepEqual(props.rows.map(item => item.refSeq), latest.map(item => item.ref_seq));
  trace.length = 0; boundaryHistory.length = 0;
  return { trace, boundaryHistory, get props() { return props; }, get sdk() { return sdk; },
    async pull() { let promise; await act(async () => { trace.push({ event: 'one-user-load-intent' }); promise = props.onOlder(); }); return { promise }; },
    async revision() { await act(async () => sdk.options.onChange()); },
    async flagRecovery() { await act(async () => { sdk.tailIncomplete.add('t'); sdk.options.onChange(); }); },
    async finishOlder() { await act(async () => finishOlder({ messages: [u(90), a(91)], older_cursor: 'synthetic-cursor-80' })); },
    async finishRepair() { await act(async () => finishRepair({ messages: latest, older_cursor: 'synthetic-cursor-90' })); },
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
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'older']);
  assert.equal(h.props.rows[0].refSeq, 70);
  console.log('NORMAL_SINGLE_INTENT', JSON.stringify(h.trace));
  await h.close();
});

test('a tail-recovery invalidation DURING an older load starts a second history owner and clears the visible rows', async () => {
  const h = await harness(); const { promise } = await h.pull();
  await h.flagRecovery();
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'latest']);
  assert.equal(h.props.rows.length, 0, 'production recovery effect hid the current conversation while the older request was pending');
  await h.revision();
  assert.deepEqual(h.trace.filter(item => item.event === 'history-request').map(item => item.direction), ['older', 'latest']);
  await h.finishOlder(); await promise;
  assert.equal(h.props.rows.length, 0, 'older load was invalidated by new openThread generation');
  await h.finishRepair();
  assert.equal(h.props.rows[0].refSeq, 100, 'repair reset to newest 3 blocks instead of completing the requested older expansion');
  console.log('RECOVERY_OVERLAP', JSON.stringify({ trace: h.trace, rows_were_cleared: h.boundaryHistory.some(rows => rows.length === 0), native_refresh_events_simulated: 0 }));
  await h.close();
});
