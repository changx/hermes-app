import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { LivePageClient } = mod.exports;

test('live client forwards the automation editor flag when it creates a Thread', async () => {
  const bodies = [];
  const sdk = new LivePageClient({ token: () => 'synthetic', onChange: () => {},
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { async request(method, path, _token, body) {
      if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, automation_editors: true } };
      if (method === 'POST' && path === '/v1/channels/p_a/threads') { bodies.push(body); return { status: 201, body: { thread: { id: body.client_thread_id, project_id: 'p_a', title: body.title, archived: false, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', session_id: 's' } } }; }
      if (path.startsWith('/v1/catalogue')) return { status: 200, body: { items: [], next_after: null } };
      throw new Error('unexpected ' + method + ' ' + path);
    } } });
  await sdk.createThread('p_a', 'New automation', 'th_client1', undefined, false, { automationEditor: true });
  await sdk.createThread('p_a', 'New topic', 'th_client2');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].automation_editor, true);
  assert.equal('automation_editor' in bodies[1], false);
});
