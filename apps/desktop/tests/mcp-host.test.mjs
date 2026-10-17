import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
async function load(path) {
  const compiled = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports;
}
const { McpHost, argumentSummary, mcpResultText, loginShellPath } = await load('../src/main/mcp-host.ts');
const { HttpSession } = await load('../src/main/mcp-session.ts');
const { parseMcpConfig, withApproval, importServers, McpConfigError } = await load('../src/shared/mcp-config.ts');

// A stand-in stdio MCP server: newline JSON-RPC, paginated tools/list, a ping request to the
// client before one answer, images, errors and a call that never answers.
const FAKE = `#!${process.execPath}
const fs = require('node:fs');
const log = m => fs.appendFileSync(process.env.FAKE_LOG, m + '\\n');
log('start ' + process.argv.slice(2).join(' ') + ' port=' + (process.env.PORT || ''));
let buf = '', pending = null;
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
process.stderr.write('fake server stderr line\\n');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const m = JSON.parse(line);
    log((m.method || ('answer ' + m.id)) + (m.params && m.params.name ? ' ' + m.params.name : '') + (m.params && m.params.requestId ? ' ' + m.params.requestId : ''));
    if (m.method === undefined) { if (m.id === 'srv-ping' && pending) { send({ id: pending, result: { content: [{ type: 'text', text: 'pong seen' }] } }); pending = null; } continue; }
    if (m.id === undefined) continue;
    if (m.method === 'initialize') { if (process.env.FAKE_BROKEN) { process.stderr.write('missing API key\\n'); process.exit(3); } send({ id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' }, capabilities: {} } }); continue; }
    if (m.method === 'tools/list') {
      if (!m.params.cursor) send({ id: m.id, result: { tools: [{ name: 'open_browser', description: 'Open a browser.\\nMore.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: false } }], nextCursor: 'p2' } });
      else send({ id: m.id, result: { tools: [{ name: 'status', description: 'Status.' }] } });
      continue;
    }
    const { name, arguments: a } = m.params;
    if (name === 'ping_first') { pending = m.id; send({ id: 'srv-ping', method: 'ping' }); }
    else if (name === 'structured') send({ id: m.id, result: { content: [], structuredContent: { ok: 1 } } });
    else if (name === 'shot') send({ id: m.id, result: { content: [{ type: 'text', text: 'two shots' }, { type: 'image', mimeType: 'image/png', data: Buffer.from('PNG').toString('base64') }, { type: 'image', mimeType: 'image/png', data: Buffer.from('PNG').toString('base64') }] } });
    else if (name === 'fail') send({ id: m.id, result: { content: [{ type: 'text', text: 'profile not found' }], isError: true } });
    else if (name === 'slow') { /* never answers */ }
    else send({ id: m.id, result: { content: [{ type: 'text', text: 'ok ' + name + ' ' + JSON.stringify(a) }] } });
  }
});
`;

function setup(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-host-'));
  const bin = join(dir, 'bin');
  require('node:fs').mkdirSync(bin);
  writeFileSync(join(bin, 'fake-mcp'), FAKE); chmodSync(join(bin, 'fake-mcp'), 0o755);
  process.env.FAKE_LOG = join(dir, 'log');
  delete process.env.FAKE_BROKEN;
  const file = join(dir, 'config', 'mcp.json');
  const asked = [];
  let answer = 'allow';
  let changes = 0;
  const host = new McpHost({
    file, claudeFile: join(dir, 'claude.json'), watchFile: false, platform: 'darwin',
    searchPath: async () => `${bin}:/usr/bin:/bin`,
    confirm: async request => { asked.push(request); return typeof answer === 'function' ? answer(request) : answer; },
    encodeImage: bytes => bytes.toString() === 'PNG' ? { jpegBase64: 'SlBFRw==', width: 4, height: 3 } : undefined,
    onServersChanged: () => { changes++; },
    ...options,
  });
  const log = () => existsSync(process.env.FAKE_LOG) ? readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n') : [];
  return { dir, bin, file, host, asked, log, setAnswer: value => { answer = value; }, changes: () => changes };
}
const signal = () => new AbortController().signal;
const config = servers => JSON.stringify({ mcpServers: servers }, null, 2);

