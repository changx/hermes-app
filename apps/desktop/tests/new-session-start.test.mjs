import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
// Synthetic fixtures only. A new text-only session opens at once: the first message is saved in the
// outbox before any request; the session is created (same client ID on retry), then the message is sent.
const bundle = await build({ stdin: { contents: "export * from './src/main/connection-service'; export { HttpError } from '@hermes-app/client';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopConnectionService, HttpError } = module.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async fn => { const end = Date.now() + 2000; while (!fn()) { assert.ok(Date.now() < end, 'condition timed out'); await tick(); } };
const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };

function fixture({ create } = {}) {
  const calls = [], stored = [];
  const outbox = { async list() { return []; }, async put(_id, record) { calls.push('store:' + record.id.slice(-4) + ':' + record.state); const i = stored.findIndex(r => r.id === record.id); if (i < 0) stored.push(record); else stored[i] = record; },
    async remove(_id, id) { calls.push('remove:' + id.slice(-4)); const i = stored.findIndex(r => r.id === id); if (i >= 0) stored.splice(i, 1); }, async clear() {} };
  const drafts = { async list() { return {}; }, async put() {}, async clear() {}, async flush() {} };
  const service = new DesktopConnectionService(() => {}, { credentials: {}, outbox, drafts });
  service.connection = { id: 'a'.repeat(24), baseUrl: 'https://example.test' };
  service.phase = 'connected'; service.connectionState = 'online';
  const pages = new Map();
  const client = {
    channels: new Map([['p', { id: 'p', name: 'Project' }]]), threads: new Map(), messages: new Map(), receipts: new Map(), attachments: new Map(), interactions: new Map(),
    isCatalogueReady: true, supportsAutomationEditors: true,
    isThreadAvailable: id => client.threads.has(id),
    async createThread(channelId, title, id, model, confirm, options) {
      calls.push('create:' + title + (options.automationEditor ? ':automation' : '')); await (create?.(id) ?? Promise.resolve());
      const row = { id, project_id: channelId, title, archived: false }; client.threads.set(id, row); return row;
    },
    async send(threadId, id) { calls.push('send:' + id.slice(-4)); return { id: 'r_' + id.slice(-4), client_message_id: id, thread_id: threadId, durable: true, ref_seq: calls.length }; },
    rememberAcceptedInput() {},
    page: id => pages.get(id), releasePage(id) { pages.delete(id); },
    acquirePage(id) { calls.push('open'); const page = { messages: client.messages, currentOlderCursor: undefined, async openConversation(_id, _r, _t, ready) { ready?.(); } }; pages.set(id, page); return page; },
  };
  service.client = client;
  return { service, client, calls, stored };
}
const id = n => 'desktop:00000000-0000-4000-8000-00000000000' + n;
const input = { title: 'New topic', clientThreadId: 'th_new000000001', channelId: 'p', text: 'hello', clientMessageId: id(1) };

test('the session shows before any request; create, then send, in order', async () => {
  const hold = gate(), { service, calls } = fixture({ create: () => hold.promise });
  assert.equal(await service.startThread(input), 'th_new000000001');
  // The outbox record was written first; the create request is still waiting.
  assert.deepEqual(calls, ['store:0001:pending', 'create:New topic']);
  await service.selectThread('th_new000000001');
  const shown = service.snapshot('th_new000000001');
  assert.equal(shown.threads.find(t => t.id === 'th_new000000001')?.title, 'New topic');
  assert.equal(shown.selectedThreadId, 'th_new000000001');
  assert.deepEqual(shown.messages.map(m => [m.text, m.optimistic]), [['hello', true]]);
  hold.open();
  await until(() => calls.includes('remove:0001'));
  assert.deepEqual(calls.filter(c => !c.startsWith('store:')), ['create:New topic', 'open', 'send:0001', 'remove:0001']);
});

test('a message typed while the session is being created waits, then follows the first', async () => {
  const hold = gate(), { service, calls } = fixture({ create: () => hold.promise });
  await service.startThread(input);
  await service.sendMessage({ text: 'second', attachmentIds: [], clientMessageId: id(2) }, 'th_new000000001');
  assert.ok(!calls.some(c => c.startsWith('send:')), 'nothing is sent before the session exists');
  hold.open();
  await until(() => calls.includes('remove:0002'));
  const sends = calls.filter(c => c.startsWith('send:'));
  assert.deepEqual(sends, ['send:0001', 'send:0002']);
});

test('a rejected create keeps the message, shows a plain error and sends nothing', async () => {
  const { service, calls, stored } = fixture({ create: () => Promise.reject(new HttpError(409)) });
  await service.startThread(input);
  await until(() => stored[0]?.state === 'blocked');
  assert.ok(!calls.some(c => c.startsWith('send:')));
  assert.match(service.snapshot('th_new000000001').errorMessage, /could not be started/);
  assert.equal(service.snapshot('th_new000000001').messages[0].text, 'hello');
});

test('a temporary create failure stays pending and the retry uses the same session ID', async () => {
  let attempts = 0;
  const { service, calls, stored, client } = fixture({ create: () => (++attempts === 1 ? Promise.reject(new HttpError(503)) : Promise.resolve()) });
  await service.startThread(input);
  await until(() => attempts === 1 && !service.delivering.size);
  assert.equal(stored[0].state, 'pending');
  assert.ok(!calls.some(c => c.startsWith('send:')));
  await service.flushOutbox();
  await until(() => calls.includes('remove:0001'));
  assert.ok(client.threads.has('th_new000000001'));
  assert.deepEqual(calls.filter(c => c.startsWith('create') || c.startsWith('send')), ['create:New topic', 'create:New topic', 'send:0001']);
});

test('New automation tabs create the settings conversation; invalid starts store nothing', async () => {
  const { service, calls } = fixture();
  await service.startThread({ ...input, title: 'New automation', automationEditor: true });
  await until(() => calls.includes('remove:0001'));
  assert.ok(calls.includes('create:New automation:automation'));
  const other = fixture();
  await assert.rejects(other.service.startThread({ ...input, text: '   ' }));
  await assert.rejects(other.service.startThread({ ...input, channelId: 'missing' }));
  await assert.rejects(other.service.startThread({ ...input, clientMessageId: 'desktop:bad' }));
  assert.deepEqual(other.calls, []);
});
