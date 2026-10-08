import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The Session header has one entry; this page holds labels, link and Settings.
const state = { pushed: [], copied: [], shared: [], alerts: [], app: null, focused: true };
globalThis.__sessionOptionsTest = state;
const mocks = {
  'react-native': `const s=globalThis.__sessionOptionsTest; export const Pressable='Pressable',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1}; export const Share={share:async v=>{s.shared.push(v);return {action:'sharedAction'}}}; export const Alert={alert:(...a)=>s.alerts.push(a)};`,
  'expo-router': `const s=globalThis.__sessionOptionsTest; export const useRouter=()=>({push:r=>s.pushed.push(r)}); export const useIsFocused=()=>s.focused;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `export const Text='Text';`,
  './App': `const s=globalThis.__sessionOptionsTest; export const Notice='Notice'; export const useApp=()=>s.app; export const labelsRoute=(connection,threadId)=>({pathname:'/threads/[threadId]/labels',params:{threadId,connection}});`,
  './CopyToast': `const s=globalThis.__sessionOptionsTest; export const copyWithToast=async v=>{s.copied.push(v);return true};`,
};
const bundle = await build({ entryPoints: [new URL('../src/SessionOptions.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { SessionOptionsScreen } = mod.exports;

const thread = (extra = {}) => ({ id: 'th_1', title: 'Plan', project_id: 'p', markers: ['bug', 'ios'], ...extra });
const app = (threads, supportsSessionLabels = true) => ({ slot: 'second', config: { id: 'primary-id', baseUrl: 'https://agent.example' }, client: { threads: new Map(threads.map(t => [t.id, t])), supportsSessionLabels } });
const labels = root => root.root.findAll(node => node.type === 'Pressable').map(node => node.props.accessibilityLabel);
const press = async (root, label) => { const node = root.root.findAll(n => n.type === 'Pressable').find(n => n.props.accessibilityLabel === label); assert.ok(node, 'missing ' + label + ' in ' + labels(root)); await act(async () => { node.props.onPress(); await Promise.resolve(); }); };
const reset = () => Object.assign(state, { pushed: [], copied: [], shared: [], alerts: [], focused: true });

test('Session options lists labels, link and Settings in that order; Labels pushes the editor page', async () => {
  reset(); state.app = app([thread()]);
  let root; await act(async () => { root = create(React.createElement(SessionOptionsScreen, { threadId: 'th_1' })); });
  assert.deepEqual(labels(root), ['Edit labels, bug, ios', 'Copy session link', 'Settings']);
  await press(root, 'Edit labels, bug, ios');
  assert.deepEqual(state.pushed, [{ pathname: '/threads/[threadId]/labels', params: { threadId: 'th_1', connection: 'second' } }], 'labels open as a pushed page on the same connection');
  state.pushed = [];
  await press(root, 'Copy session link');
  assert.equal(state.copied.length, 1);
  assert.match(state.copied[0], /th_1/);
  await press(root, 'Settings');
  assert.deepEqual(state.pushed, ['/settings']);
  root.unmount();
});

test('without label support the page keeps link and Settings only', async () => {
  reset(); state.app = app([thread({ markers: [] })], false);
  let root; await act(async () => { root = create(React.createElement(SessionOptionsScreen, { threadId: 'th_1' })); });
  assert.deepEqual(labels(root), ['Copy session link', 'Settings']);
  root.unmount();
});

test('an unavailable session shows a plain notice and no actions', async () => {
  reset(); state.app = app([thread({ archived: true })]);
  let root; await act(async () => { root = create(React.createElement(SessionOptionsScreen, { threadId: 'th_1' })); });
  assert.deepEqual(labels(root), []);
  assert.equal(root.root.findByType('Notice').props.text, 'This conversation is unavailable.');
  root.unmount();
});

test('Export conversation shares the server Markdown; a failure explains itself', async () => {
  reset(); state.app = app([thread()]);
  const exported = [];
  Object.assign(state.app.client, { supportsThreadExport: true, exportThread: async id => { exported.push(id); return '# Plan\n\nhello\n'; } });
  let root; await act(async () => { root = create(React.createElement(SessionOptionsScreen, { threadId: 'th_1' })); });
  assert.deepEqual(labels(root), ['Edit labels, bug, ios', 'Copy session link', 'Export conversation', 'Settings']);
  await press(root, 'Export conversation');
  await act(async () => { await Promise.resolve(); });
  assert.deepEqual(exported, ['th_1']);
  assert.deepEqual(state.shared, [{ message: '# Plan\n\nhello\n', title: 'Plan' }]);
  state.app.client.exportThread = async () => { throw new Error('HTTP 503'); };
  await press(root, 'Export conversation');
  await act(async () => { await Promise.resolve(); });
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0][0], 'Could not export this conversation');
  root.unmount();
});