test('config: Claude Desktop format plus approval and disabled; clear errors', () => {
  const { servers } = parseMcpConfig(config({
    ads: { command: 'npx', args: ['-y', 'local-api-mcp-typescript'], env: { PORT: '50325' } },
    web: { type: 'http', url: 'http://127.0.0.1:8931/mcp', headers: { A: 'b' }, approval: 'auto', disabled: true },
  }));
  assert.deepEqual(servers.map(s => [s.name, s.kind, s.approval, s.disabled]), [['ads', 'stdio', 'ask', false], ['web', 'http', 'auto', true]]);
  assert.deepEqual(parseMcpConfig('').servers, []);
  for (const [text, phrase] of [
    ['{', 'not valid JSON'], ['[]', 'JSON object'],
    [config({ 'bad name': { command: 'x' } }), 'letters, digits'],
    [config({ a: { command: 'x', url: 'http://x' } }), 'either command or url'],
    [config({ a: { url: 'ftp://x' } }), 'http://'],
    [config({ a: { type: 'sse', url: 'http://x' } }), 'older SSE'],
    [config({ a: { command: 'x', approval: 'never' } }), 'approval'],
    [config({ a: { command: 'x', env: { A: 1 } } }), 'env.A'],
    [config({ a: {} }), 'needs a command'],
  ]) assert.throws(() => parseMcpConfig(text), error => error instanceof McpConfigError && error.message.includes(phrase), phrase);
});

test('config: approval changes keep other fields; import adds only new, valid servers', () => {
  const text = config({ ads: { command: 'npx', comment: 'mine', env: { K: 'v' } } });
  const changed = JSON.parse(withApproval(text, 'ads', 'auto'));
  assert.deepEqual(changed.mcpServers.ads, { command: 'npx', comment: 'mine', env: { K: 'v' }, approval: 'auto' });
  assert.throws(() => withApproval(text, 'other', 'auto'), McpConfigError);
  const claude = config({ ads: { command: 'other' }, notes: { command: 'uvx', args: ['notes'], approval: 'auto' }, broken: { url: 'nope' } });
  const merged = importServers(text, claude);
  assert.deepEqual(merged.added, ['notes']); assert.deepEqual(merged.skipped.sort(), ['ads', 'broken']);
  const result = JSON.parse(merged.text).mcpServers;
  assert.equal(result.ads.command, 'npx');
  assert.equal(result.notes.approval, 'ask', 'imported servers ask before each use');
});

