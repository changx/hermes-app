import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
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
const shared = await load('../src/shared/remote-screen.ts');
const keys = await load('../src/shared/remote-screen-keys.ts');
const { relayRemoteScreen } = await load('../src/main/remote-screen.ts', ['ws']);

/** The page end: a MessagePort-like object that records what it receives. */
class PagePort {
  sent = []; closed = false; onmessage = null; peer = null;
  postMessage(message) { this.sent.push(message); }
  close() { this.closed = true; }
  deliver(message) { this.onmessage?.({ data: message }); }
}
/** The main-process end: a MessagePortMain-like emitter. */
class MainPort extends EventEmitter {
  received = []; closed = false; started = false;
  postMessage(message) { this.received.push(message); this.emit('posted', message); }
  start() { this.started = true; }
  close() { this.closed = true; }
  fromPage(message) { this.emit('message', { data: message }); }
}
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};

test('refused upgrades become plain reasons', () => {
  assert.equal(shared.failureForStatus(404), 'unavailable');
  assert.equal(shared.failureForStatus(503), 'not_running');
  assert.equal(shared.failureForStatus(429), 'busy');
  assert.equal(shared.failureForStatus(401), 'unauthorized');
  assert.equal(shared.failureForStatus(500), 'failed');
  assert.match(shared.failureText('not_running', 'AdsPower'), /AdsPower is not running/);
  for (const failure of ['unavailable', 'not_running', 'busy', 'unauthorized', 'offline', 'failed', undefined])
    assert.doesNotMatch(shared.failureText(failure, 'X'), /WebSocket|RFB|token|socket|503|404/i);
});

test('port messages are validated in both directions', () => {
  assert.deepEqual(shared.parseToPage({ type: 'open' }), { type: 'open' });
  assert.equal(shared.parseToPage({ type: 'data', data: 'text' }), undefined);
  assert.deepEqual(shared.parseToPage({ type: 'close', failure: 'busy' }), { type: 'close', failure: 'busy' });
  assert.deepEqual(shared.parseToPage({ type: 'close', failure: 'other' }), { type: 'close' });
  assert.equal(shared.parseToScreen({ type: 'data', data: new Uint8Array(1024 * 1024 + 1) }), undefined);
  assert.equal(shared.parseToScreen({ type: 'eval' }), undefined);
  assert.equal(shared.parseToScreen(null), undefined);
});

test('PortChannel has the raw channel shape noVNC checks and relays bytes', () => {
  const port = new PagePort(), channel = new shared.PortChannel(port);
  const props = [...Object.keys(channel), ...Object.getOwnPropertyNames(Object.getPrototypeOf(channel))];
  for (const prop of ['send', 'close', 'binaryType', 'onerror', 'onmessage', 'onopen', 'protocol', 'readyState']) assert.ok(props.includes(prop), prop);
  const events = [];
  channel.onopen = () => events.push('open');
  channel.onmessage = event => events.push(new Uint8Array(event.data));
  channel.onclose = event => events.push(['close', event.code]);
  channel.send(new Uint8Array([9]));
  assert.equal(port.sent.length, 0, 'nothing is sent before open');
  port.deliver({ type: 'open' });
  assert.equal(channel.readyState, 'open');
  const buffer = new Uint8Array([1, 2, 3, 4]);
  channel.send(buffer.subarray(1, 3));
  buffer.fill(0);  // noVNC reuses its buffer: the message holds a copy
  assert.deepEqual([...port.sent[0].data], [2, 3]);
  port.deliver({ type: 'data', data: new Uint8Array([7, 8]) });
  assert.deepEqual([...events[1]], [7, 8]);
  port.deliver({ type: 'close', failure: 'not_running' });
  assert.equal(channel.readyState, 'closed');
  assert.equal(channel.failure, 'not_running');
  assert.deepEqual(events.at(-1), ['close', 1006]);
  assert.ok(port.closed);
  port.deliver({ type: 'data', data: new Uint8Array([1]) });
  assert.equal(events.length, 3, 'nothing arrives after close');
});

test('closing the channel tells the main process and closes cleanly', () => {
  const port = new PagePort(), channel = new shared.PortChannel(port);
  let closed;
  channel.onclose = event => { closed = event; };
  port.deliver({ type: 'open' });
  channel.close();
  assert.deepEqual(port.sent.at(-1), { type: 'close' });
  assert.equal(closed.code, 1000);
  assert.equal(channel.readyState, 'closed');
});

