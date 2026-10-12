// Private stdin configuration; all data in the paired server fixture is synthetic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const { base, threadId, credentials } = JSON.parse(Buffer.concat(chunks).toString());
const bundle = await build({ stdin: { resolveDir: new URL('../..', import.meta.url).pathname, contents: `export {LivePageClient} from './packages/client/src/livePages'; export {mainTransport} from './apps/desktop/src/main/transport';` }, bundle: true, format: 'cjs', platform: 'node', external: ['ws'], write: false });
const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { LivePageClient, mainTransport } = mod.exports, requests = [];
const clients = credentials.map(token => {
  const transport = mainTransport(base, true), request = transport.http.request;
  transport.http.request = (...args) => { requests.push({ method: args[0], path: args[1] }); return request(...args); };
  return new LivePageClient({ ...transport, token: () => token });
});
const until = async fn => { const end = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < end, 'Synthetic labels update timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } };
try {
  await Promise.all(clients.map(client => client.connect())); await until(() => clients.every(client => client.connectionState === 'online'));
  assert.ok(clients.every(client => client.supportsSessionLabels));
  for (const [values, time] of [[['Synthetic SDK 👩🏽‍💻', 'Exact'], 1000], [['Replacement'], 1001], [[], 1002]]) {
    const before = requests.length;
    const result = await clients[0].saveThreadLabels(threadId, values, time); assert.deepEqual(result.markers, values);
    // One PUT confirms the save (no detail readback); the catalogue refresh runs in the background.
    assert.deepEqual(requests.slice(before).filter(r => r.path.endsWith('/labels')).map(r => r.method), ['PUT']);
    assert.deepEqual(clients[0].threads.get(threadId).markers, values);
    await until(() => clients[1].threads.get(threadId)?.markers_updated_at === time);
    assert.deepEqual(clients[1].threads.get(threadId).markers, values);
  }
  assert.deepEqual((await clients[1].saveThreadLabels(threadId, ['Stale'], 1001)).markers, []);
  assert.deepEqual((await clients[1].saveThreadLabels(threadId, ['Equal'], 1002)).markers, []);
  assert.ok(clients.every(client => client.messages.size === 0 && client.receipts.size === 0 && client.openedPageIds.length === 0));
  assert.ok(requests.every(r => !r.path.includes('/messages') && !r.path.endsWith('/live-state') && !r.path.startsWith('/v1/sync')));
  console.log(JSON.stringify({ result: 'passed', fixture: 'synthetic', real_plugin_http_ws: true, two_directory_clients: true, single_put_confirm: true, no_body_reads: true, requests: requests.length }));
} finally { clients.forEach(client => client.close()); }
