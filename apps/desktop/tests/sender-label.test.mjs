import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
  export { DesktopShellView } from './src/renderer/shell';
  export { DesktopConnectionService } from './src/main/connection-service';
  export { HermesClient, HttpError } from '@hermes-app/client';
` }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'react', 'react/jsx-runtime'] });
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'electron' ? {} : require(name), mod, mod.exports);
const { DesktopShellView, DesktopConnectionService, HermesClient, HttpError } = mod.exports;
const MEMBER_ERROR = 'This device is not linked to a team member. You can read but not send.';
function fixture(thread = 'th_member') {
  const saved = new Map(), localDrafts = new Map(); let sends = 0, closed = 0;
  const service = new DesktopConnectionService(() => {}, { credentials: {},
    outbox: { list: async () => [...saved.values()], put: async (_, value) => saved.set(value.id, value), remove: async (_, id) => saved.delete(id) },
    drafts: { put: async (_, id, value) => localDrafts.set(id, value), flush: async () => {} } });
  service.connection = { id: 'a'.repeat(24), baseUrl: 'https://example.test' };
  service.phase = 'connected'; service.connectionState = 'online'; service.selectedThreadId = thread;
  const client = { channels: new Map([['p', { id: 'p', name: 'Project' }]]), threads: new Map([[thread, { id: thread, project_id: 'p', title: thread, archived: false }]]),
    messages: new Map(), receipts: new Map(), interactions: new Map(), attachments: new Map(), vaultPrompts: new Map(),
    isCatalogueReady: true, isThreadAvailable: () => true, page: () => undefined,
    send: async () => { sends++; throw new HttpError(403, undefined, `/v1/threads/${thread}/messages`, 'device_not_bound'); },
    close: () => { closed++; } };
  service.client = client;
  return { service, client, saved, localDrafts, get sends() { return sends; }, get closed() { return closed; } };
}
function environment(api = {}) {
  globalThis.window = { hermesDesktop: { loadLocalDrafts: async () => ({}), saveLocalDraft: async () => {}, ...api }, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  globalThis.document = { activeElement: null };
}
async function mount(snapshot, api = {}) {
  environment(api); let tree;
  await act(async () => { tree = create(React.createElement(DesktopShellView, { snapshot, viewRole: 'tab' })); });
  return tree;
}
const input = tree => tree.root.findByProps({ 'aria-label': 'Message' });

test('desktop projects sender labels and stripped display/copy text without altering wire history or legacy rows', async () => {
  const f = fixture();
  const raw = [{ id: 'member', ref_seq: 1, role: 'user', text: '[Wang.Sheng-1] hello', sender: 'Wang.Sheng-1' },
    { id: 'legacy', ref_seq: 2, role: 'user', text: '[legacy] hello' },
    { id: 'invalid', ref_seq: 3, role: 'user', text: '[bad name] hello', sender: 'bad name' }];
  const sdk = new HermesClient({ token: () => 'synthetic-device', socket: {}, http: { request: async () => ({ status: 200, body: { messages: raw, receipts: [], next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }) } });
  await sdk.history('th_member'); f.client.messages = sdk.messages;
  const snapshot = f.service.snapshot('th_member', false);
  assert.deepEqual(snapshot.messages.map(m => [m.text, m.sender]), [['hello', 'Wang.Sheng-1'], ['[legacy] hello', undefined], ['[bad name] hello', undefined]]);
  assert.equal(sdk.messages.get('th_member')[0].text, '[Wang.Sheng-1] hello');
  const copies = [], tree = await mount(snapshot, { copyText: async text => copies.push(text) });
  try {
    assert.equal(tree.root.findByProps({ className: 'user-message-sender' }).children.join(''), 'Wang.Sheng-1');
    const copyButtons = tree.root.findAllByProps({ 'aria-label': 'Copy message' });
    await act(async () => { for (const button of copyButtons) await button.props.onClick(); });
    assert.deepEqual(copies, ['hello', '[legacy] hello', '[bad name] hello']);
    const html = renderToStaticMarkup(React.createElement(DesktopShellView, { snapshot: { ...snapshot, draftIdentity: undefined }, viewRole: 'tab' }));
    assert.ok(html.indexOf('user-message-sender') < html.indexOf('message message-user'), 'label precedes the bubble');
    assert.equal((html.match(/user-message-sender/g) ?? []).length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('desktop member rejection retains read access and original send, and never retries on flush or cold outbox load', async () => {
  const f = fixture();
  const original = { text: '  keep my draft\n中文  ', attachmentIds: [], clientMessageId: 'desktop:123e4567-e89b-12d3-a456-000000000001' };
  try {
    await f.service.sendMessage(original);
    assert.equal(f.sends, 1); assert.equal(f.closed, 0);
    assert.equal(f.service.snapshot('th_member', false).connectionState, 'online');
    assert.equal(f.service.snapshot('th_member', false).errorMessage, undefined, 'do not advise re-pairing a readable device');
    const saved = f.saved.get(original.clientMessageId);
    assert.equal(saved.state, 'blocked'); assert.equal(saved.blockedReason, 'device_not_bound');
    assert.equal(saved.text, original.text);
    await f.service.flushOutbox(); await f.service.deliver(saved);
    assert.equal(f.sends, 1);
    const cold = fixture(); cold.service.outbox = [JSON.parse(JSON.stringify(saved))];
    await cold.service.flushOutbox();
    assert.equal(cold.sends, 0);
    assert.equal(cold.service.snapshot('th_member', false).messages[0].sendError, MEMBER_ERROR);
    assert.equal(f.service.snapshot('other_thread', false).messages.length, 0);
  } finally { clearTimeout(f.service.outboxTimer); }
});

test('an acknowledged member message still deduplicates same-ID delivery using the submitted body', async () => {
  const f = fixture(), id = 'desktop:123e4567-e89b-12d3-a456-000000000002';
  f.client.messages.set('th_member', [{ id: 'member', ref_seq: 1, role: 'user', text: '[Alice] [Alice] user text', sender: 'Alice', client_message_id: id }]);
  await f.service.sendMessage({ text: '[Alice] user text', attachmentIds: [], clientMessageId: id });
  assert.equal(f.sends, 0);
  await assert.rejects(f.service.sendMessage({ text: 'different', attachmentIds: [], clientMessageId: id }), /identity changed/);
});

test('ordinary revoked credentials still block the connection rather than claiming read-only membership', async () => {
  for (const status of [401, 403]) {
    const f = fixture();
    f.client.send = async () => { throw new HttpError(status); };
    try {
      await f.service.sendMessage({ text: 'hello', attachmentIds: [] });
      assert.equal(f.closed, 1);
      assert.equal(f.service.snapshot('th_member', false).connectionState, 'blocked');
      assert.match(f.service.snapshot('th_member', false).errorMessage, /no longer authorized/);
      assert.equal(f.service.outbox[0].blockedReason, undefined);
    } finally { clearTimeout(f.service.outboxTimer); }
  }
});

test('desktop inline composer error restores the rejected draft after send returns and survives reopening', async () => {
  const f = fixture('th_member_composer'), original = '  saved composer text\n中文  ';
  let snapshot = f.service.snapshot('th_member_composer', false);
  const tree = await mount(snapshot, { sendMessage: value => f.service.sendMessage(value) });
  try {
    await act(async () => input(tree).props.onChange({ target: { value: original } }));
    await act(async () => tree.root.findByProps({ 'aria-label': 'Send message' }).props.onClick());
    snapshot = f.service.snapshot('th_member_composer', false);
    await act(async () => tree.update(React.createElement(DesktopShellView, { snapshot, viewRole: 'tab' })));
    assert.equal(input(tree).props.value, original);
    const composer = tree.root.findByProps({ 'aria-label': 'Message composer' });
    assert.equal(composer.findByProps({ role: 'alert' }).children.join(''), MEMBER_ERROR);
    assert.equal(f.sends, 1);
    await act(async () => tree.unmount());
    const reopened = await mount(snapshot);
    try { assert.equal(input(reopened).props.value, original); }
    finally { await act(async () => reopened.unmount()); }
  } finally { await act(async () => tree.unmount()); clearTimeout(f.service.outboxTimer); }
});

test('late member failure does not replace newer desktop draft text', async () => {
  const f = fixture('th_member_newer');
  const tree = await mount(f.service.snapshot('th_member_newer', false));
  try {
    await act(async () => input(tree).props.onChange({ target: { value: 'newer draft' } }));
    f.service.outbox = [{ version: 1, id: 'older', threadId: 'th_member_newer', text: 'older draft', attachmentIds: [], createdAt: 1000, state: 'blocked', blockedReason: 'device_not_bound' }];
    await act(async () => tree.update(React.createElement(DesktopShellView, { snapshot: f.service.snapshot('th_member_newer', false), viewRole: 'tab' })));
    assert.equal(input(tree).props.value, 'newer draft');
  } finally { await act(async () => tree.unmount()); }
});
