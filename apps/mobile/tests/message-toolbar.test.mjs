import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const state = { opened: [], copied: [] };
globalThis.__toolbarTest = state;
const mocks = {
  'react-native': `export const ActivityIndicator='ActivityIndicator',Pressable='Pressable',View='View'; export const StyleSheet={create:x=>x};`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `export const Text='Text';`,
  './openLink': `export const openLink=h=>globalThis.__toolbarTest.opened.push(h);`,
  './CopyToast': `export const copyWithToast=async v=>{globalThis.__toolbarTest.copied.push(v);return true};`,
};
const bundle = await build({ entryPoints: [new URL('../src/MessageToolbar.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { MessageToolbar } = mod.exports;

const row = { key: 'f1', role: 'assistant', displayKind: 'final', text: 'The **answer**', refSeq: 11 };
const buttons = root => root.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'button').map(n => n.props.accessibilityLabel);
const button = (root, label) => root.root.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
const mount = async props => { let root; await act(async () => { root = create(React.createElement(MessageToolbar, { row, canRetry: false, running: false, ...props })); }); return root; };

test('the toolbar shows Branch, Copy, References, Export, and Retry only when allowed', async () => {
  const actions = { branch: async () => {}, sources: async () => [], exportMessage() {}, retry() {} };
  let root = await mount({ actions, canRetry: true });
  assert.deepEqual(buttons(root), ['Branch', 'Copy', 'References', 'Export', 'Retry']);
  root.unmount();
  root = await mount({ actions, canRetry: false });
  assert.deepEqual(buttons(root), ['Branch', 'Copy', 'References', 'Export']);
  root.unmount();
  // An older server: no branch or sources; Copy always works.
  root = await mount({ actions: { exportMessage() {} } });
  assert.deepEqual(buttons(root), ['Copy', 'Export']);
  await act(async () => { button(root, 'Copy').props.onPress(); });
  assert.deepEqual(state.copied, ['The **answer**']);
  root.unmount();
});

test('Branch shows progress, ignores repeat taps and is disabled while the agent runs', async () => {
  let release, calls = 0;
  const actions = { branch: () => { calls++; return new Promise(r => { release = r; }); } };
  const root = await mount({ actions });
  await act(async () => { button(root, 'Branch').props.onPress(); });
  assert.equal(button(root, 'Branch').props.accessibilityState.busy, true);
  assert.equal(button(root, 'Branch').props.disabled, true, 'no second request while one is in flight');
  await act(async () => { release(); });
  assert.equal(calls, 1);
  assert.equal(button(root, 'Branch').props.accessibilityState.busy, false);
  root.unmount();
  const running = await mount({ actions, running: true, canRetry: true });
  assert.equal(button(running, 'Branch').props.disabled, true);
  running.unmount();
});

test('References loads once, expands inline and opens a source', async () => {
  let loads = 0;
  const actions = { sources: async () => { loads++; return [{ url: 'https://www.example.com/doc', kind: 'read' }, { url: 'https://example.org/', kind: 'cited' }]; } };
  const root = await mount({ actions });
  await act(async () => { button(root, 'References').props.onPress(); });
  const links = root.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'link');
  assert.deepEqual(links.map(n => n.props.accessibilityLabel), ['https://www.example.com/doc', 'https://example.org/']);
  links[0].props.onPress();
  assert.deepEqual(state.opened, ['https://www.example.com/doc']);
  await act(async () => { button(root, 'References').props.onPress(); });
  assert.equal(root.root.findAll(n => n.props.accessibilityRole === 'link').length, 0, 'second tap collapses');
  await act(async () => { button(root, 'References').props.onPress(); });
  assert.equal(loads, 1, 'reopening reuses the loaded list');
  root.unmount();
  const failing = await mount({ actions: { sources: async () => { throw new Error('offline'); } } });
  await act(async () => { button(failing, 'References').props.onPress(); });
  assert.ok(failing.root.findAll(n => n.type === 'Text').some(n => n.props.children === 'Could not load references. Try again later.'));
  failing.unmount();
  const empty = await mount({ actions: { sources: async () => [] } });
  await act(async () => { button(empty, 'References').props.onPress(); });
  assert.ok(empty.root.findAll(n => n.type === 'Text').some(n => n.props.children === 'No web pages were used for this reply.'));
  empty.unmount();
});

test('References and Branch finish under StrictMode effect replay', async () => {
  const actions = { branch: async () => {}, sources: async () => [{ url: 'https://example.org/', kind: 'cited' }] };
  let root;
  await act(async () => { root = create(React.createElement(React.StrictMode, null, React.createElement(MessageToolbar, { row, canRetry: false, running: false, actions }))); });
  await act(async () => { button(root, 'References').props.onPress(); });
  assert.equal(root.root.findAll(n => n.type === 'Text').some(n => n.props.children === 'Loading references…'), false, 'loading must end');
  assert.deepEqual(root.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'link').map(n => n.props.accessibilityLabel), ['https://example.org/']);
  await act(async () => { button(root, 'Branch').props.onPress(); });
  assert.equal(button(root, 'Branch').props.accessibilityState.busy, false, 'Branch busy state must clear');
  root.unmount();
});

test('a final reply names its model at the end of the toolbar; no model shows nothing', async () => {
  let root = await mount({ actions: { exportMessage() {} }, row: { ...row, model: 'claude-opus-5-5' } });
  const label = root.root.find(n => n.props.testID === 'message-model');
  assert.equal(label.props.children, 'claude-opus-5-5');
  assert.equal(label.props.numberOfLines, 1);
  assert.equal(label.props.accessibilityLabel, 'Generated by claude-opus-5-5');
  assert.equal(label.props.style.marginLeft, 'auto');
  const children = root.root.find(n => n.props.testID === 'message-toolbar').children[0].children;
  assert.equal(children[children.length - 1], label, 'model is the last item in the row');
  root.unmount();
  root = await mount({ actions: { exportMessage() {} } });
  assert.equal(root.root.findAll(n => n.props.testID === 'message-model').length, 0);
  root.unmount();
});
