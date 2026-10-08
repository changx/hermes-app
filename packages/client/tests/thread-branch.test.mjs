import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, HttpError } from '../dist/index.js';

const thread = { id: 'th_branchnew0001', project_id: 'p_one', title: 'Plan (branch)', archived: false };
const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: {
      request: async (...args) => { calls.push(args); return reply(...args); },
      download: async (path, token) => { calls.push(['DOWNLOAD', path, token]); return { status: 200, body: new TextEncoder().encode('# Plan\n\nhé\n') }; },
    },
  });
  return { sdk, calls };
};

test('branchThread posts the anchor with a stable request id and returns the new Thread', async () => {
  const { sdk, calls } = client((method, path) => path.endsWith('/branch') ? { status: 201, body: { thread } } : { status: 200, body: { thread } });
  assert.deepEqual(await sdk.branchThread('th_source00001', 42, 'br_req-1'), thread);
  assert.deepEqual(calls[0].slice(0, 2), ['POST', '/v1/threads/th_source00001/branch']);
  assert.deepEqual(calls[0][3], { anchor_ref_seq: 42, request_id: 'br_req-1' });
  await assert.rejects(sdk.branchThread('th_source00001', 0, 'br_req-1'), /invalid branch/);
  await assert.rejects(sdk.branchThread('th_source00001', 4, 'bad id'), /invalid branch/);
});

test('branch failures expose the server reason code; other errors keep no code', async () => {
  const { sdk } = client(() => ({ status: 409, body: { error: 'busy' } }));
  const failure = await sdk.branchThread('th_source00001', 42, 'br_req-2').catch(e => e);
  assert.ok(failure instanceof HttpError);
  assert.equal(failure.status, 409);
  assert.equal(failure.code, 'busy');
  const plain = await client(() => ({ status: 500, body: 'oops' })).sdk.branchThread('th_source00001', 42, 'br_req-3').catch(e => e);
  assert.equal(plain.code, undefined);
  const odd = await client(() => ({ status: 409, body: { error: 'Not A Code!' } })).sdk.branchThread('th_source00001', 42, 'br_req-4').catch(e => e);
  assert.equal(odd.code, undefined, 'only short machine codes pass through');
});

test('messageSources keeps web links only and the read/cited kind', async () => {
  const sources = [{ url: 'https://example.com/doc', kind: 'read' }, { url: 'https://example.org/x', kind: 'cited' }];
  const { sdk, calls } = client(() => ({ status: 200, body: { sources } }));
  assert.deepEqual(await sdk.messageSources('th_source00001', 7), sources);
  assert.equal(calls[0][1], '/v1/threads/th_source00001/messages/7/sources');
  const bad = client(() => ({ status: 200, body: { sources: [{ url: 'javascript:alert(1)', kind: 'read' }] } })).sdk;
  await assert.rejects(bad.messageSources('th_source00001', 7), /invalid source/);
});

test('exportThread downloads the conversation and decodes UTF-8 Markdown', async () => {
  const { sdk, calls } = client(() => ({ status: 200, body: {} }));
  assert.equal(await sdk.exportThread('th_source00001'), '# Plan\n\nhé\n');
  assert.deepEqual(calls[0], ['DOWNLOAD', '/v1/threads/th_source00001/export', 'synthetic-device']);
});

test('capabilities enable branch, sources and export only when the server reports them', async () => {
  const caps = { protocol: 1, thread_branch: true, message_sources: true, thread_export: true };
  const { sdk } = client(() => ({ status: 200, body: caps }));
  await sdk.capabilities();
  assert.deepEqual([sdk.supportsThreadBranch, sdk.supportsMessageSources, sdk.supportsThreadExport], [true, true, true]);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.deepEqual([old.supportsThreadBranch, old.supportsMessageSources, old.supportsThreadExport], [false, false, false]);
});

test('history keeps the notice kind of system notices', async () => {
  const messages = [{ id: 'n1', ref_seq: 3, role: 'system', display_kind: 'system_notice', notice_kind: 'branch', text: 'Branched to [X](hermesapp://session/th_x00001)' },
    { id: 'n2', ref_seq: 4, role: 'system', display_kind: 'system_notice', notice_kind: 'weird', text: 'other' }];
  const { sdk } = client(() => ({ status: 200, body: { messages, next_cursor: null, receipts: [], incomplete_turns: [], turn_outcomes: [] } }));
  const page = await sdk.history('th_source00001');
  assert.deepEqual(page.messages.map(m => m.notice_kind), ['branch', undefined]);
});
