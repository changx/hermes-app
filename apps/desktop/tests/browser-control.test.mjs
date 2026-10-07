import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
const require = createRequire(import.meta.url);
const load = async (file, external = []) => {
  const compiled = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron', ...external], write: false });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports;
};
const shared = await load('../src/shared/browser-control.ts');
const { DesktopBrowserControl } = await load('../src/main/browser-control.ts', ['ws']);

test('server frames are validated; unknown actions and bad IDs are rejected', () => {
  const frame = shared.parseServerFrame(JSON.stringify({ type: 'command', id: 'c1', thread_id: 'th_a', channel_id: 'p', action: 'click', args: { ref: 'e2' }, timeout_ms: 20000, open_tab: true }));
  assert.deepEqual(frame, { type: 'command', command: { id: 'c1', threadId: 'th_a', channelId: 'p', action: 'click', args: { ref: 'e2' }, openTab: true, timeoutMs: 20000 } });
  assert.throws(() => shared.parseServerFrame(JSON.stringify({ type: 'command', id: 'c1', thread_id: 'th_a', action: 'evaluate' })));
  assert.throws(() => shared.parseServerFrame(JSON.stringify({ type: 'command', id: '', thread_id: 'th_a', action: 'click' })));
  assert.equal(shared.parseServerFrame('not json'), undefined);
  assert.deepEqual(shared.parseServerFrame('{"type":"cancel","id":"c1"}'), { type: 'cancel', id: 'c1' });
  assert.equal(shared.parseServerFrame(JSON.stringify({ type: 'command', id: 'c', thread_id: 't', action: 'handoff', timeout_ms: 1e12 })).command.timeoutMs, 15 * 60_000);
});

test('keys map to native key codes; unknown keys are refused', () => {
  assert.deepEqual(shared.keyFor('Enter'), { code: 'Enter', char: '\r' });
  assert.deepEqual(shared.keyFor('ArrowDown'), { code: 'Down' });
  assert.deepEqual(shared.keyFor(' space '), { code: 'Space', char: ' ' });
  assert.equal(shared.keyFor('F12'), undefined);
});

test('input ledger tells injected input from the user: matching, expiry and one use each', () => {
  let now = 1000;
  const ledger = new shared.InputLedger(() => now, 2000);
  assert.equal(ledger.consume('mouse', 10, 10), false, 'no injection: the user pressed');
  ledger.note('mouse', 100, 50); ledger.note('key');
  assert.equal(ledger.consume('mouse', 300, 300), false, 'a press elsewhere is the user');
  assert.equal(ledger.consume('mouse', 102, 49), true);
  assert.equal(ledger.consume('mouse', 100, 50), false, 'each injection is consumed once');
  now += 2500;
  assert.equal(ledger.consume('key'), false, 'old injections expire');
});

test('client hints mirror navigator.userAgentData, only for HTTPS and never override page headers', () => {
  const data = shared.validUserAgentData({ brands: [{ brand: 'Not?A_Brand', version: '24' }, { brand: 'Chromium', version: '152' }], mobile: false, platform: 'macOS' });
  const hints = shared.clientHints(data);
  assert.deepEqual(hints, { 'sec-ch-ua': '"Not?A_Brand";v="24", "Chromium";v="152"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"' });
  assert.deepEqual(shared.withClientHints({ Accept: '*/*' }, hints, 'http://example.com/'), { Accept: '*/*' });
  const sent = shared.withClientHints({ 'Sec-CH-UA': 'kept' }, hints, 'https://example.com/');
  assert.equal(sent['Sec-CH-UA'], 'kept'); assert.equal(sent['sec-ch-ua'], undefined); assert.equal(sent['sec-ch-ua-platform'], '"macOS"');
  assert.equal(shared.validUserAgentData({ brands: [{ brand: 'x"\r\ninjected', version: '1' }], mobile: false, platform: 'macOS' }), undefined);
});

test('navigation accepts web pages like a normal browser and refuses local and internal schemes', () => {
  for (const url of ['https://example.com/a', 'http://localhost:3000/', 'about:blank']) assert.equal(shared.navigable(url), true, url);
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'https://user:pass@example.com/']) assert.equal(shared.navigable(url), false, url);
  assert.equal(shared.blockedSubresource('file:///etc/passwd'), true);
  assert.equal(shared.blockedSubresource('https://cdn.example.com/app.js'), false);
});

