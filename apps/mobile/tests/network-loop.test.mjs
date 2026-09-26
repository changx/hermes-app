import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, connectionFailure } from '../../../packages/client/dist/index.js';
import { nativeTransport } from '../src/transport.ts';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(5); } assert.fail('condition timed out'); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const response = (body, status = 200) => ({ status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
const memory = () => { const values = new Map(); return { values, async getItemAsync(k) { return values.get(k) ?? null; }, async setItemAsync(k, v) { values.set(k, v); }, async deleteItemAsync(k) { values.delete(k); } }; };
const config = { id: 'isolated-network-test', baseUrl: 'https://example.invalid', token: 'private-test-token' };
const record = { connectionId: config.id, threadId: 'thread-1', clientMessageId: 'mob_00000000-0000-4000-8000-000000000001', text: 'original', status: 'queued' };
const hello = JSON.stringify({ type: 'hello', protocol: 1, durable_sync: true });
const event = JSON.stringify({ type: 'event', event_id: 1, cursor: 'c1', kind: 'read', thread_id: 'thread-1', ref: '1', version: 1 });

test('native transport + SDK: slow healthy read replay does not take online outbox offline', async () => {
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  const gate = deferred(), sockets = [], states = [], sends = [];
  let started = false, snapshotCalls = 0;
  class NativeSocket {
    constructor() { sockets.push(this); queueMicrotask(() => { this.onopen?.(); this.onmessage?.({ data: hello }); }); }
    send(data) { if (data === 'ping') queueMicrotask(() => this.onmessage?.({ data: 'pong' })); }
    close() { this.onclose?.(); }
    emit(data) { this.onmessage?.({ data }); }
  }
  let sdk, box;
  try {
    globalThis.WebSocket = NativeSocket;
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      if (path === '/v1/capabilities') return response({ protocol: 1, durable_sync: true, history_latest: true, message_send_identity: true });
      if (path === '/v1/sync') return response(started ? { events: [{ event_id: 1, cursor: 'c1', kind: 'read', thread_id: 'thread-1', ref: '1', version: 1 }], waterline: 'c1', next_cursor: 'c1', has_more: false } : { events: [], waterline: 'c0', next_cursor: 'c0', has_more: false });
      if (path === '/v1/snapshot') { snapshotCalls++; if (started) await gate.promise; return response({ threads: [], waterline: 'c0', next_after: null }); }
      if (path === '/v1/threads/thread-1/messages' && options.method === 'POST') {
        sends.push(JSON.parse(options.body));
        return response({ receipt: { id: 'r1', client_message_id: record.clientMessageId, thread_id: 'thread-1', state: 'queued', durable: true } }, 202);
      }
      if (path === '/v1/threads/thread-1/messages') return response({ messages: [], older_cursor: null });
      throw Error('unexpected fixture path ' + path);
    };
    sdk = new HermesClient({ ...nativeTransport(config.baseUrl), token: () => config.token, requestTimeoutMs: 1000, livenessMs: 500,
      onConnectionState: state => { states.push(state); box?.setConnection(state); } });
    sdk.cursor = 'c0';
    box = new MobileOutbox(new OutboxStore(memory(), config), sdk, () => {});
    await box.start(); await sdk.connect(); await until(() => sdk.connectionState === 'online');
    // Gate a real read-receipt snapshot HTTP, not a synthetic state callback.
    started = true; sockets[0].emit(event); for (let i = 0; i < 100; i++) sockets[0].emit(event);
    await until(() => snapshotCalls === 1);
    await box.enqueue(record);
    await until(() => sends.length === 1);
    assert.equal(sends[0].client_message_id, record.clientMessageId);
    assert.equal(sends[0].text, record.text);
    assert.equal(sdk.connectionState, 'online');
    gate.resolve(); await until(() => sdk.cursor === 'c1');
    assert.equal(states.filter(s => s === 'syncing').length, 1, 'only initial catchup may advertise syncing');
  } finally {
    gate.resolve(); sdk?.close(); await box?.stop(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket;
  }
});

test('native-like fetch failure retries; new hello gates foreground recovery', async () => {
  const oldFetch=globalThis.fetch, oldSocket=globalThis.WebSocket;
  const sockets=[], failures=[], states=[];
  let requests=0, syncs=0;
  class NativeSocket {
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    close() { this.onclose?.(); }
    send(data) { if(data==='ping')queueMicrotask(() => this.onmessage?.({data:'pong'})); }
    emit(data) { this.onmessage?.({data}); }
  }
  let sdk;
  try {
    globalThis.WebSocket=NativeSocket;
    globalThis.fetch=async url => {
      const path=new URL(url).pathname;
      if(path==='/v1/capabilities') {
        if(++requests===1)throw new TypeError('Network request failed: '+config.token+'?secret=body');
        return response({protocol:1,durable_sync:true});
      }
      if(path==='/v1/sync') {syncs++;return response({events:[],waterline:'c0',next_cursor:'c0',has_more:false});}
      throw Error('unexpected '+path);
    };
    sdk=new HermesClient({...nativeTransport(config.baseUrl),token:()=>config.token,backoffMs:[5],connectTimeoutMs:100,
      onError:error=>failures.push(connectionFailure(error)),onConnectionState:state=>states.push(state)});
    sdk.cursor='c0';await sdk.connect();await until(()=>sockets.length===1);
    assert.deepEqual(failures,['网络传输失败']);
    assert.notEqual(sdk.connectionState,'online');
    sockets[0].emit(hello);await until(()=>sdk.connectionState==='online');
    sdk.close();await sdk.connect();await until(()=>sockets.length===2);
    assert.notEqual(sdk.connectionState,'online');
    sockets[0].emit('{bad');sockets[1].emit(hello);await until(()=>sdk.connectionState==='online');
    assert.ok(syncs>=4);assert.equal(failures.length,1);
    assert.ok(states.includes('retrying'));
  } finally { sdk?.close();globalThis.fetch=oldFetch;globalThis.WebSocket=oldSocket; }
});
