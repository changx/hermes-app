import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeTransport } from '../src/transport.ts';

test('native HTTP and WS attach Authorization header, never token in URL; buffer handshake frame', async () => {
  const originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
  const observed = [];
  class FakeSocket {
    constructor(url, protocols, options) {
      observed.push({ url, protocols, options });
      setImmediate(() => { this.onmessage?.({ data: '{"type":"hello"}' }); this.onopen?.(); });
    }
    close() { this.onclose?.(); }
  }
  try {
    globalThis.fetch = async (url, options) => {
      observed.push({ url, options });
      return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}' };
    };
    globalThis.WebSocket = FakeSocket;
    const transport = nativeTransport('https://agent.tuly.space');
    const http = await transport.http.request('GET', '/v1/capabilities', 'private-test-token');
    assert.deepEqual(http, { status: 200, body: { ok: true } });
    const socket = await transport.socket.connect('/v1/events?cursor=x', 'private-test-token', new AbortController().signal);
    const frames = [];
    socket.onMessage(frame => frames.push(frame));
    assert.deepEqual(frames, ['{"type":"hello"}']);
    assert.equal(observed[0].options.headers.Authorization, 'Bearer private-test-token');
    assert.equal(observed[1].options.headers.Authorization, 'Bearer private-test-token');
    assert.equal(observed[1].url, 'wss://agent.tuly.space/v1/events?cursor=x');
    assert.ok(observed.every(entry => !entry.url.includes('private-test-token')));
    socket.close();
  } finally {
    globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
  }
});
