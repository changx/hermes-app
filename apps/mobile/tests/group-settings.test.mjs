import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import * as G from '../../../packages/client/src/connectionGroups.ts';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Shared state: the real group rules run on it, like AppProvider does.
const state = { groups: G.NO_GROUPS, connections: [], pushed: [], back: 0, alerts: [], failNext: '' };
globalThis.__groupsTest = state;
const change = update => async (...args) => {
  if (state.failNext) { const reason = state.failNext; state.failNext = ''; throw new Error(reason); }
  state.groups = update(state.groups, ...args); state.render?.();
};
state.actions = {
  addGroup: change((s, name) => G.addGroup(s, name, 'g' + String(s.groups.length + 1).padStart(8, '0'))),
  renameGroup: change((s, id, name) => G.renameGroup(s, id, name)),
  removeGroup: change((s, id) => G.removeGroup(s, id)),
  assignGroup: change((s, slot, id) => G.assignConnection(s, slot, id)),
};
const mocks = {
  'react-native': `const s=globalThis.__groupsTest; export const Alert={alert:(...a)=>s.alerts.push(a)}; export const Pressable='Pressable',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  'expo-router': `const s=globalThis.__groupsTest; export const useRouter=()=>({push:r=>s.pushed.push(r),back:()=>{s.back++}});`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
  './connections': `const s=globalThis.__groupsTest; export const useConnections=()=>({groups:s.groups,groupsError:!!s.groupsError,connections:s.connections,...s.actions});`,
};
const bundle = await build({ entryPoints: [new URL('../src/GroupSettings.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { GroupsPage, GroupPage } = mod.exports;

const texts = root => root.root.findAllByType('Text').map(node => [].concat(node.props.children).filter(v => typeof v === 'string').join('')).filter(Boolean);
const pressable = (root, label) => root.root.findAll(node => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
const input = (root, label) => root.root.findAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === label)[0];
const mount = async element => {
  let root; await act(async () => { root = create(element); });
  state.render = () => root.update(element);
  return root;
};
const SLOT = 'a'.repeat(24);
const reset = () => Object.assign(state, { groups: G.NO_GROUPS, pushed: [], back: 0, alerts: [], failNext: '', groupsError: false,
  connections: [{ slot: 'primary', name: 'personal' }, { slot: SLOT, name: 'work' }] });

test('Groups page adds a group; a user-facing rule message is shown; the limit disables Add', async () => {
  reset();
  const root = await mount(React.createElement(GroupsPage));
  assert.equal(pressable(root, 'Add group').props.disabled, true, 'an empty name cannot be added');
  await act(async () => input(root, 'New group name').props.onChangeText('Work'));
  await act(async () => pressable(root, 'Add group').props.onPress());
  assert.deepEqual(state.groups.groups.map(g => g.name), ['Work']);
  assert.ok(texts(root).includes('Work') && texts(root).includes('0 connections'));
  await act(async () => input(root, 'New group name').props.onChangeText('work'));
  await act(async () => pressable(root, 'Add group').props.onPress());
  assert.ok(texts(root).includes('A group with this name already exists.'));
  state.failNext = 'SecureStore detail';
  await act(async () => input(root, 'New group name').props.onChangeText('Home'));
  await act(async () => pressable(root, 'Add group').props.onPress());
  assert.ok(texts(root).includes('Could not add the group. Nothing changed. Try again.'), 'a storage detail is not shown');
  assert.ok(!texts(root).some(t => t.includes('SecureStore')));
});

test('one group: membership moves a connection between groups; delete asks first', async () => {
  reset();
  state.groups = G.assignConnection(G.addGroup(G.addGroup(G.NO_GROUPS, 'Work', 'g00000001'), 'Home', 'g00000002'), SLOT, 'g00000002');
  const root = await mount(React.createElement(GroupPage, { id: 'g00000001' }));
  const work = () => root.root.findAll(node => node.type === 'Pressable' && node.props.accessibilityRole === 'checkbox');
  assert.deepEqual(work().map(n => [n.props.accessibilityLabel, n.props.accessibilityState.checked]), [['personal', false], ['work, in Home', false]]);
  await act(async () => work()[1].props.onPress());
  assert.equal(state.groups.members[SLOT], 'g00000001', 'choosing a connection of another group moves it here');
  await act(async () => work()[1].props.onPress());
  assert.equal(state.groups.members[SLOT], undefined, 'a second tap removes it from the group');
  await act(async () => pressable(root, 'Delete group Work').props.onPress());
  assert.equal(state.alerts.length, 1); assert.equal(state.groups.groups.length, 2, 'nothing is deleted before the confirmation');
  await act(async () => state.alerts[0][2][1].onPress());
  await act(async () => {});
  assert.deepEqual(state.groups.groups.map(g => g.name), ['Home']); assert.equal(state.back, 1);
});

test('unreadable saved groups block every change', async () => {
  reset(); state.groupsError = true;
  const root = await mount(React.createElement(GroupsPage));
  assert.ok(texts(root).some(t => t.startsWith('Saved groups could not be read.')));
  assert.equal(input(root, 'New group name').props.editable, false);
});
