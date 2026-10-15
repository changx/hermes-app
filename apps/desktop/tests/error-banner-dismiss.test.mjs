import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
// Synthetic fixtures only. An action error must not stay on the session page
// forever: the user can close it, and a stale-request notice clears itself
// after Hermes refreshes the request status.
const bundle = await build({ entryPoints: [new URL('../src/main/connection-service.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopConnectionService } = module.exports;
const STALE = /no longer pending/;

function fixture({ refresh = async () => {} } = {}) {
  const outbox = { async list() { return []; }, async put() {}, async remove() {}, async clear() {} };
  const drafts = { async list() { return {}; }, async put() {}, async clear() {}, async flush() {} };
  const service = new DesktopConnectionService(() => {}, { credentials: {}, outbox, drafts });
  service.connection = { id: 'a'.repeat(24), baseUrl: 'https://example.test' };
  service.phase = 'connected'; service.connectionState = 'online';
  const item = { id: 'ix_1', thread_id: 'th_1', state: 'pending', choices: ['Approve', 'Deny'] };
  const client = {
    channels: new Map(), threads: new Map(), messages: new Map(), receipts: new Map(), attachments: new Map(),
    interactions: new Map([['ix_1', item]]), isCatalogueReady: true, isThreadAvailable: () => true,
    page: () => undefined,
    async answerInteraction() { throw new Error('409'); },
    getInteraction: refresh,
  };
  service.client = client;
  return { service };
}

test('the user can close an action error', async () => {
  const { service } = fixture({ refresh: async () => { throw new Error('offline'); } });
  await service.answerInteraction('ix_1', 'Approve', 'th_1');
  const shown = service.snapshot('th_1');
  assert.match(shown.errorMessage, STALE);
  assert.equal(shown.errorDismissible, true);
  service.dismissError();
  assert.equal(service.snapshot('th_1').errorMessage, undefined);
});

test('a stale-request notice clears itself after the status refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service } = fixture();
  await service.answerInteraction('ix_1', 'Approve', 'th_1');
  assert.match(service.snapshot('th_1').errorMessage, STALE);
  t.mock.timers.tick(6_000);
  assert.equal(service.snapshot('th_1').errorMessage, undefined);
});

test('a newer error is not cleared by the stale-request timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service } = fixture();
  await service.answerInteraction('ix_1', 'Approve', 'th_1');
  service.errorMessage = 'The topic could not be renamed. It may have changed on another device.'; // a later action error
  t.mock.timers.tick(6_000);
  assert.match(service.snapshot('th_1').errorMessage, /could not be renamed/);
});

test('a live connection problem has no close button and survives dismiss', () => {
  const { service } = fixture();
  service.connectionIssue = 'Hermes is reconnecting.';
  const shown = service.snapshot('th_1');
  assert.equal(shown.errorMessage, 'Hermes is reconnecting.');
  assert.equal(shown.errorDismissible, undefined);
  service.dismissError();
  assert.equal(service.snapshot('th_1').errorMessage, 'Hermes is reconnecting.');
});

test('session page and workspace render the shared closable banner', async () => {
  const read = name => readFile(new URL('../src/renderer/' + name, import.meta.url), 'utf8');
  const [banner, shell, workspace] = await Promise.all([read('error-banner.tsx'), read('shell.tsx'), read('native-workspace.tsx')]);
  assert.match(banner, /errorDismissible \?/);
  assert.match(banner, /dismissError\(snapshot\.selectedThreadId\)/);
  for (const source of [shell, workspace]) {
    assert.match(source, /<ErrorBanner snapshot=\{snapshot\} \/>/);
    assert.doesNotMatch(source, /snapshot\.errorMessage && <div className="error-banner"/);
  }
});