test('stdio: starts with the login PATH and env, lists all pages, describes, calls; answers server ping', async () => {
  const { file, host, log, asked } = setup();
  host.save(config({ ads: { command: 'fake-mcp', args: ['--x'], env: { PORT: '50325' }, approval: 'auto' } }));
  assert.equal(statSync(file).mode & 0o777, 0o600, 'keys in the file are private to the user');
  assert.deepEqual(host.servers(), ['ads']);
  const listed = await host.run({ server: 'ads', tool: 'list', arguments: {} }, signal(), 5000);
  assert.equal(listed.output, 'open_browser: Open a browser.\nstatus: Status.');
  const described = await host.run({ server: 'ads', tool: 'describe', arguments: { tool: 'open_browser' } }, signal(), 5000);
  assert.match(described.output, /input schema:[\s\S]*"id"/); assert.match(described.output, /readOnlyHint/);
  await assert.rejects(host.run({ server: 'ads', tool: 'describe', arguments: { tool: 'nope' } }, signal(), 5000), { code: 'invalid' });
  const called = await host.run({ server: 'ads', tool: 'open_browser', arguments: { id: 'k1' } }, signal(), 5000);
  assert.deepEqual(called, { output: 'ok open_browser {"id":"k1"}' });
  assert.deepEqual(await host.run({ server: 'ads', tool: 'ping_first' }, signal(), 5000), { output: 'pong seen' });
  assert.deepEqual(await host.run({ server: 'ads', tool: 'structured' }, signal(), 5000), { output: '{\n "ok": 1\n}' });
  const shot = await host.run({ server: 'ads', tool: 'shot' }, signal(), 5000);
  assert.deepEqual(shot, { output: 'two shots', images: [{ jpeg_base64: 'SlBFRw==', width: 4, height: 3 }, { jpeg_base64: 'SlBFRw==', width: 4, height: 3 }] });
  await assert.rejects(host.run({ server: 'ads', tool: 'fail' }, signal(), 5000), { code: 'server_error', message: 'profile not found' });
  assert.equal(asked.length, 0, 'auto servers never ask');
  assert.equal(log().filter(l => l.startsWith('start')).length, 1, 'one process for all calls');
  assert.equal(log()[0], 'start --x port=50325');
  assert.ok(log().includes('answer srv-ping'));
  assert.equal(host.state().servers[0].status, 'running');
  await assert.rejects(host.run({ server: 'nope', tool: 'list' }, signal(), 5000), { code: 'no_server' });
  host.close();
});

test('approval: ask, deny, timeout and allow-all; list and describe never ask', async () => {
  const { host, asked, setAnswer } = setup();
  host.save(config({ ads: { command: 'fake-mcp' } }));
  await host.run({ server: 'ads', tool: 'list' }, signal(), 5000);
  await host.run({ server: 'ads', tool: 'describe', arguments: { tool: 'status' } }, signal(), 5000);
  assert.equal(asked.length, 0);
  setAnswer('deny');
  await assert.rejects(host.run({ server: 'ads', tool: 'open_browser', arguments: { id: 'k1' } }, signal(), 5000), { code: 'denied' });
  assert.equal(asked[0].server, 'ads'); assert.equal(asked[0].tool, 'open_browser'); assert.match(asked[0].summary, /"id": "k1"/);
  setAnswer('timeout');
  await assert.rejects(host.run({ server: 'ads', tool: 'status' }, signal(), 5000), { code: 'not_confirmed' });
  setAnswer('allow');
  assert.match((await host.run({ server: 'ads', tool: 'status' }, signal(), 5000)).output, /ok status/);
  setAnswer('allow-all');
  await host.run({ server: 'ads', tool: 'status' }, signal(), 5000);
  setAnswer('deny');
  await host.run({ server: 'ads', tool: 'status' }, signal(), 5000);
  assert.equal(asked.length, 4, 'after allow-all the server runs without asking');
  // Choosing "Ask me" again ends allow-all.
  host.setApproval('ads', 'ask');
  await assert.rejects(host.run({ server: 'ads', tool: 'status' }, signal(), 5000), { code: 'denied' });
  // Stopping the Agent while the user decides cancels the call.
  const abort = new AbortController();
  setAnswer(() => { abort.abort(); return 'allow'; });
  await assert.rejects(host.run({ server: 'ads', tool: 'status' }, abort.signal, 5000), { code: 'cancelled' });
  host.close();
});

