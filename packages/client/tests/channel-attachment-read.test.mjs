import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LiveSessionClient } = module.exports;
const attachment = { id: 'att_one', thread_id: 'th_closed', name: 'note.txt', mime: 'text/plain', size: 4, state: 'available', receipt_id: null };
function fixture(download) {
  const calls = [];
  const client = new LiveSessionClient({ token: () => 'synthetic-credential', http: {
    async request(method, path) { calls.push([method, path]); return { status: 200, body: { channel_id: 'p_one', items: [attachment], next_after: null } }; },
    async download(path, token, signal) { calls.push(['download', path]); assert.equal(token, 'synthetic-credential'); return download(path, signal); },
  }, socket: { async connect() { throw Error('must not open a conversation'); } } });
  return { client, calls };
}
test('real LiveSessionClient explicitly reads selected inventory attachment with no conversation or chat caches', async () => {
  const bytes = new TextEncoder().encode('note'), f = fixture(async () => ({ status: 200, body: bytes }));
  try {
    const page = await f.client.workspace.attachments('p_one');
    await assert.rejects(f.client.download(attachment.thread_id, attachment.id), /not open/);
    assert.equal(await f.client.workspace.readAttachment(page.items[0]), bytes);
    assert.deepEqual(f.calls, [['GET', '/v1/channels/p_one/attachments?limit=100'], ['download', '/v1/threads/th_closed/attachments/att_one']]);
    assert.equal(f.client.currentThreadId, null);
    for (const map of [f.client.messages, f.client.receipts, f.client.attachments, f.client.interactions]) assert.equal(map.size, 0);
  } finally { f.client.close(); }
});
test('explicit attachment read preserves abort and HTTP failures, validates selection and bounds', async () => {
  let observed;
  const f = fixture(async (_path, signal) => { observed = signal; return { status: 403, body: new Uint8Array() }; });
  try {
    for (const invalid of [{ ...attachment, state: 'missing' }, { ...attachment, state: 'deleted' }, { ...attachment, id: '../att_one' }, { ...attachment, thread_id: '../thread' }, { ...attachment, size: 10485761 }]) await assert.rejects(f.client.workspace.readAttachment(invalid));
    assert.equal(f.calls.length, 0);
    const controller = new AbortController();
    await assert.rejects(f.client.workspace.readAttachment(attachment, controller.signal), error => error.status === 403);
    assert.ok(observed instanceof AbortSignal); // bounded transport cancels its owned signal after settlement
  } finally { f.client.close(); }
  const pending = fixture((_path, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })));
  try {
    const controller = new AbortController(), read = pending.client.workspace.readAttachment(attachment, controller.signal);
    controller.abort(); await assert.rejects(read, /aborted/);
  } finally { pending.client.close(); }
  const large = fixture(async () => ({ status: 200, body: new Uint8Array(10485761) }));
  try { await assert.rejects(large.client.workspace.readAttachment(attachment), /exceeds limit/); } finally { large.client.close(); }
});
