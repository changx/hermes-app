import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';
import { build } from 'esbuild';

// liveProtocol.ts uses extensionless imports; bundle it for Node.
const bundled = await build({ stdin: { contents: "export { parseCatalogue } from './liveProtocol'; export { inRecents } from './recents';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundled.outputFiles[0].text)(mod, mod.exports);
const { parseCatalogue, inRecents } = mod.exports;

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};

const job = (extra = {}) => ({ id: 'j1', name: 'Daily article', schedule_display: 'every 1440m', state: 'scheduled', enabled: true,
  next_run_at: '2026-10-12T08:00:00-07:00', last_run_at: null, last_status: null, last_error: null, last_delivery_error: null,
  running: false, targets: [{ channel_id: 'p_a', mode: 'new' }], thread_count: 3, unread_count: 1, ...extra });

test('Automations need both server capabilities', async () => {
  for (const [body, expected] of [[{ protocol: 1, automations: true, thread_origin: true }, true], [{ protocol: 1, automations: true }, false], [{ protocol: 1 }, false]]) {
    const { sdk } = client(() => ({ status: 200, body }));
    await sdk.capabilities();
    assert.equal(sdk.supportsAutomations, expected);
  }
});

test('Automations list and detail parse, page and escape the job ID', async () => {
  const { sdk, calls } = client((method, path) => path === '/v1/automations'
    ? { status: 200, body: { automations: [job(), job({ id: 'j2', enabled: false, state: 'paused', last_status: 'delivery_failed', targets: [], unread_count: 0 })] } }
    : { status: 200, body: { automation: job({ prompt: 'Write it' }), threads: [{ id: 'th_1', project_id: 'p_a', title: 'Daily article · Oct 11', origin: 'automation', runs: 1, completed_unread: true, result_version: 4, result_ref: 9 }], next_before: 12 } });
  const list = await sdk.automations();
  assert.deepEqual(list.map(j => [j.id, j.enabled, j.failed, j.targets.length, j.unreadCount]), [['j1', true, false, 1, 1], ['j2', false, true, 0, 0]]);
  assert.equal(list[0].prompt, undefined);
  const detail = await sdk.automation('a/b', 12);
  assert.equal(calls.at(-1)[1], '/v1/automations/a%2Fb?before=12');
  assert.equal(detail.automation.prompt, 'Write it');
  assert.deepEqual(detail.threads[0], { id: 'th_1', channelId: 'p_a', title: 'Daily article · Oct 11', runs: 1, completedUnread: true, resultVersion: 4, resultRef: 9 });
  assert.equal(detail.nextBefore, 12);
});

test('Automations reject malformed responses', async () => {
  for (const body of [{}, { automations: [job({ thread_count: -1 })] }, { automations: [job({ targets: [{ channel_id: 'p', mode: 'other' }] })] }]) {
    const { sdk } = client(() => ({ status: 200, body }));
    await assert.rejects(sdk.automations());
  }
});

test('Catalogue carries origin and participation; Recents uses them', () => {
  const page = parseCatalogue({ next_after: null, items: [
    { kind: 'session', value: { id: 'a', project_id: 'p', title: 'A', archived: false, running: false, origin: 'automation', participated: false, last_message_at: 100 } },
    { kind: 'session', value: { id: 'b', project_id: 'p', title: 'B', archived: false, running: false, last_message_at: 100 } },
  ] });
  assert.deepEqual(page.items.map(i => [i.value.origin, i.value.participated]), [['automation', false], [undefined, undefined]]);
  assert.throws(() => parseCatalogue({ next_after: null, items: [{ kind: 'session', value: { id: 'a', project_id: 'p', title: 'A', archived: false, running: false, origin: 'robot' } }] }));
  assert.equal(inRecents({ origin: 'automation', participated: false, lastMessageAt: 100 }, 200), false);
  assert.equal(inRecents({ origin: 'automation', participated: true, lastMessageAt: 100 }, 200), true);
  assert.equal(inRecents({ lastMessageAt: 100 }, 200), true, 'older servers send no origin');
  assert.equal(inRecents({ lastMessageAt: 100 }, 100 + 86401), false);
  assert.equal(inRecents({ running: true }, 0), true);
});