test('lifecycle: config changes restart only changed servers; invalid files keep the last valid config', async () => {
  const { file, host, log, changes } = setup();
  host.save(config({ a: { command: 'fake-mcp', approval: 'auto' }, b: { command: 'fake-mcp', args: ['b'], approval: 'auto' } }));
  assert.equal(changes(), 1);
  await host.run({ server: 'a', tool: 'status' }, signal(), 5000);
  await host.run({ server: 'b', tool: 'status' }, signal(), 5000);
  // Approval-only changes keep the process; a new argument restarts it; disabled hides it.
  host.save(config({ a: { command: 'fake-mcp', approval: 'ask', comment: 'x' }, b: { command: 'fake-mcp', args: ['b2'], approval: 'auto' }, c: { command: 'fake-mcp', disabled: true } }));
  assert.deepEqual(host.servers(), ['a', 'b']);
  assert.equal(changes(), 1, 'same enabled names: no new report');
  assert.equal(host.state().servers.find(s => s.name === 'a').status, 'running');
  assert.equal(host.state().servers.find(s => s.name === 'b').status, 'stopped');
  await host.run({ server: 'b', tool: 'status' }, signal(), 5000);
  assert.deepEqual(log().filter(l => l.startsWith('start')), ['start  port=', 'start b port=', 'start b2 port=']);
  await assert.rejects(host.run({ server: 'c', tool: 'status' }, signal(), 5000), { code: 'no_server' });
  writeFileSync(file, '{ broken');
  host.reload();
  assert.match(host.state().error, /not valid JSON/);
  assert.deepEqual(host.servers(), ['a', 'b']);
  assert.throws(() => host.save('{ broken'), /not valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{ broken', 'an invalid save does not write');
  host.save(config({}));
  assert.deepEqual(host.servers(), []); assert.equal(changes(), 2);
  host.close();
});

test('failures: missing command, startup error with stderr, timeout and cancel', async () => {
  const { host, log } = setup({ initTimeoutMs: 3000 });
  host.save(config({ missing: { command: 'no-such-mcp', approval: 'auto' }, broken: { command: 'fake-mcp', approval: 'auto' }, ok: { command: 'fake-mcp', approval: 'auto' } }));
  await assert.rejects(host.run({ server: 'missing', tool: 'list' }, signal(), 5000), error => error.code === 'server_error' && /"no-such-mcp" was not found/.test(error.message));
  assert.equal(host.state().servers.find(s => s.name === 'missing').status, 'failed');
  process.env.FAKE_BROKEN = '1';
  await assert.rejects(host.run({ server: 'broken', tool: 'list' }, signal(), 5000), error => error.code === 'server_error' && /missing API key/.test(error.message));
  delete process.env.FAKE_BROKEN;
  await assert.rejects(host.run({ server: 'ok', tool: 'slow' }, signal(), 300), { code: 'unknown' });
  const abort = new AbortController();
  const slow = host.run({ server: 'ok', tool: 'slow' }, abort.signal, 5000);
  await new Promise(resolve => setTimeout(resolve, 200));
  abort.abort();
  await assert.rejects(slow, { code: 'cancelled' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(log().some(l => l.startsWith('notifications/cancelled')), 'the server is told about the cancel');
  host.close();
});

test('idle servers stop and start again on the next call', async () => {
  const { host, log } = setup({ idleMs: 150 });
  host.save(config({ a: { command: 'fake-mcp', approval: 'auto' } }));
  await host.run({ server: 'a', tool: 'status' }, signal(), 5000);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(host.state().servers[0].status, 'stopped');
  await host.run({ server: 'a', tool: 'status' }, signal(), 5000);
  assert.equal(log().filter(l => l.startsWith('start')).length, 2);
  host.close();
});

test('Claude Desktop import and empty file creation', () => {
  const { dir, file, host } = setup();
  assert.equal(host.state().claudeAvailable, false);
  writeFileSync(join(dir, 'claude.json'), config({ notes: { command: 'uvx', args: ['notes'] } }));
  assert.equal(host.state().claudeAvailable, true);
  const result = host.importClaude();
  assert.deepEqual(result.added, ['notes']);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).mcpServers.notes, { command: 'uvx', args: ['notes'], approval: 'ask' });
  assert.deepEqual(host.importClaude().added, []);
  const other = setup();
  assert.equal(existsSync(other.file), false);
  other.host.ensureFile();
  assert.deepEqual(JSON.parse(readFileSync(other.file, 'utf8')), { mcpServers: {} });
});

test('result text and argument summary helpers', () => {
  assert.equal(mcpResultText({ content: [{ type: 'text', text: 'a' }, { type: 'resource', resource: { uri: 'file:///x', text: 'body' } }, { type: 'resource_link', name: 'doc', uri: 'file:///y' }, { type: 'audio', data: 'AAA' }], structuredContent: { x: 1 } }), 'a\nbody\n[resource doc file:///y]\n[audio omitted]');
  assert.equal(mcpResultText({ content: [{ type: 'text', text: 'B'.repeat(3000) }] }), '[binary data omitted]');
  assert.equal(argumentSummary({ text: 'x'.repeat(2000) }).length, 601);
});

test('login shell PATH is read with a marker and falls back on failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-shell-'));
  const shell = join(dir, 'shell');
  writeFileSync(shell, '#!/bin/sh\necho "motd noise"\nPATH=/custom/bin:/usr/bin\nprintf "__HERMES_PATH__%s__HERMES_END__" "$PATH"\n'); chmodSync(shell, 0o755);
  const path = await loginShellPath(undefined, shell);
  assert.ok(path.startsWith('/custom/bin:/usr/bin:'), path);
  assert.ok(path.includes('/opt/homebrew/bin'));
  const fallback = await loginShellPath(undefined, join(dir, 'missing-shell'));
  assert.ok(fallback.includes('/opt/homebrew/bin'));
});

