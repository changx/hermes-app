import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Channel Context page: the primary folder binds a server folder; readback confirms the change.
const state = { alerts: [] };
globalThis.__channelPrimaryTest = state;
const mocks = {
  'react-native': `const s=globalThis.__channelPrimaryTest; export const Pressable='Pressable',ScrollView='ScrollView',View='View',ActivityIndicator='ActivityIndicator'; export const Platform={OS:'ios'}; export const StyleSheet={create:x=>x,hairlineWidth:1}; export const Alert={alert:(...a)=>s.alerts.push(a)};`,
  'expo-router': `import React from 'react'; export const useFocusEffect=f=>React.useEffect(()=>f(),[f]); export const useNavigation=()=>({dispatch(){}});`,
  'expo-router/react-navigation': `export const usePreventRemove=()=>{};`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
  './MessageContent': `export const MessageContent=()=>null;`,
  '../../../packages/client/src/index': `export class HttpError extends Error { constructor(status){ super('HTTP '+status); this.status=status; } } globalThis.__channelPrimaryTest.HttpError=HttpError;`,
};
const bundle = await build({ entryPoints: [new URL('../src/ChannelContextScreen.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { ChannelContextScreen } = mod.exports;
const { HttpError } = state;

const client = ({ bound = null, supported = true, update } = {}) => {
  const c = { supportsChannelPrimaryPath: supported, detail: { id: 'p', name: 'P', description: 'ctx', bound_primary_path: bound }, patches: [],
    async getChannelInfo() { return { ...this.detail }; },
    async updateChannel(id, patch) { this.patches.push(patch); if (update) return update(this, patch); this.detail = { ...this.detail, bound_primary_path: patch.primary_path }; return this.detail; } };
  return c;
};
const tick = () => new Promise(r => setTimeout(r, 0));
const render = async c => { let root; await act(async () => { root = create(React.createElement(ChannelContextScreen, { client: c, channelId: 'p' })); await tick(); }); return root; };
const pressables = root => root.root.findAll(n => n.type === 'Pressable');
const find = (root, label) => { const n = pressables(root).find(x => x.props.accessibilityLabel === label); assert.ok(n, 'missing ' + label + ' in ' + pressables(root).map(x => x.props.accessibilityLabel)); return n; };
const has = (root, label) => pressables(root).some(x => x.props.accessibilityLabel === label);
const press = async (root, label) => { const n = find(root, label); await act(async () => { n.props.onPress(); await tick(); }); };
const input = root => root.root.findAll(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Primary folder')[0];
const type = async (root, text) => { await act(async () => { input(root).props.onChangeText(text); }); };
const texts = root => root.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const alertText = root => root.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'alert').map(n => n.props.children).join(' ');

test('sets a primary folder, strips a trailing slash, and confirms by readback', async () => {
  const c = client(); const root = await render(c);
  assert.ok(texts(root).includes('Not set'));
  assert.ok(!has(root, 'Remove'));
  await press(root, 'Set');
  await type(root, '  /opt/projects/jamie/app/ ');
  await press(root, 'Save');
  assert.deepEqual(c.patches, [{ primary_path: '/opt/projects/jamie/app' }]);
  assert.equal(input(root), undefined, 'the editor closes after a confirmed save');
  assert.ok(texts(root).includes('/opt/projects/jamie/app'));
  assert.ok(has(root, 'Change') && has(root, 'Remove'));
  root.unmount();
});

test('remove asks first and sends null', async () => {
  state.alerts = [];
  const c = client({ bound: '/opt/projects/x' }); const root = await render(c);
  await press(root, 'Remove');
  assert.equal(c.patches.length, 0, 'nothing is sent before confirmation');
  const [title, , buttons] = state.alerts.at(-1);
  assert.equal(title, 'Remove primary folder?');
  await act(async () => { buttons.find(b => b.text === 'Remove').onPress(); await tick(); });
  assert.deepEqual(c.patches, [{ primary_path: null }]);
  assert.ok(texts(root).includes('Not set'));
  root.unmount();
});

test('server rejections keep the draft and show a plain reason', async () => {
  for (const [status, reason] of [[400, /inside \/opt\/projects/], [409, /Another channel already uses this folder/], [503, /Could not confirm/]]) {
    const c = client({ update: () => { throw new HttpError(status); } });
    const root = await render(c);
    await press(root, 'Set'); await type(root, '/opt/projects/bad'); await press(root, 'Save');
    assert.match(alertText(root), reason);
    assert.equal(input(root).props.value, '/opt/projects/bad', 'the typed folder stays');
    root.unmount();
  }
});

test('a readback mismatch is not reported as saved', async () => {
  const c = client({ update: () => ({}) }); const root = await render(c);
  await press(root, 'Set'); await type(root, '/opt/projects/a'); await press(root, 'Save');
  assert.match(alertText(root), /Could not confirm/);
  assert.ok(input(root), 'the editor stays open');
  root.unmount();
});

test('older servers do not show the folder section', async () => {
  const root = await render(client({ supported: false }));
  assert.ok(!has(root, 'Set') && !texts(root).includes('Primary folder'));
  root.unmount();
});
