import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export * from './src/main/env-keys-ipc.ts'; export { DesktopConnectionService } from './src/main/connection-service.ts'; export { HttpError } from '@hermes-app/client';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { envKeyName, envKeyValue, DesktopConnectionService, HttpError } = module.exports;

test('API key IPC: only checked names and one-line values pass', () => {
  assert.equal(envKeyName('MY_SERVICE_KEY'), 'MY_SERVICE_KEY');
  for (const bad of ['lower', '1KEY', 'A-B', '', 'A'.repeat(129), 7, null]) assert.throws(() => envKeyName(bad), /Invalid desktop request/);
  assert.equal(envKeyValue('svc-value'), 'svc-value');
  for (const bad of ['', '  ', 'a\nB=c', 'a\rb', 'x'.repeat(8193), 3]) assert.throws(() => envKeyValue(bad), /Invalid desktop request/);
});

function service(client) {
  const target = new DesktopConnectionService(() => {});
  target.connection = { id: 'conn-key' };
  target.client = client;
  return target;
}

test('API key service: capability gate and user-facing errors', async () => {
  await assert.rejects(service({ supportsEnvKeys: false }).getEnvKeys('conn-key'), /not available on this Hermes yet/);
  await assert.rejects(service({ supportsEnvKeys: true }).getEnvKeys('other'), /Connection changed/);
  const rows = { keys: [], suggestions: [] };
  assert.deepEqual(await service({ supportsEnvKeys: true, envKeys: async () => rows }).getEnvKeys('conn-key'), rows);
  const locked = service({ setEnvKey: async () => { throw new HttpError(403, 'managed'); } });
  await assert.rejects(locked.setEnvKey('conn-key', 'TERMINAL_ENV', 'x'), /administrator manages this key/);
  const gone = service({ removeEnvKey: async () => { throw new HttpError(404, 'not set'); } });
  await assert.rejects(gone.removeEnvKey('conn-key', 'A_KEY'), /already removed/);
  const sent = [];
  const ok = service({ setEnvKey: async (...args) => { sent.push(args); return { name: 'A_KEY', set: true, preview: '', sandbox: true }; } });
  assert.equal((await ok.setEnvKey('conn-key', 'A_KEY', 'v')).name, 'A_KEY');
  assert.deepEqual(sent, [['A_KEY', 'v']]);
});
