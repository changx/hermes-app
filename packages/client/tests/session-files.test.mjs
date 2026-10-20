import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LiveSessionClient } = module.exports;

const row = (id, list, extra = {}) => ({ id, thread_id: 'th_one', name: id + '.png', mime: 'image/png', size: 3, receipt_id: 'r1', state: 'available', list, created_at: 100, ref_seq: 7, ...extra });
const A = 'att_' + 'a'.repeat(32), B = 'att_' + 'b'.repeat(32);
const client = (respond, requests = []) => new LiveSessionClient({ token: () => 'synthetic', onChange: () => {},
  socket: { connect: async () => { throw Error('no socket expected'); } },
  http: { request: async (method, path) => { requests.push([method, path]); return { status: 200, body: respond(path) }; } } });

test('Session file list reads one list with a validated cursor', async () => {
  const requests = [];
  const c = client(() => ({ thread_id: 'th_one', list: 'delivered', items: [row(A, 'delivered', { caption: 'Chart' })], next_after: `100:${A}` }), requests);
  const page = await c.files.list('th_one', 'delivered');
  assert.deepEqual(requests, [['GET', '/v1/threads/th_one/files?list=delivered&limit=100']]);
  assert.equal(page.items[0].caption, 'Chart'); assert.equal(page.items[0].ref_seq, 7); assert.equal(page.nextAfter, `100:${A}`);
  await c.files.list('th_one', 'delivered', `100:${A}`);
  assert.equal(requests[1][1], `/v1/threads/th_one/files?list=delivered&limit=100&after=100%3A${encodeURIComponent(A)}`);
});

test('Session file list rejects foreign rows, mixed lists and a cursor that does not advance', async () => {
  for (const body of [
    { thread_id: 'th_one', list: 'delivered', items: [row(A, 'delivered', { thread_id: 'th_other' })], next_after: null },
    { thread_id: 'th_one', list: 'delivered', items: [row(A, 'uploaded')], next_after: null },
    { thread_id: 'th_one', list: 'delivered', items: [row(A, 'delivered'), row(A, 'delivered')], next_after: null },
    { thread_id: 'th_one', list: 'delivered', items: [row(A, 'delivered')], next_after: `100:${B}` },
    { thread_id: 'th_two', list: 'delivered', items: [], next_after: null },
  ]) await assert.rejects(client(() => body).files.list('th_one', 'delivered'));
  await assert.rejects(client(() => ({})).files.list('th_one', 'all'));
});

test('File search sends keyword and labels and validates location fields', async () => {
  const requests = [];
  const hit = { ...row(B, 'uploaded'), thread_title: '季度报告', channel_id: 'p_one', channel_name: 'One' };
  const c = client(() => ({ query: '图表', labels: ['报告', 'todo'], items: [hit], next_after: null }), requests);
  const page = await c.files.search(' 图表 ', ['报告', 'todo']);
  const url = new URL('http://x' + requests[0][1]);
  assert.equal(url.pathname, '/v1/files/search'); assert.equal(url.searchParams.get('q'), '图表');
  assert.deepEqual(url.searchParams.getAll('labels'), ['报告', 'todo']);
  assert.equal(page.items[0].thread_title, '季度报告'); assert.equal(page.items[0].channel_name, 'One');
  await assert.rejects(client(() => ({ query: '图表', labels: ['报告'], items: [], next_after: null })).files.search('图表', ['报告', 'todo']));
  await assert.rejects(client(() => ({})).files.search('  ', []));
  const labelsOnly = await client(() => ({ query: '', labels: ['报告'], items: [], next_after: null })).files.search('', ['报告']);
  assert.deepEqual(labelsOnly.items, []);
});

test('A ranked file search keeps its order, needs ranks 1..n and has no cursor', async () => {
  const hit = (id, rank) => ({ ...row(id, 'delivered'), thread_title: 'T', channel_id: 'p_one', channel_name: null, rank });
  const page = await client(() => ({ query: 'chart', labels: [], items: [hit(B, 1), hit(A, 2)], next_after: null, ranked: true })).files.search('chart');
  assert.equal(page.ranked, true); assert.deepEqual(page.items.map(i => [i.id, i.rank]), [[B, 1], [A, 2]]); assert.equal(page.nextAfter, null);
  for (const body of [
    { query: 'chart', labels: [], items: [hit(B, 2), hit(A, 1)], next_after: null, ranked: true },
    { query: 'chart', labels: [], items: [hit(B, 1)], next_after: `100:${B}`, ranked: true },
    { query: 'chart', labels: [], items: [{ ...hit(B, 1), rank: undefined }], next_after: null, ranked: true },
  ]) await assert.rejects(client(() => body).files.search('chart'));
  const plain = await client(() => ({ query: 'chart', labels: [], items: [hit(B, 9)], next_after: null })).files.search('chart');
  assert.equal(plain.ranked, false); assert.equal(plain.items[0].rank, undefined, 'an unranked page ignores rank fields');
});

test('A search result file opens without opening its Session and leaves the chat caches untouched', async () => {
  const requests = [], writes = [];
  const meta = { attachment: { id: A, thread_id: 'th_other', name: 'clip.mp4', mime: 'video/mp4', size: 9908074, receipt_id: 'r1', state: 'available' } };
  const c = new LiveSessionClient({ token: () => 'synthetic', onChange: () => {},
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (method, path) => { requests.push([method, path]); return { status: 200, body: meta }; },
      downloadFile: async (path, _token, destination) => { writes.push([path, destination]); return { status: 200, size: 9908074 }; } } });
  // The chat API refuses a Session that is not open; the file API must not.
  await assert.rejects(c.getAttachment('th_other', A), /not open/);
  const file = await c.files.metadata('th_other', A);
  assert.deepEqual(requests, [['GET', `/v1/threads/th_other/attachments/${A}/metadata`]]);
  assert.equal(file.state, 'available'); assert.equal(file.size, 9908074);
  assert.equal(await c.files.downloadFile(file, '/tmp/out.mp4'), 9908074);
  assert.deepEqual(writes, [[`/v1/threads/th_other/attachments/${A}`, '/tmp/out.mp4']]);
  assert.equal(c.attachments.get(A), undefined);
  await assert.rejects(c.files.downloadFile({ ...file, state: 'missing' }, '/tmp/x'), /unavailable/);
  await assert.rejects(c.files.metadata('th_other', 'not-a-file'));
});

test('A file download fails when the written size differs and metadata must match the request', async () => {
  const short = new LiveSessionClient({ token: () => 'synthetic', onChange: () => {}, socket: { connect: async () => { throw Error('no socket'); } },
    http: { request: async () => ({ status: 200, body: { attachment: { id: B, thread_id: 'th_one', name: 'x', mime: 'x', size: 3, receipt_id: null, state: 'available' } } }),
      downloadFile: async () => ({ status: 200, size: 2 }) } });
  await assert.rejects(short.files.downloadFile(await short.files.metadata('th_one', B), '/tmp/x'), /incomplete/);
  await assert.rejects(short.files.metadata('th_two', B), /mismatch/);
});
