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
