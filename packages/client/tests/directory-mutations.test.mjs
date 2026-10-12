import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Synthetic fixture only: Channel/Thread mutations confirm on their own reply and never
// await a catalogue walk; an older walk cannot undo a newer confirmed row.
const bundle = await build({ entryPoints: [new URL('../src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LiveSessionClient } = module.exports;

const row = (id, extra = {}) => ({ id, project_id: 'p_one', title: 'Title ' + id, archived: false, ...extra });
const session = (id, extra = {}) => ({ kind: 'session', value: { ...row(id), running: false, ...extra } });
const channel = { kind: 'channel', value: { id: 'p_one', name: 'One' } };
function fixture(route) {
  const calls = []; let changes = 0;
  const sdk = new LiveSessionClient({
    token: () => 'synthetic-device', onChange: () => { changes++; },
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (method, path, _token, body) => { calls.push(method + ' ' + path.replace(/\?.*/, '')); return { status: 200, body: await route(method, path, body) }; } },
  });
  sdk.channels.set('p_one', { id: 'p_one', name: 'One' });
  sdk.threads.set('th_old00000', row('th_old00000'));
  return { sdk, calls, changes: () => changes };
}
const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };

test('createThread sends one POST and adds the confirmed row without a catalogue walk', async () => {
  const { sdk, calls, changes } = fixture((method, path, body) => ({ thread: row(body.client_thread_id) }));
  const made = await sdk.createThread('p_one', 'New topic', 'th_new00000');
  assert.equal(made.id, 'th_new00000');
  assert.deepEqual(calls, ['POST /v1/channels/p_one/threads']);
  assert.equal(sdk.isThreadAvailable('th_new00000'), true);
  assert.ok(changes() > 0);
});

test('createThread rejects a reply for another Channel or Thread and adds nothing', async () => {
  for (const reply of [row('th_new00000', { project_id: 'p_two' }), row('th_other000')]) {
    const { sdk } = fixture(() => ({ thread: reply }));
    await assert.rejects(sdk.createThread('p_one', 'New topic', 'th_new00000'), /identity mismatch/);
    assert.equal(sdk.threads.has('th_new00000'), false);
  }
});

test('rename and archive use the PATCH/DELETE reply with no readback', async () => {
  const { sdk, calls } = fixture((method, path, body) => method === 'PATCH'
    ? { thread: row('th_old00000', { title: body.title }) } : { thread: row('th_old00000', { archived: true }) });
  await sdk.updateThread('th_old00000', { title: 'Renamed' });
  assert.equal(sdk.threads.get('th_old00000').title, 'Renamed');
  await sdk.archiveThread('th_old00000');
  assert.equal(sdk.threads.has('th_old00000'), false);
  assert.deepEqual(calls, ['PATCH /v1/threads/th_old00000', 'DELETE /v1/threads/th_old00000']);
});

test('channel mutations update the directory from the reply only', async () => {
  const { sdk, calls } = fixture((method, path, body) => method === 'POST' ? { channel: { id: 'p_two', name: body.name } }
    : body?.archived ? { channel: { id: 'p_one', name: 'One', archived: true } } : { channel: { id: 'p_one', name: body.name } });
  await sdk.createChannel('Two'); await sdk.updateChannel('p_one', { name: 'Uno' });
  assert.equal(sdk.channels.get('p_two').name, 'Two'); assert.equal(sdk.channels.get('p_one').name, 'Uno');
  await sdk.archiveChannel('p_one'); assert.equal(sdk.channels.has('p_one'), false);
  assert.ok(calls.every(call => !call.includes('/v1/catalogue')));
});

test('a catalogue walk that began before a create keeps the new row; the next walk is authoritative', async () => {
  let pages = [];
  const { sdk } = fixture(async (method, path, body) => {
    if (method === 'POST') return { thread: row(body.client_thread_id) };
    const next = pages.shift(); await next.wait; return next.body;
  });
  const stale = gate();
  pages = [{ wait: stale.promise, body: { items: [channel, session('th_old00000')], next_after: null } }];
  const walk = sdk.snapshot();
  await sdk.createThread('p_one', 'New topic', 'th_new00000');
  stale.open(); await walk;
  assert.equal(sdk.isThreadAvailable('th_new00000'), true, 'older walk must not drop the confirmed row');
  pages = [{ body: { items: [channel, session('th_old00000')], next_after: null } }];
  await sdk.snapshot();
  assert.equal(sdk.threads.has('th_new00000'), false, 'a walk that began later is server truth');
});

test('a catalogue walk that began before an archive does not bring the session back', async () => {
  let pages = [];
  const { sdk } = fixture(async (method) => {
    if (method === 'DELETE') return { thread: row('th_old00000', { archived: true }) };
    const next = pages.shift(); await next.wait; return next.body;
  });
  const stale = gate();
  pages = [{ wait: stale.promise, body: { items: [channel, session('th_old00000')], next_after: null } }];
  const walk = sdk.snapshot();
  await sdk.archiveThread('th_old00000');
  stale.open(); await walk;
  assert.equal(sdk.threads.has('th_old00000'), false);
});