// A Streamable HTTP server: JSON answers, an SSE answer with a server ping first, a session ID and DELETE.
function httpServer() {
  const seen = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      seen.push({ method: request.method, session: request.headers['mcp-session-id'], version: request.headers['mcp-protocol-version'], auth: request.headers.authorization, body: body ? JSON.parse(body) : undefined });
      if (request.method === 'DELETE') { response.writeHead(204).end(); return; }
      const message = JSON.parse(body);
      if (message.id === undefined || message.method === undefined) { response.writeHead(202).end(); return; }
      if (message.method === 'initialize') { response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })); return; }
      if (message.method === 'tools/list') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', description: 'Echo.' }] } })); return; }
      if (message.params.name === 'gone') { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'p1', method: 'ping' })}\n\n`);
      response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
      setTimeout(() => response.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echo ' + JSON.stringify(message.params.arguments) }] } })}\n\n`), 20);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

test('HTTP: Streamable HTTP with JSON and SSE answers, session ID, headers and DELETE on close', async () => {
  const { server, seen, url } = await httpServer();
  try {
    const { host } = setup();
    host.save(config({ web: { url, headers: { Authorization: 'Bearer local' }, approval: 'auto' } }));
    assert.deepEqual(await host.run({ server: 'web', tool: 'list' }, signal(), 5000), { output: 'echo: Echo.' });
    assert.deepEqual(await host.run({ server: 'web', tool: 'echo', arguments: { a: 1 } }, signal(), 5000), { output: 'echo {"a":1}' });
    await new Promise(resolve => setTimeout(resolve, 50));
    const init = seen.find(s => s.body?.method === 'initialize');
    assert.equal(init.session, undefined); assert.equal(init.auth, 'Bearer local');
    const call = seen.find(s => s.body?.method === 'tools/call');
    assert.equal(call.session, 'sess-1'); assert.equal(call.version, '2025-06-18');
    assert.ok(seen.some(s => s.body?.method === 'notifications/initialized'));
    assert.ok(seen.some(s => s.body?.id === 'p1' && s.body.result), 'the server ping is answered');
    await assert.rejects(host.run({ server: 'web', tool: 'gone' }, signal(), 5000), { code: 'unknown' });
    host.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(seen.some(s => s.method === 'DELETE' && s.session === 'sess-1'));
    const closed = new HttpSession('http://127.0.0.1:9/mcp', {}, 'MCP server "down"', fetch, 2000);
    await assert.rejects(closed.ready, error => error.code === 'driver_error' && /could not be reached/.test(error.message));
    closed.close();
  } finally { server.close(); }
});
