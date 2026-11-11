import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, memoryEntries, memoryUsed, profileFileSaveError } from '../dist/index.js';

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};
const V = 'a'.repeat(64);

test('profile files are enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, profile_files: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsProfileFiles, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.equal(old.supportsProfileFiles, false);
});

test('profileFiles reads three files; save sends the text with the version it edited', async () => {
  const files = [
    { kind: 'soul', name: 'SOUL.md', content: '# Soul', version: V, exists: true },
    { kind: 'user', name: 'USER.md', content: 'Likes tea.', version: V, exists: true, limit: 1375, used: 10, enabled: true },
    { kind: 'memory', name: 'MEMORY.md', content: '', version: '', exists: false, limit: 2200, used: 0, enabled: false },
  ];
  const { sdk, calls } = client(method => method === 'GET' ? { status: 200, body: { files } }
    : { status: 200, body: { file: { ...files[1], content: 'Likes coffee.', used: 13 } } });
  assert.deepEqual(await sdk.profileFiles(), files);
  const saved = await sdk.saveProfileFile('user', 'Likes coffee.', V);
  assert.equal(saved.content, 'Likes coffee.');
  assert.deepEqual([calls[1][0], calls[1][1], calls[1][3]], ['PUT', '/v1/profile-files/user', { content: 'Likes coffee.', version: V }]);
  await assert.rejects(sdk.saveProfileFile('agents', '', ''), /invalid profile file/);
  assert.equal(calls.length, 2);
});

test('a refused save keeps the server code; unknown kinds and bad versions are rejected', async () => {
  const { sdk } = client(() => ({ status: 409, body: { error: 'version_conflict', message: 'changed' } }));
  await assert.rejects(sdk.saveProfileFile('memory', 'x', V), error => error.status === 409 && error.code === 'version_conflict');
  const bad = client(() => ({ status: 200, body: { files: [{ kind: 'other', content: '' }] } })).sdk;
  await assert.rejects(bad.profileFiles(), /invalid profile file/);
  const odd = client(() => ({ status: 200, body: { files: [{ kind: 'soul', content: 'x', version: '../etc', exists: true }] } })).sdk;
  assert.equal((await odd.profileFiles())[0].version, '');
});

test('memory counter matches the server rules', () => {
  const text = '  Prefers tea.  \r\n §\n\n§\nLikes maps.\n§\nLikes maps.\n§ \nUses a 中文 keyboard.\n';
  assert.deepEqual(memoryEntries(text), ['Prefers tea.', 'Likes maps.', 'Uses a 中文 keyboard.']);
  assert.equal(memoryUsed(text), ['Prefers tea.', 'Likes maps.', 'Uses a 中文 keyboard.'].join('\n§\n').length);
  assert.equal(memoryUsed(''), 0);
  assert.match(profileFileSaveError('over_limit', 400, 'MEMORY.md', 2200), /can hold 2,200 characters/);
  assert.match(profileFileSaveError(undefined, 409, 'USER.md'), /changed on Hermes/);
  assert.match(profileFileSaveError('blocked_text', 400, 'USER.md'), /does not save it/);
  assert.match(profileFileSaveError(undefined, 503, 'SOUL.md'), /Could not save SOUL.md/);
});
