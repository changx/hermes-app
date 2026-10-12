import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// New conversation with a model choice: the real composer and shared client, a fake server.
const state = { alerts: [], focused: true, uuid: 0 };
globalThis.__threadModelTest = state;
const mocks = {
  'react-native': `const s=globalThis.__threadModelTest; export const Pressable='Pressable',View='View',Modal='Modal',FlatList=({data,renderItem,ListEmptyComponent})=>data.length?data.map((item,index)=>renderItem({item,index})):ListEmptyComponent; export const Platform={OS:'ios'}; export const StyleSheet={create:x=>x}; export const Alert={alert:(...a)=>s.alerts.push(a)};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  'expo-router': `export const useIsFocused=()=>globalThis.__threadModelTest.focused;`,
  'expo-crypto': `export const randomUUID=()=>'00000000-0000-4000-8000-'+String(++globalThis.__threadModelTest.uuid).padStart(12,'0');`,
  './FontSize': `export const Text='Text',TextInput='TextInput';`,
  './Attachments': `import React from 'react'; export const AttachmentComposer=({children,send,handleRef})=>{ if(handleRef) handleRef.current={uploadTo:async()=>[]}; return React.createElement('View',null,children,send); };`,
  './ComposerCard': `import React from 'react'; export const ComposerSendButton=({onPress,disabled})=>React.createElement('Pressable',{accessibilityLabel:'Send',onPress,disabled});`,
};
const bundle = await build({ entryPoints: [new URL('../src/NewTopicComposer.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react'], plugins: [{ name: 'boundary', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { NewTopicComposer } = mod.exports;
const clientBundle = await build({ entryPoints: [new URL('../../../packages/client/src/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const shared = { exports: {} }; new Function('module', 'exports', 'require', clientBundle.outputFiles[0].text)(shared, shared.exports, require);
const { HermesClient } = shared.exports;

const SETTINGS = { scope: 'connected-default', provider: 'anthropic', model: 'claude-opus-5-5', providers: [
  { id: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
  { id: 'openai-codex', name: 'OpenAI Codex', models: ['gpt-6-luna'] }] };

function server({ thread_model = true, settings = SETTINGS, onCreate } = {}) {
  const calls = [];
  const client = new HermesClient({ token: () => 'synthetic', socket: { connect: async () => { throw Error('no socket'); } },
    http: { request: async (method, path, token, body) => {
      calls.push({ method, path, body });
      if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, thread_model } };
      if (path === '/v1/agent/model/options') return { status: 200, body: settings };
      if (path.endsWith('/threads')) return onCreate ? onCreate(body, calls) : { status: 201, body: { thread: { id: body.client_thread_id, project_id: 'p', title: 'New topic', archived: false },
        model: body.model ? { provider: body.model.provider, model: body.model.model } : null } };
      if (path.startsWith('/v1/threads/')) return { status: 200, body: { thread: { id: path.split('/')[3], project_id: 'p', title: 'New topic', archived: false } } };
      throw new Error('unexpected ' + path);
    } } });
  return { client, calls, creates: () => calls.filter(c => c.path.endsWith('/threads')).map(c => c.body) };
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });
const pressables = root => root.root.findAll(n => n.type === 'Pressable');
const byLabel = (root, label) => pressables(root).find(n => n.props.accessibilityLabel === label);
const press = async (root, label) => { const node = byLabel(root, label); assert.ok(node, 'missing ' + label + ': ' + pressables(root).map(n => n.props.accessibilityLabel)); await act(async () => { node.props.onPress(); }); await flush(); };
const type = async (root, text) => { const input = root.root.findAll(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'First message')[0]; await act(async () => { input.props.onChangeText(text); }); };
async function render(c, props = {}) {
  await c.capabilities();
  const sent = [];
  let root;
  await act(async () => { root = create(React.createElement(NewTopicComposer, { client: c, channelId: 'p', showModel: true,
    enqueue: async (...args) => { sent.push(args); }, onCreated: () => {}, ...props })); });
  await flush();
  return { root, sent };
}

test('the default is the primary model and sends no model', async () => {
  state.alerts = [];
  const s = server(); const { root, sent } = await render(s.client);
  assert.ok(byLabel(root, 'Model: Default (claude-opus-5-5)'));
  await type(root, 'hello'); await press(root, 'Send');
  // Text only with the default model: the composer sends no create request; the outbox
  // record carries the create (no model) and the page opens at once.
  assert.deepEqual(s.creates(), []);
  assert.equal(sent.length, 1);
  assert.match(sent[0][0], /^th_[a-f0-9]{32}$/);
  assert.deepEqual(sent[0].slice(2), ['hello', [], { channelId: 'p', title: 'New topic' }]);
  root.unmount();
});

test('a chosen model is sent with creation and locks the control', async () => {
  state.alerts = [];
  const s = server(); const { root, sent } = await render(s.client);
  await press(root, 'Model: Default (claude-opus-5-5)');
  assert.ok(byLabel(root, 'Default (claude-opus-5-5), Primary model'));
  assert.equal(byLabel(root, 'claude-opus-5-5, Anthropic'), undefined, 'the primary model is listed once, as Default');
  await press(root, 'gpt-6-luna, OpenAI Codex');
  assert.ok(byLabel(root, 'Model: gpt-6-luna'));
  await type(root, 'hello'); await press(root, 'Send');
  assert.deepEqual(s.creates()[0].model, { provider: 'openai-codex', model: 'gpt-6-luna' });
  assert.equal(sent.length, 1);
  root.unmount();
});

test('a warning asks first; Use model repeats the same Thread with confirmation, Cancel unlocks', async () => {
  state.alerts = [];
  const onCreate = (body) => body.model.confirm_selection ? { status: 201, body: { thread: { id: body.client_thread_id, project_id: 'p', title: 'New topic', archived: false }, model: { provider: body.model.provider, model: body.model.model } } }
    : { status: 200, body: { confirmation_required: true, warning: 'This model trains on your data.', provider: body.model.provider, model: body.model.model } };
  const s = server({ onCreate }); const { root, sent } = await render(s.client);
  await press(root, 'Model: Default (claude-opus-5-5)'); await press(root, 'claude-sonnet-5-5, Anthropic');
  await type(root, 'hello'); await press(root, 'Send');
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0][1], 'This model trains on your data.');
  assert.equal(sent.length, 0, 'nothing is sent before confirmation');
  assert.equal(byLabel(root, 'Model: claude-sonnet-5-5').props.disabled, true);
  await act(async () => { state.alerts[0][2][1].onPress(); }); await flush();
  const [first, second] = s.creates();
  assert.equal(second.client_thread_id, first.client_thread_id, 'same Thread identity');
  assert.deepEqual(second.model, { provider: 'anthropic', model: 'claude-sonnet-5-5', confirm_selection: true });
  assert.equal(sent.length, 1);
  root.unmount();

  state.alerts = [];
  const again = server({ onCreate }); const view = await render(again.client);
  await press(view.root, 'Model: Default (claude-opus-5-5)'); await press(view.root, 'claude-sonnet-5-5, Anthropic');
  await type(view.root, 'hello'); await press(view.root, 'Send');
  await act(async () => { state.alerts[0][2][0].onPress(); }); await flush();
  assert.equal(byLabel(view.root, 'Model: claude-sonnet-5-5').props.disabled, false, 'Cancel lets the user choose again');
  assert.equal(view.sent.length, 0);
  view.root.unmount();
});

test('another Channel resets the choice and reloads that connection\'s list', async () => {
  state.alerts = [];
  const a = server(), b = server({ settings: { ...SETTINGS, provider: 'openai-codex', model: 'gpt-6-luna', providers: [{ id: 'openai-codex', name: 'OpenAI Codex', models: ['gpt-6-luna', 'gpt-6-sol'] }] } });
  await b.client.capabilities();
  const { root } = await render(a.client);
  await press(root, 'Model: Default (claude-opus-5-5)'); await press(root, 'gpt-6-luna, OpenAI Codex');
  await act(async () => { root.update(React.createElement(NewTopicComposer, { client: b.client, channelId: 'q', showModel: true, enqueue: async () => {}, onCreated: () => {} })); });
  await flush();
  assert.ok(byLabel(root, 'Model: Default (gpt-6-luna)'), pressables(root).map(n => n.props.accessibilityLabel).join());
  assert.equal(b.calls.filter(c => c.path === '/v1/agent/model/options').length, 1);
  root.unmount();
});

test('an older server shows no model control and sends no model', async () => {
  state.alerts = [];
  const s = server({ thread_model: false }); const { root, sent } = await render(s.client);
  assert.equal(pressables(root).some(n => String(n.props.accessibilityLabel).startsWith('Model:')), false);
  assert.equal(s.calls.some(c => c.path === '/v1/agent/model/options'), false);
  await type(root, 'hello'); await press(root, 'Send');
  assert.deepEqual(s.creates(), []);
  assert.deepEqual(sent[0][4], { channelId: 'p', title: 'New topic' });
  root.unmount();
});

test('the Channel page composer shows the control only while typing or after a choice', async () => {
  state.alerts = [];
  const s = server(); const { root } = await render(s.client, { showModel: false });
  assert.equal(pressables(root).some(n => String(n.props.accessibilityLabel).startsWith('Model:')), false);
  assert.equal(s.calls.some(c => c.path === '/v1/agent/model/options'), false, 'no list request while hidden');
  const input = root.root.findAll(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'First message')[0];
  await act(async () => { input.props.onFocus(); }); await flush();
  assert.ok(byLabel(root, 'Model: Default (claude-opus-5-5)'));
  root.unmount();
});

test('a rejected model unlocks the choice with a plain message and sends nothing', async () => {
  state.alerts = [];
  const s = server({ onCreate: body => body.model ? { status: 400, body: {} } : { status: 201, body: { thread: { id: body.client_thread_id, project_id: 'p', title: 'New topic', archived: false }, model: null } } });
  const { root, sent } = await render(s.client);
  await press(root, 'Model: Default (claude-opus-5-5)'); await press(root, 'gpt-6-luna, OpenAI Codex');
  await type(root, 'hello'); await press(root, 'Send');
  const alert = root.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'alert');
  assert.match(String(alert[0].props.children), /model is not available/);
  assert.equal(s.creates().length, 1, 'a rejected model is not retried');
  assert.equal(byLabel(root, 'Model: gpt-6-luna').props.disabled, false);
  await press(root, 'Model: gpt-6-luna'); await press(root, 'Default (claude-opus-5-5), Primary model');
  await press(root, 'Send');
  // Back to the default model: the outbox creates the session; a new session ID is used.
  assert.equal(s.creates().length, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][4], { channelId: 'p', title: 'New topic' });
  assert.notEqual(sent[0][0], s.creates()[0].client_thread_id);
  root.unmount();
});

test('a file or a chosen model keeps the old order; an automation start carries its flag', async () => {
  state.alerts = [];
  const s = server(); const { root, sent } = await render(s.client, { automationEditor: true });
  await type(root, 'every morning'); await press(root, 'Send');
  assert.deepEqual(s.creates(), []);
  assert.deepEqual(sent[0][4], { channelId: 'p', title: 'New automation', automationEditor: true });
  root.unmount();
  const m = server(); const chosen = await render(m.client);
  await press(chosen.root, 'Model: Default (claude-opus-5-5)'); await press(chosen.root, 'gpt-6-luna, OpenAI Codex');
  await type(chosen.root, 'hello'); await press(chosen.root, 'Send');
  assert.equal(m.creates().length, 1, 'a chosen model is created by the composer first');
  assert.equal(chosen.sent[0][4], undefined);
  chosen.root.unmount();
});
