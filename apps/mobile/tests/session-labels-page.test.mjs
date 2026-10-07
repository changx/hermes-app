import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The label editor is a pushed Stack page: Save in the header, Back discards.
const state = { options: null, focused: true };
globalThis.__labelsPageTest = state;
const mocks = {
  'react-native': `export const Pressable='Pressable',ScrollView='ScrollView',View='View',Modal='Modal',KeyboardAvoidingView='KeyboardAvoidingView'; export const Platform={OS:'ios'}; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  'expo-router': `const s=globalThis.__labelsPageTest; export const Stack={Screen:({options})=>{s.options=options;return null}}; export const useIsFocused=()=>s.focused;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
};
const bundle = await build({ entryPoints: [new URL('../src/SessionLabels.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { LabelsEditorPage } = mod.exports;

const client = ({ markers = ['bug'], online = true, save } = {}) => {
  const threads = new Map([['th_1', { id: 'th_1', title: 'Plan', project_id: 'p', markers }], ['th_2', { id: 'th_2', title: 'Other', project_id: 'p', markers: ['ios'] }]]);
  return { threads, connectionState: online ? 'online' : 'offline', supportsSessionLabels: true, isThreadAvailable: id => threads.has(id),
    saved: [], async saveThreadLabels(id, labels, at) { this.saved.push({ id, labels, at }); return save ? save(labels) : { markers: labels }; } };
};
const pressables = root => root.root.findAll(node => node.type === 'Pressable');
const find = (root, label) => { const node = pressables(root).find(n => n.props.accessibilityLabel === label); assert.ok(node, 'missing ' + label + ' in ' + pressables(root).map(n => n.props.accessibilityLabel)); return node; };
const press = async (root, label) => { const node = find(root, label); await act(async () => { node.props.onPress(); await Promise.resolve(); }); };
const headerSave = () => state.options.headerRight();
const pressSave = async () => { await act(async () => { headerSave().props.onPress(); await new Promise(r => setTimeout(r, 0)); }); };
const type = async (root, text) => { const input = root.root.findByType('TextInput'); await act(async () => { input.props.onChangeText(text); }); };
const render = async props => { let root; await act(async () => { root = create(React.createElement(LabelsEditorPage, props)); }); return root; };

test('the page shows the draft, adds and reuses labels, and saves from the header', async () => {
  state.focused = true; const c = client(); let done = 0;
  const root = await render({ client: c, threadId: 'th_1', onDone: () => { done++; } });
  assert.equal(state.options.title, 'Labels');
  assert.equal(state.options.gestureEnabled, true);
  assert.equal(root.root.findAll(n => n.type === 'Modal').length, 0, 'no modal sheet');
  assert.ok(pressables(root).some(n => n.props.accessibilityLabel === 'Edit label bug'));
  await type(root, 'urgent'); await press(root, 'Add');
  await press(root, 'Reuse label ios');
  await pressSave();
  assert.deepEqual(c.saved.map(s => s.labels), [['bug', 'urgent', 'ios']]);
  assert.equal(done, 1, 'a confirmed save returns to the previous page');
  root.unmount();
});

test('a save that does not match keeps the draft and stays on the page', async () => {
  state.focused = true; const c = client({ save: () => ({ markers: ['other'] }) }); let done = 0;
  const root = await render({ client: c, threadId: 'th_1', onDone: () => { done++; } });
  await press(root, 'Remove label bug');
  await pressSave();
  assert.equal(done, 0);
  const alert = root.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'alert');
  assert.match(String(alert[0].props.children), /changed on another device/);
  assert.equal(state.options.gestureEnabled, true, 'Back is available again after the save');
  root.unmount();
});

test('an unfinished entry blocks Save; offline disables it', async () => {
  state.focused = true; const c = client(); let done = 0;
  const root = await render({ client: c, threadId: 'th_1', onDone: () => { done++; } });
  await type(root, 'half');
  await pressSave();
  assert.equal(c.saved.length, 0); assert.equal(done, 0);
  root.unmount();
  const offline = await render({ client: client({ online: false }), threadId: 'th_1', onDone: () => {} });
  assert.equal(headerSave().props.disabled, true);
  offline.unmount();
});