async function harness(options = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port, sockets = [], received = [];
  const connections = [];
  server.on('connection', (socket, request) => {
    connections.push(request.headers.authorization);
    sockets.push(socket);
    socket.on('message', data => received.push(JSON.parse(data.toString())));
    socket.send(JSON.stringify({ type: 'hello', protocol: 1 }));
  });
  const executed = [];
  const tabs = [{ id: 'tab-1', threadId: 'acct:th_a', connectionKey: 'key', kind: 'session' }];
  const control = new DesktopBrowserControl({
    accounts: () => [{ connectionKey: 'key', baseUrl: `http://127.0.0.1:${port}`, token: 'ha_dev_token', qualify: raw => `acct:${raw}`, unqualify: id => id.startsWith('acct:') ? id.slice(5) : undefined }],
    tabs: () => tabs, activeTabId: () => 'tab-1', windowFocused: () => true,
    channels: () => new Map([['acct:th_a', 'acct:p']]),
    ensureTab: async threadId => { const tab = tabs.find(t => t.threadId === threadId); if (tab) return tab; const created = { id: 'tab-2', threadId, connectionKey: 'key', kind: 'session' }; tabs.push(created); return created; },
    execute: options.execute ?? (async (tabId, command) => { executed.push([tabId, command.action, command.args]); return { url: 'https://example.com/' }; }),
    deviceName: 'Test Mac',
  });
  const until = async (check, label) => { const end = Date.now() + 3000; while (Date.now() < end) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out: ' + label); };
  return { server, sockets, received, connections, executed, tabs, control, until, close: () => { control.close(); server.close(); } };
}

test('control connection: hello, bindings, command execution, duplicate answered from cache', async () => {
  const h = await harness();
  try {
    h.control.sync();
    await h.until(() => h.received.some(f => f.type === 'bindings'), 'bindings');
    assert.equal(h.connections[0], 'Bearer ha_dev_token');
    assert.deepEqual(h.received[0], { type: 'hello', protocol: 1, device_name: 'Test Mac', actions: ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'back', 'screenshot', 'handoff'] });
    const bindings = h.received.find(f => f.type === 'bindings');
    assert.equal(bindings.threads.length, 1);
    assert.deepEqual({ ...bindings.threads[0], focused_at: 0 }, { thread_id: 'th_a', channel_id: 'p', active: true, focused_at: 0 });
    const command = { type: 'command', id: 'c1', thread_id: 'th_a', channel_id: 'p', action: 'navigate', args: { url: 'https://example.com' }, timeout_ms: 45000, open_tab: false };
    h.sockets[0].send(JSON.stringify(command));
    await h.until(() => h.received.some(f => f.type === 'result'), 'result');
    assert.deepEqual(h.executed, [['tab-1', 'navigate', { url: 'https://example.com' }]]);
    assert.deepEqual(h.received.find(f => f.type === 'result'), { type: 'result', id: 'c1', ok: true, result: { url: 'https://example.com/' } });
    h.sockets[0].send(JSON.stringify(command));
    await h.until(() => h.received.filter(f => f.type === 'result').length === 2, 'cached result');
    assert.equal(h.executed.length, 1, 'a repeated command ID never runs twice');
    // A conversation that is not open gets a background tab.
    h.sockets[0].send(JSON.stringify({ ...command, id: 'c2', thread_id: 'th_new', open_tab: true }));
    await h.until(() => h.executed.length === 2, 'background tab');
    assert.equal(h.executed[1][0], 'tab-2');
  } finally { h.close(); }
});

test('control connection: cancel aborts the running action; a dropped connection aborts locally and reconnects', async () => {
  const signals = [];
  const h = await harness({ execute: (_tab, _command, signal) => new Promise((resolve, reject) => { signals.push(signal); signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped.'), { code: 'cancelled' }))); }) });
  try {
    h.control.sync();
    await h.until(() => h.received.some(f => f.type === 'bindings'), 'bindings');
    h.sockets[0].send(JSON.stringify({ type: 'command', id: 'c1', thread_id: 'th_a', action: 'handoff', args: { message: 'Sign in' }, timeout_ms: 600000 }));
    await h.until(() => signals.length === 1, 'running');
    h.sockets[0].send(JSON.stringify({ type: 'cancel', id: 'c1' }));
    await h.until(() => signals[0].aborted, 'cancel aborts');
    await h.until(() => h.received.some(f => f.type === 'result'), 'cancel result');
    assert.equal(h.received.find(f => f.type === 'result').ok, false);
    h.sockets[0].send(JSON.stringify({ type: 'command', id: 'c2', thread_id: 'th_a', action: 'handoff', args: { message: 'Sign in' }, timeout_ms: 600000 }));
    await h.until(() => signals.length === 2, 'second running');
    h.sockets[0].terminate();
    await h.until(() => signals[1].aborted, 'disconnect aborts');
    await h.until(() => h.sockets.length === 2, 'reconnect');
  } finally { h.close(); }
});

test('control connection: an older server without the endpoint is not retried quickly', async () => {
  const http = await import('node:http');
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const control = new DesktopBrowserControl({ accounts: () => [{ connectionKey: 'k', baseUrl: `http://127.0.0.1:${server.address().port}`, token: 't', qualify: r => r, unqualify: r => r }], tabs: () => [], activeTabId: () => undefined, windowFocused: () => false, channels: () => new Map(), ensureTab: async () => { throw new Error('no'); }, execute: async () => ({}), deviceName: 'x' });
  try {
    control.sync();
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(hits, 1);
  } finally { control.close(); server.close(); }
});
