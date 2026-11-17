import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// A 403 on one Project resource (AGENTS.md in an unsafe folder) is not a revoked device.
const bundle = await build({ stdin: { contents: "export { DesktopConnectionService } from './src/main/connection-service.ts'; export { HttpError } from '@hermes-app/client';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopConnectionService, HttpError } = module.exports;

function service(fail) {
  let closed = 0;
  const target = new DesktopConnectionService(() => {});
  const state = { channelId: 'p1', initialized: false, agentsAvailable: true, agentsBytes: 1, fileBytes: 1 };
  target.connection = { id: 'conn-key' };
  target.connectionState = 'online';
  target.client = { channels: new Map([['p1', {}]]), supportsChannelWorkspace: true, close: () => { closed++; },
    workspace: { getState: async () => state, getAgents: async () => { throw fail; }, saveAgents: async () => { throw fail; }, initialize: async () => state } };
  return { target, closed: () => closed };
}

test('AGENTS.md 403 keeps the connection online and reports a refused file', async () => {
  const s = service(new HttpError(403, undefined, '/v1/channels/p1/agents'));
  assert.deepEqual(await s.target.getProjectWorkspace('p1'), { supported: true, agents: null, refused: true });
  assert.deepEqual(await s.target.saveProjectAgents('p1', 'x', null), { ok: false, reason: 'failed' });
  assert.equal(s.target.connectionState, 'online');
  assert.equal(s.closed(), 0);
});

test('AGENTS.md 404 is a missing file, not an error', async () => {
  const s = service(new HttpError(404, undefined, '/v1/channels/p1/agents'));
  assert.deepEqual(await s.target.getProjectWorkspace('p1'), { supported: true, agents: null });
  assert.equal(s.target.connectionState, 'online');
});

test('AGENTS.md 401 still stops the connection', async () => {
  const s = service(new HttpError(401, undefined, '/v1/channels/p1/agents'));
  await assert.rejects(s.target.getProjectWorkspace('p1'), /AGENTS.md could not be loaded/);
  assert.equal(s.target.connectionState, 'blocked');
  assert.equal(s.closed(), 1);
});
