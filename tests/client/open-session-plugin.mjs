// Existing P1 interoperability gate, synthetic fixture data only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const bundle = await build({ stdin: { resolveDir: new URL('../..', import.meta.url).pathname, contents: `export {LiveSessionClient} from './packages/client/src/liveClient'; export {mainTransport} from './apps/desktop/src/main/transport';` }, bundle: true, format: 'cjs', platform: 'node', external: ['ws'], write: false });
const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const [base, threadId] = process.argv.slice(2), transport = mod.exports.mainTransport(base, true);
const client = new mod.exports.LiveSessionClient({ ...transport, token: () => 'synthetic-live-test-token-at-least-32-characters' });
try {
  await client.openConversation(threadId); console.log('READY');
  const end = Date.now() + 5000;
  while (!client.messages.get(threadId)?.some(row => row.text === 'Synthetic integration final')) { assert.ok(Date.now() < end, 'Synthetic update timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
  client.closeConversation(); assert.equal(client.messages.size, 0);
  console.log(JSON.stringify({ result: 'passed', real_http_ws: true, released_content: true }));
} finally { client.close(); }
