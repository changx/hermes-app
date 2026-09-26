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

test('native Retry-After parses seconds and HTTP date without confusing invalid headers', async () => {
  const originalFetch=globalThis.fetch;
  let value='2';
  try {
    globalThis.fetch=async()=>({status:429,headers:{get:key=>key==='retry-after'?value:'text/plain'},text:async()=>'busy'});
    const http=nativeTransport('https://example.invalid').http;
    assert.equal((await http.request('GET','/v1/sync','synthetic')).retryAfterMs,2000);
    value=new Date(Date.now()+5000).toUTCString();
    const delay=(await http.request('GET','/v1/sync','synthetic')).retryAfterMs;
    assert.ok(delay>=3000 && delay<=5000);
    value='nope';assert.equal((await http.request('GET','/v1/sync','synthetic')).retryAfterMs,undefined);
  } finally {globalThis.fetch=originalFetch}
});

test('native pre-open abort disposes socket and rejects; ping is a protocol text frame', async () => {
  const original=globalThis.WebSocket;let ws,closed=0,frames=[];
  class FakeSocket {
    constructor(url,protocols,options){ws=this;assert.equal(options.headers.Authorization,'Bearer synthetic');assert.ok(!url.includes('synthetic'))}
    close(){closed++;this.onclose?.()}
    send(data){frames.push(data)}
  }
  try {
    globalThis.WebSocket=FakeSocket;
    const transport=nativeTransport('https://example.invalid');
    const control=new AbortController();
    const opening=transport.socket.connect('/v1/events','synthetic',control.signal);
    control.abort();await assert.rejects(opening,/WebSocket/);assert.ok(closed>=1);
    const next=transport.socket.connect('/v1/events','synthetic',new AbortController().signal);
    ws.onopen();const connected=await next;
    connected.send('ping');assert.deepEqual(frames,['ping']);connected.close();
  } finally {globalThis.WebSocket=original}
});
