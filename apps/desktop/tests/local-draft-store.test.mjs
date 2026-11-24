import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/main/local-draft-store.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });

async function store(delayMs = 30) {
  const folder = await mkdtemp(join(tmpdir(), 'draft-store-'));
  const calls = { encrypt: 0, decrypt: 0 };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: text => { calls.encrypt++; return Buffer.from('x' + text); },
    decryptString: buffer => { calls.decrypt++; return buffer.toString().slice(1); },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'electron' ? { app: { getPath: () => folder }, safeStorage } : require(name), mod, mod.exports);
  const file = join(folder, 'drafts.secure.json');
  const saved = async () => JSON.parse(safeStorage.decryptString(Buffer.from(JSON.parse(await readFile(file, 'utf8')).encrypted, 'base64')));
  return { Store: mod.exports.LocalDraftStore, make: () => new mod.exports.LocalDraftStore(delayMs), calls, file, saved, cleanup: () => rm(folder, { recursive: true, force: true }) };
}
const id = 'a'.repeat(24);
const draft = text => ({ text, attachments: [] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('typing: keystrokes change memory; one encrypted write follows the pause', async () => {
  const s = await store();
  try {
    const drafts = s.make();
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) await drafts.put(id, 'th_1', draft(text));
    assert.equal(s.calls.encrypt, 0, 'no write while typing');
    await assert.rejects(stat(s.file));
    await wait(80);
    assert.equal(s.calls.encrypt, 1, 'one write after the pause');
    assert.equal(s.calls.decrypt, 0, 'the file is not read again for each change');
    assert.deepEqual((await s.saved()).identities[id].th_1, draft('hello'));
  } finally { await s.cleanup(); }
});

test('typing: flush writes a pending draft at once (quit path)', async () => {
  const s = await store(60_000);
  try {
    const drafts = s.make();
    await drafts.put(id, 'th_1', draft('before quit'));
    await drafts.flush();
    assert.deepEqual((await s.saved()).identities[id].th_1, draft('before quit'));
    const reopened = s.make();
    assert.deepEqual(await reopened.list(id), { th_1: draft('before quit') });
  } finally { await s.cleanup(); }
});

test('typing: immediate puts and clear write before they resolve', async () => {
  const s = await store(60_000);
  try {
    const drafts = s.make();
    await drafts.put(id, 'th_1', draft('sent text'));
    await drafts.put(id, 'th_1', draft(''), { immediate: true });
    await assert.rejects(stat(s.file), 'the last draft removed deletes the file');
    await drafts.put(id, 'th_2', draft('keep'), { immediate: true });
    assert.deepEqual((await s.saved()).identities[id], { th_2: draft('keep') });
    await drafts.clear(id);
    await assert.rejects(stat(s.file));
  } finally { await s.cleanup(); }
});

test('typing: list returns a copy, not the store memory', async () => {
  const s = await store();
  try {
    const drafts = s.make();
    await drafts.put(id, 'th_1', draft('one'));
    const listed = await drafts.list(id);
    listed.th_1.text = 'changed by a caller';
    assert.deepEqual(await drafts.list(id), { th_1: draft('one') });
    await drafts.flush();
  } finally { await s.cleanup(); }
});