test('Mac shortcuts become Linux keys; Cmd itself is never sent', () => {
  const key = (code, extra = {}) => keys.macShortcut({ key: code.replace(/^Key/, '').toLowerCase(), code, metaKey: true, ctrlKey: false, altKey: false, ...extra });
  assert.equal(keys.macShortcut({ key: 'Meta', code: 'MetaLeft', metaKey: true, ctrlKey: false, altKey: false }), null);
  assert.deepEqual(key('KeyC'), { keysym: 0x63, code: 'KeyC', ctrl: true, paste: false });
  assert.deepEqual(key('KeyV'), { keysym: 0x76, code: 'KeyV', ctrl: true, paste: true });
  assert.deepEqual(key('ArrowLeft'), { keysym: 0xff50, code: 'Home', ctrl: false, paste: false });
  assert.deepEqual(key('ArrowDown'), { keysym: 0xff57, code: 'End', ctrl: true, paste: false });
  assert.equal(keys.macShortcut({ key: 'c', code: 'KeyC', metaKey: false, ctrlKey: false, altKey: false }), undefined);
  assert.equal(key('KeyC', { ctrlKey: true }), undefined);
  assert.equal(key('Space'), null);
  // Dvorak: the physical key is KeyK, the layout letter is v.
  assert.deepEqual(keys.macShortcut({ key: 'v', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false }), { keysym: 0x76, code: 'KeyV', ctrl: true, paste: true });
});

async function server(handler) {
  const wss = new WebSocketServer({ port: 0, verifyClient: handler.verify });
  await new Promise(resolve => wss.once('listening', resolve));
  wss.on('connection', (ws, request) => handler.connection?.(ws, request));
  return { wss, baseUrl: `http://127.0.0.1:${wss.address().port}`, close: () => new Promise(resolve => { for (const c of wss.clients) c.terminate(); wss.close(resolve); }) };
}

test('relay carries bytes both ways with the credential only in the main process', async () => {
  let socket, header, path;
  const host = await server({ connection(ws, request) {
    socket = ws; header = request.headers.authorization; path = request.url;
    ws.send(Buffer.from('RFB 003.008\n'));
    ws.on('message', data => ws.send(Buffer.concat([Buffer.from('echo:'), data])));
  } });
  const port = new MainPort();
  try {
    relayRemoteScreen(port, { baseUrl: host.baseUrl, token: 'device-token' });
    assert.ok(port.started);
    await until(() => port.received.length >= 2);
    assert.equal(header, 'Bearer device-token');
    assert.equal(path, '/v1/remote-screen');
    assert.deepEqual(port.received[0], { type: 'open' });
    assert.equal(Buffer.from(port.received[1].data).toString(), 'RFB 003.008\n');
    assert.ok(port.received[1].data instanceof Uint8Array);
    assert.ok(!JSON.stringify(port.received).includes('device-token'));
    port.fromPage({ type: 'data', data: new Uint8Array([5, 6]) });
    port.fromPage({ type: 'eval', data: 'x' });
    await until(() => port.received.length >= 3);
    assert.deepEqual([...port.received[2].data], [...Buffer.from('echo:'), 5, 6]);
    port.fromPage({ type: 'close' });
    await until(() => socket.readyState === socket.CLOSED);
    assert.ok(port.closed);
  } finally { await host.close(); }
});

test('a refused or revoked screen reaches the page as a reason', async () => {
  const refused = await server({ verify: (_info, done) => done(false, 503) });
  try {
    const port = new MainPort();
    relayRemoteScreen(port, { baseUrl: refused.baseUrl, token: 't' });
    await until(() => port.received.some(m => m.type === 'close'));
    assert.deepEqual(port.received.at(-1), { type: 'close', failure: 'not_running' });
    assert.ok(port.closed);
  } finally { await refused.close(); }
  const revoked = await server({ connection: ws => setTimeout(() => ws.close(1008, 'credential revoked'), 20) });
  try {
    const port = new MainPort();
    relayRemoteScreen(port, { baseUrl: revoked.baseUrl, token: 't' });
    await until(() => port.received.some(m => m.type === 'close'));
    assert.deepEqual(port.received.at(-1), { type: 'close', failure: 'unauthorized' });
  } finally { await revoked.close(); }
});

test('the page going away closes the screen connection', async () => {
  let socket;
  const host = await server({ connection: ws => { socket = ws; } });
  try {
    const port = new MainPort();
    relayRemoteScreen(port, { baseUrl: host.baseUrl, token: 't' });
    await until(() => socket && port.received.length >= 1);
    port.emit('close');
    await until(() => socket.readyState === socket.CLOSED);
  } finally { await host.close(); }
});
