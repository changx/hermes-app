import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HermesClient, HttpError, ProtocolError, utf8Size, workspacePath } from '../dist/index.js';
const version = content => '"' + createHash('sha256').update(content).digest('hex') + '"';
const cid = 'p_one';
const state = initialized => ({ workspace: { channel_id: cid, initialized, root: '', agents_path: 'AGENTS.md', rules_effect: 'new_sessions', limits: { agents_bytes: 12000, file_bytes: 10485760 } } });
function fixture() {
  const calls = []; let content = null, initialized = false, response;
  const body = (method, path) => {
    if (response) return response(method, path);
    if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, durable_sync: true, channel_workspace: true, channel_files: true, channel_agents: true } };
    if (path.endsWith('/workspace')) { if (method === 'POST') initialized = true; return { status: 200, body: state(initialized) }; }
    if (path.endsWith('/agents')) return content === null ? { status: 404, body: 'missing' } : { status: 200, body: { channel_id: cid, path: 'AGENTS.md', content, etag: version(content), rules_effect: 'new_sessions' } };
    throw Error(path);
  };
  const http = { async request(method, path, token, data, signal) { calls.push({ method, path, token, data, signal }); return body(method, path); },
    async conditionalRequest(method, path, token, headers, data) {
      calls.push({ method, path, token, headers, data });
      assert.equal(method, 'PUT'); assert.equal(path, '/v1/channels/p_one/agents');
      if (headers['If-None-Match'] === '*' && content !== null || headers['If-Match'] && headers['If-Match'] !== (content === null ? null : version(content))) return { status: 412, body: 'changed' };
      content = data.content; return { status: 200, body: { channel_id: cid, path: 'AGENTS.md', etag: version(content) } };
    },
    async download(path, token, signal) { calls.push({ path, token, signal, binary: true }); return { status: 200, body: new TextEncoder().encode('file bytes') }; } };
  const client = new HermesClient({ http, token: () => 'synthetic', socket: { async connect() { throw Error('unused'); } } });
  return { client, calls, http, set content(value) { content = value; }, get content() { return content; }, set response(value) { response = value; } };
}

test('UTF-8 limits match real encoder and invalid paths/tokens are not repaired', () => {
  for (const value of ['', 'AGENTS.md', '中文', 'emoji 🌍', 'x'.repeat(12000), 'e\u0301']) assert.equal(utf8Size(value), new TextEncoder().encode(value).length);
  for (const value of ['\ud800', '\udc00']) assert.throws(() => utf8Size(value));
  for (const p of ['../x', '/etc/passwd', 'a//b', 'a/../b', 'a\\b', '.env', 'a\n', 'C:/a']) assert.throws(() => workspacePath(p));
  assert.equal(workspacePath('目录/with spaces.md'), '目录/with spaces.md');
  assert.equal(workspacePath('', true), '');
});

test('workspace requires negotiated server capabilities and conditional transport, with no eager details', async () => {
  const f = fixture(); assert.equal(f.client.supportsChannelWorkspace, false);
  await f.client.capabilities(); assert.equal(f.client.supportsChannelWorkspace, true);
  assert.equal(f.calls.length, 1); assert.equal(f.client.channels.size, 0);
  delete f.http.conditionalRequest;
  await f.client.capabilities(); assert.equal(f.client.supportsChannelWorkspace, false);
  await assert.rejects(f.client.workspace.saveAgents(cid, 'rules', null), ProtocolError);
});

test('explicit setup is idempotent and reads authority back without chat/cache writes', async () => {
  const f = fixture();
  assert.equal((await f.client.workspace.getState(cid)).initialized, false);
  assert.equal((await f.client.workspace.initialize(cid)).initialized, true);
  assert.deepEqual(f.calls.slice(-2).map(x => x.method), ['POST', 'GET']);
  await f.client.workspace.initialize(cid);
  assert.equal(f.client.channels.size, 0); assert.equal(f.client.messages.size, 0);
});

