import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LiveSessionClient } = module.exports;
const helpers = await build({ entryPoints: [new URL('../src/sessionText.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const helperModule = { exports: {} }; new Function('module', 'exports', helpers.outputFiles[0].text)(helperModule, helperModule.exports);
const { messageMatches } = helperModule.exports;

const hit = (id, rank, extra = {}) => ({ thread_id: id, title: 'Oceanpay 合规改造', channel_id: 'p_one', channel_name: 'One', markers: ['todo'], seq: 42, snippet: '…合规…', rank, ...extra });
const client = (respond, requests = [], caps = {}) => new LiveSessionClient({ token: () => 'synthetic', onChange: () => {},
  socket: { connect: async () => { throw Error('no socket expected'); } },
  http: { request: async (method, path) => { requests.push([method, path]); return { status: 200, body: path === '/v1/capabilities' ? { protocol: 1, ...caps } : respond(path) }; } } });

test('Session text search sends keyword and labels and validates ranked rows', async () => {
  const requests = [];
  const c = client(() => ({ query: 'oceanpay 合规', labels: ['todo'], available: true, ready: false, items: [hit('th_a', 1), hit('th_b', 2, { seq: null, snippet: '' })] }), requests);
  const page = await c.sessionText.search(' oceanpay 合规 ', ['todo']);
  const url = new URL('http://x' + requests[0][1]);
  assert.equal(url.pathname, '/v1/sessions/search');
  assert.equal(url.searchParams.get('q'), 'oceanpay 合规'); assert.deepEqual(url.searchParams.getAll('labels'), ['todo']);
  assert.equal(page.available, true); assert.equal(page.ready, false);
  assert.deepEqual(page.items.map(i => [i.thread_id, i.seq]), [['th_a', 42], ['th_b', null]]);
});

test('Session text search rejects bad input and bad responses', async () => {
  for (const [q, labels] of [['', []], ['  ', []], ['x'.repeat(201), []], ['x', ['']], ['x', Array(11).fill('a')]])
    await assert.rejects(client(() => ({})).sessionText.search(q, labels));
  for (const body of [
    { query: 'other', labels: [], available: true, items: [] },
    { query: 'q', labels: ['x'], available: true, items: [] },
    { query: 'q', labels: [], items: [] },
    { query: 'q', labels: [], available: true, items: [hit('th_a', 2)] },
    { query: 'q', labels: [], available: true, items: [hit('th_a', 1), hit('th_a', 2)] },
    { query: 'q', labels: [], available: true, items: [hit('../x', 1)] },
    { query: 'q', labels: [], available: true, items: [hit('th_a', 1, { seq: -1 })] },
  ]) await assert.rejects(client(() => body).sessionText.search('q'));
});

test('Refine reads the picked order and the none flag', async () => {
  const requests = [];
  const c = client(path => path.startsWith('/v1/sessions/search/refine') ? { query: 'q', labels: [], available: true, items: [hit('th_b', 1)], none: false } : {}, requests);
  const value = await c.sessionText.refine('q');
  assert.equal(new URL('http://x' + requests[0][1]).pathname, '/v1/sessions/search/refine');
  assert.deepEqual(value.items.map(i => i.thread_id), ['th_b']); assert.equal(value.none, false);
  const none = await client(() => ({ query: 'q', labels: [], available: true, items: [], none: true })).sessionText.refine('q');
  assert.equal(none.none, true);
  await assert.rejects(client(() => ({ query: 'q', labels: [], available: true, items: [] })).sessionText.refine('q'));
});

test('Capabilities turn on search and refine; refine needs search', async () => {
  const both = client(() => ({}), [], { session_search: true, session_search_refine: true });
  await both.capabilities();
  assert.equal(both.supportsSessionSearch, true); assert.equal(both.supportsSessionSearchRefine, true);
  const refineOnly = client(() => ({}), [], { session_search_refine: true });
  await refineOnly.capabilities();
  assert.equal(refineOnly.supportsSessionSearch, false); assert.equal(refineOnly.supportsSessionSearchRefine, false);
});

test('messageMatches drops Sessions listed by title and merges servers by rank', () => {
  const row = (server, id, rank) => ({ server, hit: hit(id, rank) });
  const one = [row('a', 'th_1', 1), row('a', 'th_2', 2), row('a', 'th_3', 3)], two = [row('b', 'th_1', 1), row('b', 'th_9', 2)];
  const out = messageMatches([one, two], new Set(['a:th_2']), r => `${r.server}:${r.hit.thread_id}`);
  assert.deepEqual(out.map(r => `${r.server}:${r.hit.thread_id}`), ['a:th_1', 'b:th_1', 'b:th_9', 'a:th_3']);
  assert.equal(messageMatches([one], new Set(), r => r.hit.thread_id, 2).length, 2);
});
