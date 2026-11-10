import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};

const prompt = { id: 'vp_1', kind: 'save_login', thread_id: 'th_one', receipt_id: 'rc_1', generation: 'g1',
  site: 'github.com', origin: 'https://github.com', hint: '', expires_at: 1900000000 };

test('vault is enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, vault: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsVault, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.equal(old.supportsVault, false);
});

test('vault items: metadata in, secrets out once, unknown kinds rejected', async () => {
  const items = [
    { id: 'vault_a', kind: 'login', label: 'GitHub', origin: 'https://github.com', created_at: 't', identifier: 'me@example.com', identifier_type: 'email', has_otp: true },
    { id: 'vault_b', kind: 'address', label: 'Home', origin: null, created_at: 't' },
  ];
  const { sdk, calls } = client((method, path) => method === 'GET' ? { status: 200, body: { items } }
    : method === 'POST' ? { status: 200, body: { item: items[0] } } : { status: 200, body: { removed: true } });
  assert.deepEqual(await sdk.vaultItems(), items);
  const added = await sdk.addVaultItem({ kind: 'login', label: 'GitHub', origin: 'github.com', secret: { identifier: 'me@example.com', password: 'pw' } });
  assert.equal(added.id, 'vault_a');
  assert.deepEqual([calls[1][0], calls[1][1], calls[1][3]], ['POST', '/v1/vault/items', { kind: 'login', label: 'GitHub', origin: 'github.com', secret: { identifier: 'me@example.com', password: 'pw' } }]);
  assert.equal(await sdk.removeVaultItem('vault_a'), true);
  assert.deepEqual(calls[2].slice(0, 2), ['DELETE', '/v1/vault/items/vault_a']);
  const card = client(() => ({ status: 200, body: { items: [{ id: 'v', kind: 'payment', label: 'Visa', origin: null, created_at: 't' }] } })).sdk;
  await assert.rejects(card.vaultItems(), /invalid vault item/);
});

test('live state: vault prompts are a separate optional field', () => {
  const { sdk } = client(() => ({ status: 200, body: {} }));
  const base = { thread_id: 'th_one', active_receipts: [], pending_interactions: [] };
  assert.deepEqual(sdk.decodeScopedState(base, 'th_one').vaultPrompts, [], 'an older plugin sends no field');
  assert.deepEqual(sdk.decodeScopedState({ ...base, vault_prompts: [prompt] }, 'th_one').vaultPrompts, [prompt]);
  assert.throws(() => sdk.decodeScopedState({ ...base, vault_prompts: [{ ...prompt, thread_id: 'th_two' }] }, 'th_one'), /scope mismatch/);
  assert.throws(() => sdk.decodeScopedState({ ...base, vault_prompts: [{ ...prompt, kind: 'unlock' }] }, 'th_one'), /invalid vault prompt/);
});

test('answerVaultPrompt posts the generation and drops the prompt, also when the answer fails', async () => {
  const ok = client(() => ({ status: 200, body: { id: 'vp_1', state: 'settled' } }));
  ok.sdk.vaultPrompts.set(prompt.id, prompt);
  await ok.sdk.answerVaultPrompt(prompt, { decision: 'submit', identifier: 'me', password: 'pw' });
  assert.deepEqual([ok.calls[0][0], ok.calls[0][1], ok.calls[0][3]], ['POST', '/v1/threads/th_one/vault-prompts/vp_1/answer',
    { generation: 'g1', decision: 'submit', identifier: 'me', password: 'pw' }]);
  assert.equal(ok.sdk.vaultPrompts.size, 0);
  const gone = client(() => ({ status: 409, body: 'request expired or settled' }));
  gone.sdk.vaultPrompts.set(prompt.id, prompt);
  await assert.rejects(gone.sdk.answerVaultPrompt(prompt, { decision: 'decline' }));
  assert.equal(gone.sdk.vaultPrompts.size, 0);
});

test('vault_manage needs the vault capability too', async () => {
  for (const [body, want] of [[{ protocol: 1, vault: true, vault_manage: true }, true], [{ protocol: 1, vault: true }, false], [{ protocol: 1, vault_manage: true }, false]]) {
    const sdk = client(() => ({ status: 200, body })).sdk;
    await sdk.capabilities();
    assert.equal(sdk.supportsVaultManage, want, JSON.stringify(body));
  }
});

test('save prompts carry the update flag, the prefill and reuse matches', () => {
  const { sdk } = client(() => ({ status: 200, body: {} }));
  const base = { thread_id: 'th_one', active_receipts: [], pending_interactions: [] };
  const rich = { ...prompt, update: true, identifier: 'octo', matches: [{ id: 'vault_x', label: 'Amazon', identifier: 'me@example.com', origin: 'https://www.amazon.com', password: 'never' }] };
  const [decoded] = sdk.decodeScopedState({ ...base, vault_prompts: [rich] }, 'th_one').vaultPrompts;
  assert.deepEqual(decoded, { ...prompt, update: true, identifier: 'octo', matches: [{ id: 'vault_x', label: 'Amazon', identifier: 'me@example.com', origin: 'https://www.amazon.com' }] });
  const [code] = sdk.decodeScopedState({ ...base, vault_prompts: [{ ...rich, kind: 'code' }] }, 'th_one').vaultPrompts;
  assert.equal(code.matches, undefined);
  assert.equal(code.update, undefined);
});

test('a rejected value keeps the prompt open; reuse and key answers are posted as given', async () => {
  const bad = client(() => ({ status: 400, body: 'invalid authenticator key' }));
  bad.sdk.vaultPrompts.set(prompt.id, prompt);
  await assert.rejects(bad.sdk.answerVaultPrompt(prompt, { decision: 'submit', identifier: 'me', password: 'pw', otp_secret: 'x' }));
  assert.equal(bad.sdk.vaultPrompts.size, 1);
  const ok = client(() => ({ status: 200, body: { id: 'vp_1', state: 'settled' } }));
  ok.sdk.vaultPrompts.set(prompt.id, prompt);
  await ok.sdk.answerVaultPrompt(prompt, { decision: 'use', item_id: 'vault_x' });
  assert.deepEqual(ok.calls[0][3], { generation: 'g1', decision: 'use', item_id: 'vault_x' });
  assert.equal(ok.sdk.vaultPrompts.size, 0);
});

test('edit and CSV import', async () => {
  const item = { id: 'vault_new', kind: 'login', label: 'GitHub', origin: 'https://github.com', created_at: 't', identifier: 'octo', identifier_type: 'username', has_otp: false };
  const { sdk, calls } = client((method, path) => path === '/v1/vault/import'
    ? { status: 200, body: { added: 2, updated: 1, unchanged: 0, otp_skipped: 0, skipped: { not_login: 1, no_website: 0, no_username: 2, no_password: 0 }, extra: 'x' } }
    : { status: 200, body: { item } });
  assert.deepEqual(await sdk.updateVaultItem('vault_old', { password: 'pw', clear_otp: true }), item);
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][3]], ['PUT', '/v1/vault/items/vault_old', { password: 'pw', clear_otp: true }]);
  assert.deepEqual(await sdk.importVaultCsv('url,username,password\n'), { added: 2, updated: 1, unchanged: 0, otp_skipped: 0, skipped: { not_login: 1, no_website: 0, no_username: 2, no_password: 0 } });
  assert.deepEqual([calls[1][0], calls[1][1], calls[1][3]], ['POST', '/v1/vault/import', { csv: 'url,username,password\n' }]);
  await assert.rejects(sdk.importVaultCsv('x'.repeat(4 * 1024 * 1024 + 1)), /too large/);
  assert.equal(calls.length, 2);
});