test('AGENTS create, replace and clear preserve exact bytes and original ETag, followed by readback', async () => {
  const f = fixture();
  const first = await f.client.workspace.saveAgents(cid, '\n中文 rules\n ', null);
  assert.equal(first.content, '\n中文 rules\n ');
  assert.deepEqual(f.calls[0].headers, { 'If-None-Match': '*' });
  assert.equal(f.calls[1].method, 'GET');
  await f.client.workspace.saveAgents(cid, '', first.etag);
  assert.equal(f.content, ''); assert.deepEqual(f.calls[2].headers, { 'If-Match': first.etag });
  assert.equal(f.client.messages.size, 0);
});

test('stale version produces conflict rather than fetching a new version and overwriting', async () => {
  const f = fixture(); f.content = 'Someone else saved';
  await assert.rejects(f.client.workspace.saveAgents(cid, 'my text', version('old')), error => error instanceof HttpError && error.status === 412);
  assert.equal(f.content, 'Someone else saved'); assert.equal(f.calls.length, 1);
  await assert.rejects(f.client.workspace.saveAgents(cid, 'my text', 'not-an-etag'), ProtocolError);
  assert.equal(f.calls.length, 1);
});

test('readback mismatch, UTF-8 overflow and foreign identity reject success', async () => {
  const f = fixture();
  await assert.rejects(f.client.workspace.saveAgents(cid, '汉'.repeat(4001), null), ProtocolError);
  assert.equal(f.calls.length, 0);
  f.response = () => ({ status: 200, body: { channel_id: cid, path: 'AGENTS.md', content: 'changed after PUT', etag: version('changed after PUT'), rules_effect: 'new_sessions' } });
  await assert.rejects(f.client.workspace.saveAgents(cid, 'mine', null), ProtocolError);
  f.response = () => ({ status: 200, body: { ...state(true), workspace: { ...state(true).workspace, channel_id: 'p_other' } } });
  await assert.rejects(f.client.workspace.getState(cid), ProtocolError);
});

test('directory pages validate actual relative paths, child ownership and advancing Unicode cursor', async () => {
  const f = fixture();
  f.response = () => ({ status: 200, body: { channel_id: cid, path: 'docs', items: [{ name: '🌍.md', path: 'docs/🌍.md', kind: 'file', size: 4 }], next_after: null } });
  const page = await f.client.workspace.list(cid, 'docs', '\ue000.txt');
  assert.equal(page.items[0].path, 'docs/🌍.md');
  assert.match(f.calls[0].path, /path=docs&limit=100&after=/);
  for (const item of [{ name: 'a', path: '../a', kind: 'file', size: 1 }, { name: 'a', path: 'docs/a', kind: ['file'], size: 1 }]) {
    f.response = () => ({ status: 200, body: { channel_id: cid, path: 'docs', items: [item], next_after: null } });
    await assert.rejects(f.client.workspace.list(cid, 'docs'), ProtocolError);
  }
  f.response = () => ({ status: 200, body: { channel_id: cid, path: 'docs', items: [], next_after: 'again' } });
  await assert.rejects(f.client.workspace.list(cid, 'docs'), ProtocolError);
});

test('file download is authenticated/bounded and invalid paths make no request', async () => {
  const f = fixture(), controller = new AbortController();
  assert.equal(new TextDecoder().decode(await f.client.workspace.readFile(cid, 'docs/中文.md', controller.signal)), 'file bytes');
  assert.equal(f.calls[0].token, 'synthetic'); assert.match(f.calls[0].path, /path=docs%2F/);
  assert.ok(f.calls[0].signal instanceof AbortSignal);
  const count = f.calls.length;
  await assert.rejects(f.client.workspace.readFile(cid, '../other'), ProtocolError);
  await assert.rejects(f.client.workspace.getState('p_one/other'), ProtocolError);
  assert.equal(f.calls.length, count);
});

test('attachment inventory does not populate chat caches or use external public URLs', async () => {
  const f = fixture();
  f.response = () => ({ status: 200, body: { channel_id: cid, items: [{ id: 'att_one', thread_id: 'th_one', name: 'note.txt', mime: 'text/plain', size: 4, receipt_id: null, state: 'available', public_url: 'https://example.test/credential' }], next_after: null } });
  const page = await f.client.workspace.attachments(cid);
  assert.equal(page.items[0].id, 'att_one'); assert.equal(page.items[0].public_url, undefined);
  assert.equal(f.client.attachments.size, 0); assert.equal(f.client.messages.size, 0);
});
