import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Shared test state: router calls, alerts, connection list and actions.
const state = { pushed: [], replaced: [], back: 0, alerts: [], removed: [], added: [], slot: 'primary', connections: [], app: null, font: 'Default' };
globalThis.__settingsTest = state;
const mocks = {
  'react-native': `const s=globalThis.__settingsTest; export const Alert={alert:(...a)=>s.alerts.push(a)}; export const Pressable='Pressable',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  'expo-router': `const s=globalThis.__settingsTest; export const useRouter=()=>({push:r=>s.pushed.push(r),replace:r=>s.replaced.push(r),back:()=>{s.back++},canGoBack:()=>true});`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './FontSize': `const s=globalThis.__settingsTest; export const Text='Text',TextInput='TextInput'; export const useFontSize=()=>({choice:s.font}); export const FontSizeSettings='FontSizeSettings';`,
  './AgentSettings': `export const AgentNameSettings='AgentNameSettings';`,
  './ModelSettings': `export const ModelSettings='ModelSettings';`,
  './AppIcon': `const s=globalThis.__settingsTest; export const useAppIcon=()=>({available:!!s.iconAvailable,current:s.icon??'mochi'}); export const AppIconSettings='AppIconSettings';`,
  './connections': `const s=globalThis.__settingsTest; export const useConnections=()=>({connections:s.connections,listError:'',removeConnection:async slot=>{s.removed.push(slot)},renameConnection:async (slot,name)=>{if(s.failRename)throw Error('private detail');s.renamed.push([slot,name])},addConnection:async (server,code)=>{s.added.push([server,code]);return 'c'.repeat(24)}}); export const useApp=()=>s.app;`,
};
const bundle = await build({ entryPoints: [new URL('../src/SettingsScreens.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { SettingsHome, ConnectionSettings, AddConnectionSettings } = mod.exports;

const runtime = (slot, name, extra = {}) => ({ slot, name, server: `https://${name}`, status: 'online', damaged: false, pairing: null, pairingStatus: '', error: '', config: { id: slot + '-id' }, client: { connectionState: 'online' }, ...extra });
const texts = root => root.root.findAllByType('Text').map(node => [].concat(node.props.children).filter(v => typeof v === 'string').join('')).filter(Boolean);
const buttons = root => root.root.findAll(node => node.type === 'Pressable');
const press = async (root, label) => { const node = buttons(root).find(b => b.props.accessibilityLabel === label); assert.ok(node, 'missing ' + label + ' in ' + buttons(root).map(b => b.props.accessibilityLabel)); await act(async () => node.props.onPress()); };
const reset = () => Object.assign(state, { pushed: [], replaced: [], back: 0, alerts: [], removed: [], added: [], renamed: [], failRename: false });

test('Settings level 1 groups connections, then This device', async () => {
  reset(); state.font = 'Large';
  state.connections = [runtime('primary', 'personal.example'), runtime('b'.repeat(24), 'work.example', { status: 'blocked' })];
  let root; await act(async () => { root = create(React.createElement(SettingsHome)); });
  const all = texts(root);
  assert.ok(all.indexOf('Connections') >= 0 && all.indexOf('Connections') < all.indexOf('This device'), 'scope sections in order');
  assert.ok(!all.includes('Appearance'), 'old feature-named section removed');
  assert.ok(all.includes('Needs attention'), 'state shown at level 1');
  assert.ok(all.includes('Large'), 'font size value shown at level 1');
  await press(root, 'work.example, Needs attention, https://work.example');
  assert.deepEqual(state.pushed.at(-1), { pathname: '/settings/connection', params: { connection: 'b'.repeat(24) } });
  await press(root, 'Add connection');
  assert.equal(state.pushed.at(-1), '/settings/add-connection');
  await press(root, 'Font size, Large');
  assert.equal(state.pushed.at(-1), '/settings/font-size');
  assert.ok(!all.includes('App icon'), 'App icon row hidden without the native module (Expo Go)');
  root.unmount();
});

test('Settings level 1 shows App icon under This device when the native module exists', async () => {
  reset(); state.iconAvailable = true; state.icon = 'orb';
  state.connections = [runtime('primary', 'personal.example')];
  let root; await act(async () => { root = create(React.createElement(SettingsHome)); });
  const all = texts(root);
  assert.ok(all.indexOf('App icon') > all.indexOf('This device'), 'App icon inside This device');
  await press(root, 'App icon, Orb');
  assert.equal(state.pushed.at(-1), '/settings/app-icon');
  state.iconAvailable = false; state.icon = undefined;
  root.unmount();
});

test('Connection level 2 groups status, this Hermes (model), this device (name) and confirmed removal', async () => {
  reset();
  state.connections = [runtime('primary', 'personal.example')];
  state.app = { slot: 'primary', config: { id: 'primary-id' }, client: { connectionState: 'online' }, agentName: { name: 'Tuly', ready: true, error: '', saving: false, save: async () => true, reload() {} } };
  let root; await act(async () => { root = create(React.createElement(ConnectionSettings)); });
  const all = texts(root);
  const order = ['Status', 'On this Hermes · all your devices', 'Default model', 'On this device'].map(heading => all.indexOf(heading));
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => !i || v > order[i - 1]), 'scope groups in order: ' + order);
  // Server-wide model sits above the device-only name; each control sits inside its own scope.
  const tree = JSON.stringify(root.toJSON());
  assert.ok(tree.indexOf('"Default model"') < tree.indexOf('ModelSettings') && tree.indexOf('ModelSettings') < tree.indexOf('"On this device"'));
  assert.ok(tree.indexOf('"On this device"') < tree.indexOf('AgentNameSettings'));
  assert.equal(root.root.findAllByType('AgentNameSettings').length, 1);
  assert.equal(root.root.findAllByType('ModelSettings').length, 1);
  await press(root, 'Remove connection personal.example');
  assert.equal(state.removed.length, 0, 'removal waits for confirmation');
  const [, message, actions] = state.alerts.at(-1);
  assert.match(message, /server conversations are unchanged/);
  await act(async () => { actions.find(a => a.style === 'destructive').onPress(); await Promise.resolve(); });
  assert.deepEqual(state.removed, ['primary']);
  assert.equal(state.back, 0, 'route ownership, not this page, pops the removed connection');
  root.unmount();
});

