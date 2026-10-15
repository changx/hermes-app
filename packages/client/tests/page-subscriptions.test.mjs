import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/livePages.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { LivePageClient } = module.exports;

// No network: only change notification is under test.
const offline = { token: () => 'synthetic', http: { async request() { throw new Error('offline'); } }, socket: { async connect() { throw new Error('offline'); } } };
// resumeTail calls the client's own change path when the tail flag was set.
const change = (client, id) => { client.tailIncomplete.add(id); client.resumeTail(id); };

test('battery: a page change notifies only that page; the app callback still runs', () => {
  let appChanges = 0;
  const account = new LivePageClient({ ...offline, onChange: () => { appChanges++; } });
  const a = account.acquirePage('A'), b = account.acquirePage('B');
  const seen = { account: 0, a: 0, b: 0 };
  account.subscribe(() => seen.account++); a.subscribe(() => seen.a++); const stopB = b.subscribe(() => seen.b++);
  const before = { a: a.changeVersion, b: b.changeVersion };
  change(a, 'A');
  assert.deepEqual(seen, { account: 0, a: 1, b: 0 });
  assert.equal(a.changeVersion, before.a + 1); assert.equal(b.changeVersion, before.b);
  assert.equal(appChanges, 1, 'outbox reconcile and lists still hear every change');
  change(account, 'X');
  assert.deepEqual(seen, { account: 1, a: 1, b: 0 }, 'directory changes reach account subscribers');
  stopB(); change(b, 'B');
  assert.deepEqual(seen, { account: 1, a: 1, b: 0 }, 'an unsubscribed listener is not called');
  account.close();
});

test('battery: a failing subscriber does not stop other subscribers or the app callback', () => {
  let appChanges = 0, other = 0;
  const account = new LivePageClient({ ...offline, onChange: () => { appChanges++; } });
  const page = account.acquirePage('A');
  page.subscribe(() => { throw new Error('view failure'); }); page.subscribe(() => other++);
  change(page, 'A');
  assert.equal(other, 1); assert.equal(appChanges, 1);
  account.close();
});
