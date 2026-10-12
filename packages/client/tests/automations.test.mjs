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
  assert.equal(inRecents({ lastMessageAt: 100 }, 100 + 72 * 3600), true, 'the window is 72 hours');
  assert.equal(inRecents({ lastMessageAt: 100 }, 100 + 72 * 3600 + 1), false);
  assert.equal(inRecents({ running: true }, 0), true);
});

test('Automation editing: capabilities, paging, controls and settings Threads', async () => {
  const caps = { protocol: 1, automations: true, thread_origin: true, automations_paged: true, automation_controls: true, automation_editors: true };
  const editable = job({ editable: true, controls: ['pause', 'run', 'schedule', 'future'], editor_channel_id: 'p_a', editor_thread_id: 'th_edit' });
  const thread = { id: 'th_edit', project_id: 'p_a', title: 'Daily article · 设置', archived: false, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', session_id: 's' };
  const { sdk, calls } = client((method, path, _token, body) => {
    if (path === '/v1/capabilities') return { status: 200, body: caps };
    if (path.startsWith('/v1/automations?')) return { status: 200, body: { automations: [editable], next_after: 'abc' } };
    if (path.endsWith('/editor')) return { status: 201, body: { thread, created: true } };
    // The server creates the Thread with the requested client_thread_id.
    if (path.startsWith('/v1/channels/')) return { status: 201, body: { thread: { ...thread, id: body.client_thread_id, title: body.title } } };
    return { status: 200, body: { automation: job({ editable: true, state: 'paused', enabled: false, controls: ['resume', 'schedule'] }) } };
  });
  await sdk.capabilities();
  assert.deepEqual([sdk.supportsAutomationsPaged, sdk.supportsAutomationControls, sdk.supportsAutomationEditors], [true, true, true]);
  const page = await sdk.automationsPage({ after: 'x y', channel: 'p_a' });
  assert.equal(page.nextAfter, 'abc');
  assert.deepEqual(page.automations[0].controls, ['pause', 'run', 'schedule']);
  assert.equal(page.automations[0].editorThreadId, 'th_edit');
  const paused = await sdk.automationControl('j1', 'pause');
  assert.deepEqual(paused.controls, ['resume', 'schedule']);
  await sdk.setAutomationSchedule('j1', 'every day at 9am');
  assert.equal((await sdk.automationEditor('j1')).id, 'th_edit');
  await sdk.createThread('p_a', 'New automation', 'th_client123', undefined, false, { automationEditor: true });
  const sent = calls.slice(1).map(([method, path, , body]) => [method, path, body]);
  assert.deepEqual(sent.map(([m, p]) => [m, p]), [
    ['GET', '/v1/automations?limit=30&after=x%20y&channel=p_a'], ['POST', '/v1/automations/j1/pause'],
    ['PATCH', '/v1/automations/j1'], ['POST', '/v1/automations/j1/editor'], ['POST', '/v1/channels/p_a/threads']]);
  assert.deepEqual(sent[2][2], { schedule: 'every day at 9am' });
  assert.equal(sent[4][2].automation_editor, true);
});

test('Older servers: no editing fields means read-only', async () => {
  const { sdk } = client(() => ({ status: 200, body: { protocol: 1, automations: true, thread_origin: true } }));
  await sdk.capabilities();
  assert.deepEqual([sdk.supportsAutomationsPaged, sdk.supportsAutomationControls, sdk.supportsAutomationEditors], [false, false, false]);
  const { sdk: other } = client(() => ({ status: 200, body: { automations: [job({ controls: ['pause'] })] } }));
  assert.deepEqual((await other.automations())[0].controls, []);  // not editable without editable: true
});

test('Automation delete: parses the control, sends DELETE, treats 404 as already deleted', async () => {
  const parsed = (await client(() => ({ status: 200, body: { automations: [job({ editable: true, state: 'completed', controls: ['delete'] })] } })).sdk.automations())[0];
  assert.deepEqual(parsed.controls, ['delete']);
  const built = await build({ stdin: { contents: "export { automationChangeable } from './automations';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false });
  const loaded = { exports: {} }; new Function('module', 'exports', built.outputFiles[0].text)(loaded, loaded.exports);
  const { automationChangeable } = loaded.exports;
  assert.equal(automationChangeable(parsed), false);
  assert.equal(automationChangeable({ ...parsed, controls: ['pause', 'delete'] }), true);

  const { sdk, calls } = client(() => ({ status: 200, body: { id: 'a/b', deleted: true } }));
  await sdk.deleteAutomation('a/b');
  assert.deepEqual(calls.at(-1).slice(0, 2), ['DELETE', '/v1/automations/a%2Fb']);
  await client(() => ({ status: 404, body: {} })).sdk.deleteAutomation('gone');
  await assert.rejects(client(() => ({ status: 403, body: {} })).sdk.deleteAutomation('j1'), error => error.status === 403);
  await assert.rejects(client(() => ({ status: 200, body: {} })).sdk.deleteAutomation('j1'));
});
