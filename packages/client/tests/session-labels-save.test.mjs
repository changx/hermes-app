import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Synthetic fixture only: label saves confirm on the PUT response in one request.
const bundle = await build({ entryPoints: [new URL('../src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LiveSessionClient } = module.exports;

function fixture(reply) {
  const calls = []; let changes = 0;
  const sdk = new LiveSessionClient({
    token: () => 'synthetic-device', onChange: () => { changes++; },
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args.slice(0, 2)); return reply(...args); } },
  });
  sdk.supportsSessionLabels = true; sdk.state('online');
  sdk.channels.set('p_one', { id: 'p_one', name: 'One' });
  sdk.threads.set('th_one', { id: 'th_one', project_id: 'p_one', title: 'One', archived: false, markers: ['Old'], markers_updated_at: 10 });
  return { sdk, calls, changes: () => changes };
}
const detail = (markers, time, extra = {}) => ({ status: 200, body: { thread_id: 'th_one', project_id: 'p_one', markers, markers_updated_at: time, ...extra } });

test('a committed save sends one PUT and adopts the server response', async () => {
  const { sdk, calls, changes } = fixture((method, path, _token, body) => detail(body.markers, body.markers_updated_at));
  const saved = await sdk.saveThreadLabels('th_one', ['New', 'Todo'], 20);
  assert.deepEqual(calls, [['PUT', '/v1/threads/th_one/labels']]);
  assert.deepEqual(saved, { thread_id: 'th_one', project_id: 'p_one', markers: ['New', 'Todo'], markers_updated_at: 20 });
  assert.deepEqual(sdk.threads.get('th_one').markers, ['New', 'Todo']);
  assert.equal(sdk.threads.get('th_one').title, 'One');
  assert.ok(changes() > 0);
});

test('a stale save shows the newer server state, never the proposed array', async () => {
  const { sdk } = fixture(() => detail(['Other device'], 30));
  const saved = await sdk.saveThreadLabels('th_one', ['Mine'], 20);
  assert.deepEqual(saved.markers, ['Other device']);
  assert.deepEqual(sdk.threads.get('th_one').markers, ['Other device']);
});

test('newer directory labels are not replaced by an older response', async () => {
  const { sdk } = fixture(() => {
    // A directory refresh lands while the PUT is in flight.
    sdk.threads.set('th_one', { ...sdk.threads.get('th_one'), markers: ['Newest'], markers_updated_at: 40 });
    return detail(['Mine'], 20);
  });
  const saved = await sdk.saveThreadLabels('th_one', ['Mine'], 20);
  assert.deepEqual(saved.markers, ['Newest']);
  assert.deepEqual(sdk.threads.get('th_one').markers, ['Newest']);
});

test('a mismatched or malformed response is not a confirmed save', async () => {
  for (const reply of [detail(['X'], 20, { thread_id: 'th_two' }), detail(['X'], 20, { project_id: 'p_two' }), detail('X', 20)]) {
    const { sdk } = fixture(() => reply);
    await assert.rejects(sdk.saveThreadLabels('th_one', ['X'], 20));
    assert.deepEqual(sdk.threads.get('th_one').markers, ['Old']);
  }
});

test('a session that becomes unavailable during the save is not confirmed', async () => {
  const { sdk } = fixture(() => { sdk.channels.delete('p_one'); return detail(['X'], 20); });
  await assert.rejects(sdk.saveThreadLabels('th_one', ['X'], 20), /not confirmed/);
});
