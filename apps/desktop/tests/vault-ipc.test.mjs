import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

// One bundle, so the service and the test share the SDK's HttpError class.
const bundle = await build({ stdin: { contents: "export * from './src/main/vault-ipc.ts'; export { DesktopConnectionService } from './src/main/connection-service.ts'; export { HttpError } from '@hermes-app/client';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { vaultAnswer, vaultItemChange, newVaultItem, DesktopConnectionService, HttpError } = module.exports;

test('vault IPC: answers, changes and new items keep only checked fields', () => {
  assert.deepEqual(vaultAnswer({ decision: 'use', item_id: 'vault_a', password: 'x' }), { decision: 'use', item_id: 'vault_a' });
  assert.deepEqual(vaultAnswer({ decision: 'submit', identifier: 'me', password: 'pw', otp_secret: 'KEY', extra: 1 }), { decision: 'submit', identifier: 'me', password: 'pw', otp_secret: 'KEY' });
  assert.deepEqual(vaultAnswer({ decision: 'submit', identifier: 'me', password: 'pw', otp_secret: '' }), { decision: 'submit', identifier: 'me', password: 'pw' });
  assert.deepEqual(vaultAnswer({ decision: 'submit', code: '123456' }), { decision: 'submit', code: '123456' });
  assert.throws(() => vaultAnswer({ decision: 'use' }), /Invalid desktop request/);
  assert.throws(() => vaultAnswer({ decision: 'unlock' }), /Invalid desktop request/);
  assert.deepEqual(vaultItemChange({ label: 'GH', password: '', otp_secret: 'K', clear_otp: true, profile: 'x' }), { label: 'GH', otp_secret: 'K', clear_otp: true });
  assert.deepEqual(vaultItemChange({ identifier: 'octo', clear_otp: 'yes' }), { identifier: 'octo' });
  assert.throws(() => vaultItemChange({ password: 'p'.repeat(1025) }), /Invalid desktop request/);
  assert.deepEqual(newVaultItem({ kind: 'login', label: 'GH', origin: 'github.com', secret: { identifier: 'me', password: 'pw' } }),
    { kind: 'login', label: 'GH', origin: 'github.com', secret: { identifier: 'me', password: 'pw' } });
});

function service(client) {
  const s = new DesktopConnectionService(() => {});
  s.connection = { id: 'device-a' };
  s.client = client;
  return s;
}

test('import reads the picked file in the main process and refuses large files', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'vault-import-'));
  const small = join(folder, 'Passwords.csv'), big = join(folder, 'big.csv');
  writeFileSync(small, 'url,username,password\nhttps://a.com,me,pw\n');
  writeFileSync(big, 'x'.repeat(4 * 1024 * 1024 + 1));
  const sent = [];
  const result = { added: 1, updated: 0, unchanged: 0, otp_skipped: 0, skipped: { not_login: 0, no_website: 0, no_username: 0, no_password: 0 } };
  const s = service({ supportsVaultManage: true, importVaultCsv: async text => { sent.push(text); return result; }, vaultItems: async () => [] });
  assert.deepEqual(await s.importVaultCsv('device-a', small), result);
  assert.deepEqual(sent, ['url,username,password\nhttps://a.com,me,pw\n']);
  await assert.rejects(s.importVaultCsv('device-a', big), /larger than 4 MB/);
  assert.equal(sent.length, 1);
  assert.deepEqual(await s.getVaultItems('device-a').catch(() => null), null, 'getVaultItems needs supportsVault');
  const old = service({ supportsVault: true, supportsVaultManage: false, vaultItems: async () => [] });
  assert.deepEqual(await old.getVaultItems('device-a'), { items: [], manage: false });
  await assert.rejects(old.importVaultCsv('device-a', small), /newer Hermes App plugin/);
});

test('a rejected prompt value is "invalid" and keeps the card; other failures are "failed"', async () => {
  const prompt = { id: 'vp_1', thread_id: 'th_1' };
  let failure = new HttpError(400);
  const s = service({ vaultPrompts: new Map([['vp_1', prompt]]), answerVaultPrompt: async () => { if (failure) throw failure; } });
  s.selectedThreadId = 'th_1';
  const notices = [];
  s.actionError = message => notices.push(message);
  assert.equal(await s.answerVaultPrompt('vp_1', { decision: 'decline' }, 'th_1'), 'invalid');
  failure = new HttpError(409);
  assert.equal(await s.answerVaultPrompt('vp_1', { decision: 'decline' }, 'th_1'), 'failed');
  failure = null;
  assert.equal(await s.answerVaultPrompt('vp_1', { decision: 'decline' }, 'th_1'), 'ok');
  assert.equal(await s.answerVaultPrompt('vp_other', { decision: 'decline' }, 'th_1'), 'failed');
  assert.equal(notices.length, 1, 'only the gone prompt shows the notice');
});
