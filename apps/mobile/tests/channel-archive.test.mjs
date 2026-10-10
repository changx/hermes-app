import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Production ChannelScreens: Channel options and session long-press menus archive through the client.
const state = { alerts: [] };
globalThis.__channelArchiveTest = state;
const mocks = {
  'react-native': `const s=globalThis.__channelArchiveTest; export const Pressable='Pressable',ScrollView='ScrollView',View='View',FlatList=p=>{const R=require('react');return R.createElement('FlatList',p,p.data.map(item=>R.createElement(R.Fragment,{key:p.keyExtractor(item)},p.renderItem({item}))))},ActivityIndicator='ActivityIndicator'; export const StyleSheet={create:x=>x}; export const Alert={alert:(...a)=>s.alerts.push(a)};`,
  'expo-router': `export const useFocusEffect=()=>{}; export const useIsFocused=()=>true;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
  './NewTopicComposer': `export const NewTopicComposer='NewTopicComposer';`,
  './MessageTime': `export const MessageTime='MessageTime';`,
  './SessionLabels': `export const LabelPills='LabelPills',LabelsFilter='LabelsFilter';`,
};
const bundle = await build({ entryPoints: [new URL('../src/ChannelScreens.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { ChannelScreens } = mod.exports;

const client = (supportsChannelArchive, calls) => ({
  supportsChannelArchive, supportsSessionLabels: false, supportsChannelWorkspace: false,
  channels: new Map([['p', { id: 'p', name: 'Research' }]]),
  threads: new Map([['th_1', { id: 'th_1', project_id: 'p', title: 'Plan', archived: false }]]),
  archiveThread: async id => { calls.push(['archiveThread', id]); },
});
const render = async (props) => {
  let root; const noop = () => {};
  await act(async () => { root = create(React.createElement(ChannelScreens, { channelId: 'p', onThread: noop, onContext: noop, onFiles: noop, onAgents: noop, onLabels: noop, enqueueFirstMessage: async () => {}, ...props })); });
  return root;
};
const button = (root, label) => root.root.findAll(n => n.type === 'Pressable').find(n => n.props.accessibilityLabel === label);
const choose = async (alert, text) => { await act(async () => { alert[2].find(b => b.text === text).onPress(); await Promise.resolve(); await Promise.resolve(); }); };

test('Channel options archive the Channel only after confirmation and only when the server supports it', async () => {
  state.alerts = []; const calls = [];
  const root = await render({ client: client(true, calls), onArchive: async () => { calls.push(['onArchive']); } });
  await act(async () => button(root, 'Channel options').props.onPress());
  const menu = state.alerts[0];
  assert.deepEqual(menu[2].map(b => b.text), ['Rename channel', 'Archive channel', 'Cancel']);
  await choose(menu, 'Archive channel');
  assert.deepEqual(calls, [], 'confirmation first');
  assert.match(state.alerts[1][0], /Archive “Research”\?/);
  await choose(state.alerts[1], 'Archive');
  assert.deepEqual(calls, [['onArchive']]);
  root.unmount();
  state.alerts = [];
  const old = await render({ client: client(false, calls), onArchive: async () => {} });
  await act(async () => button(old, 'Channel options').props.onPress());
  assert.deepEqual(state.alerts[0][2].map(b => b.text), ['Rename channel', 'Cancel']);
  old.unmount();
});

test('Session long-press archives the session after confirmation', async () => {
  state.alerts = []; const calls = [];
  const root = await render({ client: client(true, calls), onArchive: async () => {} });
  await act(async () => button(root, 'Plan').props.onLongPress());
  assert.deepEqual(state.alerts[0][2].map(b => b.text), ['Rename session', 'Archive session', 'Cancel']);
  await choose(state.alerts[0], 'Archive session');
  assert.deepEqual(calls, []);
  await choose(state.alerts[1], 'Archive');
  assert.deepEqual(calls, [['archiveThread', 'th_1']]);
  root.unmount();
});
