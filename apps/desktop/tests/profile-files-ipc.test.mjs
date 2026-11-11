import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export * from './src/main/profile-files-ipc.ts'; export { DesktopConnectionService } from './src/main/connection-service.ts'; export { HttpError } from '@hermes-app/client'; export { profileFileStatus } from './src/renderer/profile-files-settings.tsx';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'react', 'react/jsx-runtime'], jsx: 'automatic', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { profileFileKind, profileFileContent, profileFileVersion, DesktopConnectionService, HttpError, profileFileStatus } = module.exports;
const V = 'b'.repeat(64);

test('profile file IPC: only known files, bounded text and real versions pass', () => {
  for (const kind of ['soul', 'user', 'memory']) assert.equal(profileFileKind(kind), kind);
  for (const bad of ['agents', '../SOUL.md', '', 1, null]) assert.throws(() => profileFileKind(bad), /Invalid desktop request/);
  assert.equal(profileFileContent(''), '');
  assert.equal(profileFileContent('中文\n§\nx'), '中文\n§\nx');
  for (const bad of ['x'.repeat(100_001), 'a\0b', 3]) assert.throws(() => profileFileContent(bad), /Invalid desktop request/);
  assert.equal(profileFileVersion(''), '');
  assert.equal(profileFileVersion(V), V);
  for (const bad of ['abc', V.toUpperCase(), null]) assert.throws(() => profileFileVersion(bad), /Invalid desktop request/);
});

function service(client) {
  const target = new DesktopConnectionService(() => {});
  target.connection = { id: 'conn-key' };
  target.client = client;
  return target;
}

test('profile file service: capability gate and plain save errors', async () => {
  await assert.rejects(service({ supportsProfileFiles: false }).getProfileFiles('conn-key'), /not available on this Hermes yet/);
  const files = [{ kind: 'soul', name: 'SOUL.md', content: 'x', version: V, exists: true }];
  assert.deepEqual(await service({ supportsProfileFiles: true, profileFiles: async () => files }).getProfileFiles('conn-key'), files);
  const stale = service({ saveProfileFile: async () => { throw new HttpError(409, undefined, '/v1/profile-files/memory', 'version_conflict'); } });
  await assert.rejects(stale.saveProfileFile('conn-key', 'memory', 'x', V), /MEMORY.md changed on Hermes after you opened it/);
  const long = service({ saveProfileFile: async () => { throw new HttpError(400, undefined, '', 'over_limit'); } });
  await assert.rejects(long.saveProfileFile('conn-key', 'user', 'x', V, 1375), /USER.md can hold 1,375 characters/);
  const sent = [];
  const ok = service({ saveProfileFile: async (...args) => { sent.push(args); return files[0]; } });
  assert.equal((await ok.saveProfileFile('conn-key', 'soul', 'Be kind.', V)).name, 'SOUL.md');
  assert.deepEqual(sent, [['soul', 'Be kind.', V]]);
});

test('status line: memory size against the limit, off state, new SOUL.md', () => {
  const memory = { kind: 'memory', name: 'MEMORY.md', content: '', version: '', exists: true, limit: 2200, used: 0, enabled: false };
  assert.equal(profileFileStatus(memory, 'a\n§\nb'), '5 of 2,200 characters · Turned off on this Hermes');
  assert.equal(profileFileStatus({ kind: 'soul', name: 'SOUL.md', content: '', version: '', exists: false }, ''), 'Not created yet');
  assert.equal(profileFileStatus({ kind: 'soul', name: 'SOUL.md', content: 'x', version: V, exists: true }, 'Hello'), '5 characters');
});
