import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
// The saved create request of a new session: it survives a restart and a damaged one is rejected.
// Electron is replaced with a reversible fake cipher in a temporary folder. Synthetic data only.
const dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'outbox-store-'));
const electron = `module.exports={app:{getPath:()=>${JSON.stringify(dir)}},safeStorage:{isEncryptionAvailable:()=>true,
  encryptString:s=>Buffer.from(s,'utf8'),decryptString:b=>b.toString('utf8')}};`;
const bundle = await build({ entryPoints: [new URL('../src/main/outbox-store.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'electron', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fake' })); b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: electron, loader: 'js' })); } }] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { OutboxStore } = module.exports;
const conn = 'a'.repeat(24), file = join(dir, 'outbox.secure.json');
const base = { version: 1, id: 'desktop:00000000-0000-4000-8000-000000000001', threadId: 'th_0123456789abcdef', text: 'hello', attachmentIds: [], createdAt: 1, state: 'pending' };
test.after(() => rm(dir, { recursive: true, force: true }));

test('a rejected member send keeps its reason, exact original and attachment IDs across cold reads', async () => {
  const store = new OutboxStore();
  const original = { ...base, text: '  keep\n中文  ', attachmentIds: ['att_member'], state: 'blocked', blockedReason: 'device_not_bound' };
  await store.put(conn, original);
  assert.deepEqual(await new OutboxStore().list(conn), [original]);
  await store.clear(conn);
});

test('a create request is saved and read back exactly', async () => {
  const store = new OutboxStore();
  await store.put(conn, { ...base, create: { channelId: 'p', title: 'New automation', automationEditor: true } });
  const [saved] = await new OutboxStore().list(conn);
  assert.deepEqual(saved.create, { channelId: 'p', title: 'New automation', automationEditor: true });
  await store.clear(conn);
});

test('an invalid create request is refused before it is saved', async () => {
  const store = new OutboxStore();
  for (const create of [{ channelId: '', title: 'New topic' }, { channelId: 'p', title: '  ' }, { channelId: 'p', title: 'New topic', automationEditor: false }, 'p'])
    await assert.rejects(store.put(conn, { ...base, create }), /invalid outbox record/);
  await assert.rejects(store.put(conn, { ...base, threadId: 'thread-1', create: { channelId: 'p', title: 'New topic' } }), /invalid outbox record/);
  assert.deepEqual(await store.list(conn), []);
});

test('a damaged saved create request makes the outbox unreadable, not silently different', async () => {
  const store = new OutboxStore();
  await store.put(conn, { ...base, create: { channelId: 'p', title: 'New topic' } });
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  const inner = JSON.parse(Buffer.from(envelope.encrypted, 'base64').toString('utf8'));
  inner.identities[conn][0].create.title = '';
  await writeFile(file, JSON.stringify({ version: 1, encrypted: Buffer.from(JSON.stringify(inner)).toString('base64') }));
  await assert.rejects(new OutboxStore().list(conn), /outbox unavailable/);
  await rm(file, { force: true });
});
