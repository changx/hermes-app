import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

// Real desktop transport + shared HermesClient workspace API against a local
// HTTP fixture with the plugin's conditional file semantics.
const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts', contents: `
  export { mainTransport } from './src/main/transport';
  export { HermesClient, HttpError } from '../../packages/client/src/index';
` }, bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { mainTransport, HermesClient, HttpError } = mod.exports;

const tag = bytes => '"' + createHash('sha256').update(bytes).digest('hex') + '"';
async function server(t) {
  const files = new Map(), requests = [];
  const http = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks), url = new URL(request.url, 'http://x');
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams.get('path'), headers: request.headers, body });
    const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== 'Bearer test-token') return json(401, {});
    if (request.method === 'GET' && url.pathname === '/v1/channels/p1/agents') {
      const content = files.get('AGENTS.md'); if (!content) return json(404, {});
      return json(200, { channel_id: 'p1', path: 'AGENTS.md', content: content.toString(), etag: tag(content), rules_effect: 'new_sessions' });
    }
    if (request.method === 'PUT' && url.pathname === '/v1/channels/p1/agents') {
      const old = files.get('AGENTS.md'), match = request.headers['if-match'], create = request.headers['if-none-match'];
      if (create === '*' ? !!old : !old || tag(old) !== match) return json(412, {});
      const content = Buffer.from(JSON.parse(body.toString()).content); files.set('AGENTS.md', content);
      return json(200, { channel_id: 'p1', path: 'AGENTS.md', etag: tag(content) });
    }
    if (request.method === 'PUT' && url.pathname === '/v1/channels/p1/file') {
      const name = url.searchParams.get('path'), old = files.get(name), match = request.headers['if-match'], create = request.headers['if-none-match'];
      if (request.headers['content-type'] !== 'application/octet-stream') return json(415, {});
      if (create === '*' ? !!old : !old || tag(old) !== match) return json(412, {});
      files.set(name, body); return json(200, { channel_id: 'p1', path: name, etag: tag(body) });
    }
    json(404, {});
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); http.close(); });
  const transport = mainTransport(`http://127.0.0.1:${http.address().port}`, true);
  const client = new HermesClient({ ...transport, token: () => 'test-token' });
  return { files, requests, client };
}

test('workspace writeFile sends raw bytes create-only and never replaces an existing file', async t => {
  const { files, requests, client } = await server(t);
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const etag = await client.workspace.writeFile('p1', 'data.bin', bytes, null);
  assert.equal(etag, tag(Buffer.from(bytes)));
  assert.deepEqual([...files.get('data.bin')], [0, 1, 2, 255]);
  const sent = requests.at(-1);
  assert.equal(sent.headers['if-none-match'], '*'); assert.equal(sent.headers['if-match'], undefined);
  await assert.rejects(client.workspace.writeFile('p1', 'data.bin', new Uint8Array([9]), null), error => error instanceof HttpError && error.status === 412);
  assert.deepEqual([...files.get('data.bin')], [0, 1, 2, 255], 'existing file unchanged');
});

test('workspace writeFile refuses AGENTS.md, dot names and empty files before any request', async t => {
  const { requests, client } = await server(t);
  await assert.rejects(client.workspace.writeFile('p1', 'AGENTS.md', new Uint8Array([1]), null));
  await assert.rejects(client.workspace.writeFile('p1', '.env', new Uint8Array([1]), null));
  await assert.rejects(client.workspace.writeFile('p1', 'empty.txt', new Uint8Array(), null));
  assert.equal(requests.length, 0);
});

test('AGENTS.md uses conditional JSON writes and reads larger than the ordinary reply limit', async t => {
  const { requests, client } = await server(t);
  assert.equal(client.supportsChannelWorkspace, false, 'capabilities not read in this fixture');
  const content = '规则\n'.repeat(40_000); // > 64 KiB UTF-8
  const saved = await client.workspace.saveAgents('p1', content, null);
  assert.equal(saved.content, content);
  assert.equal(requests.find(r => r.method === 'PUT').headers['if-none-match'], '*');
  const updated = await client.workspace.saveAgents('p1', 'short', saved.etag);
  assert.equal(updated.content, 'short');
  assert.equal(requests.filter(r => r.method === 'PUT').at(-1).headers['if-match'], saved.etag);
  await assert.rejects(client.workspace.saveAgents('p1', 'stale', saved.etag), error => error instanceof HttpError && error.status === 412);
});
