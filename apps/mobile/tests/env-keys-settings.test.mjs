import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Settings > API keys (docs/env-keys.md): metadata in, one value out, administrator keys refused.
const alerts = [];
globalThis.__envKeysAlerts = alerts;
const mocks = {
  'react-native': `export const Pressable='Pressable',View='View'; export const StyleSheet={create:x=>x}; export const Alert={alert:(...a)=>globalThis.__envKeysAlerts.push(a)};`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
  './SettingsUI': `import React from 'react'; export const SettingsPage=p=>React.createElement('Page',null,p.children); export const SettingsSection=p=>React.createElement('Section',{title:p.title,footer:p.footer},p.children); export const SettingsBlock=p=>React.createElement('Block',null,p.children);`,
};
const bundle = await build({ entryPoints: [new URL('../src/EnvKeysSettings.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: new URL('..', import.meta.url).pathname }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { EnvKeysSettings } = mod.exports;

const flush = () => new Promise(r => setTimeout(r, 0));
const client = (rows, { refuse } = {}) => ({ sent: [], removed: [],
  async envKeys() { return { keys: rows.map(name => ({ name, set: true, preview: name === 'EXA_API_KEY' ? '…0002' : '', sandbox: name !== 'EXA_API_KEY' })), suggestions: [{ name: 'TAVILY_API_KEY', description: 'Tavily search' }] }; },
  async setEnvKey(name, value) { if (refuse) { const e = new Error('managed'); e.status = 403; throw e; } this.sent.push([name, value]); rows.push(name); return { name, set: true, preview: '', sandbox: true }; },
  async removeEnvKey(name) { this.removed.push(name); rows.splice(rows.indexOf(name), 1); return true; } });
const render = async c => { let root; await act(async () => { root = create(React.createElement(EnvKeysSettings, { client: c })); await flush(); }); return root; };
const pressable = (root, label) => { const node = root.root.findAll(n => n.type === 'Pressable').find(n => n.props.accessibilityLabel === label); assert.ok(node, 'missing ' + label); return node; };
const press = async (root, label) => { await act(async () => { pressable(root, label).props.onPress(); await flush(); }); };
const input = (root, label) => root.root.findAll(n => n.type === 'TextInput').find(n => n.props.accessibilityLabel === label);
const type = async (root, label, text) => { await act(async () => { input(root, label).props.onChangeText(text); }); };
const texts = root => root.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));

test('lists keys with their last characters and sandbox state, never values', async () => {
  const root = await render(client(['EXA_API_KEY', 'MY_SERVICE_KEY']));
  const shown = texts(root);
  assert.ok(shown.includes('EXA_API_KEY') && shown.includes('MY_SERVICE_KEY'));
  assert.ok(shown.includes('Ends in 0002'));
  assert.equal(shown.filter(t => t === 'Commands can read it').length, 1);
});

test('adds a key: the name is normalized, the value is masked and sent once', async () => {
  const c = client([]); const root = await render(c);
  await press(root, 'Add API key');
  assert.equal(input(root, 'Value').props.secureTextEntry, true);
  await press(root, 'Use TAVILY_API_KEY');
  assert.equal(input(root, 'Name').props.value, 'TAVILY_API_KEY');
  await type(root, 'Name', 'my-service key');
  assert.equal(input(root, 'Name').props.value, 'MY_SERVICE_KEY');
  await type(root, 'Value', 'svc-\nvalue');
  await press(root, 'Save key');
  assert.deepEqual(c.sent, [['MY_SERVICE_KEY', 'svc-value']]);
  assert.ok(texts(root).includes('MY_SERVICE_KEY saved. Hermes uses it from your next message.'));
  assert.equal(input(root, 'Value'), undefined, 'the form closes and the value is cleared');
});

test('changes and removes a key; an administrator key shows a plain refusal', async () => {
  const c = client(['MY_SERVICE_KEY']); const root = await render(c);
  await press(root, 'Change MY_SERVICE_KEY');
  await type(root, 'New value', 'next-value');
  await press(root, 'Save');
  assert.deepEqual(c.sent, [['MY_SERVICE_KEY', 'next-value']]);
  await press(root, 'Remove MY_SERVICE_KEY');
  const [title, , buttons] = alerts.at(-1);
  assert.equal(title, 'Remove MY_SERVICE_KEY?');
  await act(async () => { await buttons.find(b => b.text === 'Remove').onPress(); await flush(); });
  assert.deepEqual(c.removed, ['MY_SERVICE_KEY']);
  const locked = client([], { refuse: true }); const page = await render(locked);
  await press(page, 'Add API key');
  await type(page, 'Name', 'TERMINAL_ENV'); await type(page, 'Value', 'local');
  await press(page, 'Save key');
  assert.ok(texts(page).includes('Your administrator manages this key.'));
});