test('every Settings gear opens Settings home; only Settings itself opens a connection page', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const src = new URL('../src/', import.meta.url);
  const files = (await readdir(src, { recursive: true })).filter(name => /\.tsx?$/.test(name));
  const direct = [], gears = [];
  for (const name of files) {
    const text = await readFile(new URL(name, src), 'utf8');
    if (text.includes('connectionSettingsRoute(') && !['SettingsScreens.tsx', 'settingsRoutes.ts'].includes(name)) direct.push(name);
    for (const match of text.matchAll(/onSettings=\{\(\) => ([^}]*)\}/g)) gears.push([name, match[1]]);
  }
  assert.deepEqual(direct, [], 'connection Settings is reached only through Settings home');
  assert.ok(gears.length >= 2, 'home and Channel gears found: ' + JSON.stringify(gears));
  for (const [name, target] of gears) assert.equal(target, "router.push('/settings')", name);
  // The Session page has one header entry; its Settings row opens the same Settings home.
  const options = await readFile(new URL('SessionOptions.tsx', src), 'utf8');
  assert.match(options, /title="Settings" onPress=\{\(\) => router\.push\('\/settings'\)\}/);
});

test('offline connection explains model settings instead of failing', async () => {
  reset();
  state.connections = [runtime('primary', 'personal.example', { status: 'retrying' })];
  state.app = { slot: 'primary', config: { id: 'primary-id' }, client: { connectionState: 'retrying' }, agentName: { name: 'Agent', ready: true, error: '', saving: false, save: async () => true, reload() {} } };
  let root; await act(async () => { root = create(React.createElement(ConnectionSettings)); });
  assert.equal(root.root.findAllByType('ModelSettings').length, 0);
  assert.ok(texts(root).includes('Model settings are available when this connection is online.'));
  root.unmount();
});

test('connection name: host name as default, save, safe failure, and available while pairing', async () => {
  reset();
  state.connections = [runtime('primary', 'personal.example', { customName: null })];
  state.app = { slot: 'primary', config: { id: 'primary-id' }, client: { connectionState: 'online' }, agentName: { name: 'Agent', ready: true, error: '', saving: false, save: async () => true, reload() {} } };
  let root; await act(async () => { root = create(React.createElement(ConnectionSettings)); });
  const field = () => root.root.findAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Connection name')[0];
  assert.equal(field().props.placeholder, 'personal.example'); assert.equal(field().props.value, '');
  const tree = JSON.stringify(root.toJSON());
  assert.ok(tree.indexOf('"On this device"') < tree.indexOf('Connection name') && tree.indexOf('Connection name') < tree.indexOf('AgentNameSettings'), 'name sits in device scope, above Agent name');
  assert.equal(buttons(root).find(b => b.props.accessibilityLabel === 'Save connection name').props.disabled, true, 'unchanged name cannot be saved');
  await act(async () => field().props.onChangeText('Home'));
  await press(root, 'Save connection name');
  assert.deepEqual(state.renamed, [['primary', 'Home']]); assert.ok(texts(root).includes('Saved.'));
  state.failRename = true;
  await act(async () => field().props.onChangeText('Office'));
  await press(root, 'Save connection name');
  assert.ok(texts(root).includes('Could not save the name. Nothing changed. Try again.')); assert.ok(!texts(root).some(t => t.includes('private detail')));
  assert.equal(field().props.value, 'Office', 'typed text is kept after a failure');
  root.unmount();
  // A connection that is still pairing has no Agent name yet, but can be named.
  reset();
  state.connections = [runtime('primary', 'personal.example', { customName: 'Home', name: 'Home', status: 'pairing', config: null })];
  state.app = { slot: 'primary', config: null, client: null, agentName: { name: 'Agent', ready: false, error: '', saving: false, save: async () => false, reload() {} } };
  await act(async () => { root = create(React.createElement(ConnectionSettings)); });
  assert.equal(field().props.value, 'Home'); assert.equal(root.root.findAllByType('AgentNameSettings').length, 0);
  root.unmount();
});

test('Add connection pairs and opens the new connection page', async () => {
  reset();
  state.connections = [runtime('primary', 'personal.example')];
  let root; await act(async () => { root = create(React.createElement(AddConnectionSettings)); });
  const inputs = root.root.findAllByType('TextInput');
  await act(async () => { inputs[0].props.onChangeText('https://work.example'); inputs[1].props.onChangeText('ABCD-EFGH-IJKL-MNOP'); });
  await press(root, 'Pair connection');
  assert.deepEqual(state.added, [['https://work.example', 'ABCD-EFGH-IJKL-MNOP']]);
  assert.deepEqual(state.replaced.at(-1), { pathname: '/settings/connection', params: { connection: 'c'.repeat(24) } });
  root.unmount();
});
