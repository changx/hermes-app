import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let opener;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'openThread') opener = node.initializer.getText(app); ts.forEachChild(node, visit); }
visit(app); assert.ok(opener);
const bundle = await build({ entryPoints: [new URL('../../../packages/client/src/liveClient.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
for (const target of [undefined, 101]) test(`production mobile opening publishes all 250 records once (${target ?? 'latest'})`, async () => {
  const paths = [], rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i), ref_seq: i * 2 + 1, role: 'assistant', text: 'Synthetic ' + i }));
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const client = new mod.exports.LiveSessionClient({ token: () => 'synthetic-only', livenessMs: 1000,
    http: { async request(_method, path) {
      paths.push(path);
      if (path === '/v1/capabilities') return { status: 200, body: { protocol: 1, history_full: true, open_session_live: true } };
      if (path.startsWith('/v1/catalogue')) return { status: 200, body: { items: [{ kind: 'channel', value: { id: 'p', name: 'P' } }, { kind: 'session', value: { id: 't', project_id: 'p', title: 'T', archived: false, running: false } }], next_after: null } };
      if (path === '/v1/threads/t/messages?full=true') { await gate; return { status: 200, body: { messages: rows, receipts: [], complete: true, older_cursor: null, next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; }
      if (path.endsWith('/live-state')) return { status: 200, body: { thread_id: 't', active_receipts: [], pending_interactions: [] } };
      throw Error('Unexpected path: ' + path);
    } }, socket: { async connect() { let listener; return {
      onMessage(fn) { listener = fn; queueMicrotask(() => listener(JSON.stringify({ type: 'hello', protocol: 1, open_session_live: true }))); }, onClose() {}, close() {},
      send(value) { queueMicrotask(() => listener(value === 'ping' ? 'pong' : JSON.stringify({ ...JSON.parse(value), type: 'watching' }))); }
    }; } }
  });
  const located = [], context = { client, focusedRef: { current: true }, appActive: { current: true }, openingRef: { current: 0 }, ownedWatch: { current: null },
    setHistoryBusy(value) { context.historyBusy = value; }, setLocated(value) { context.located = value; if (value) located.push(client.messages.get('t')?.length ?? 0); },
    setError(value) { assert.fail(value); }
  };
  runInNewContext(ts.transpileModule(`globalThis.openThread = ${opener};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  try {
    const pending = context.openThread('t', target);
    const end = Date.now() + 3000;
    while (!paths.some(path => path.includes('/messages'))) { assert.ok(Date.now() < end); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(context.historyBusy, true); assert.equal(context.located, false); assert.deepEqual(located, []);
    finish(); await pending;
    assert.equal(context.located, true); assert.equal(context.historyBusy, false);
    assert.deepEqual(located, [250]); assert.equal(client.messages.get('t').length, 250);
    assert.deepEqual(paths.filter(path => path.includes('/messages')), ['/v1/threads/t/messages?full=true']);
  } finally { finish(); client.close(); }
});
