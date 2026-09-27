import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../../../packages/client/dist/index.js';
import { nativeTransport } from '../src/transport.ts';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { projectTimeline } from '../src/timeline.ts';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { for (let i = 0; i < 400; i++) { if (predicate()) return; await pause(5); } assert.fail('condition timed out'); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const config = { id: 'stop-send-test', baseUrl: 'https://example.invalid', token: 'synthetic-test-only' };
const response = (body, status = 200) => ({ status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
const hello = JSON.stringify({ type: 'hello', protocol: 1, durable_sync: true });
const draft = n => ({ connectionId: config.id, threadId: 'thread', clientMessageId: 'mob_00000000-0000-4000-8000-' + String(n).padStart(12, '0'), text: 'same text', status: 'queued' });

// Exercise the native adapter, actual SDK recovery/state callbacks and durable
// outbox together. Server responses are explicit fixtures, not live evidence.
test('repeated stop/send tolerates stale receipt, lost ACK and reconnect without blocking the next message', async () => {
  const oldFetch = globalThis.fetch, oldSocket = globalThis.WebSocket;
  const values = new Map(), server = new Map(), posts = [], events = [], sockets = [], states = [], errors = [];
  const stale = deferred(); let staleStarted = false, holdStale = false, loseAck = false;
  let sdk, box, stopCount = 0;
  const eventFor = r => {
    const n = events.length + 1;
    const e = { type: 'event', event_id: n, cursor: 'c' + n, kind: 'receipt', thread_id: 'thread', ref: r.id, version: n };
    events.push(e); sockets.at(-1)?.emit(JSON.stringify(e));
  };
  class NativeSocket {
    constructor() { sockets.push(this); queueMicrotask(() => { this.onopen?.(); this.onmessage?.({ data: hello }); }); }
    send(data) { if (data === 'ping') queueMicrotask(() => this.emit('pong')); }
    close() { this.onclose?.(); }
    emit(data) { this.onmessage?.({ data }); }
  }
  try {
    globalThis.WebSocket = NativeSocket;
    globalThis.fetch = async (url, options) => {
      const u = new URL(url), path = u.pathname;
      if (path === '/v1/capabilities') return response({ protocol: 1, durable_sync: true, history_latest: true, message_send_identity: true });
      if (path === '/v1/sync') {
        const after = Number((u.searchParams.get('cursor') || 'c0').slice(1));
        const selected = events.filter(e => e.event_id > after);
        return response({ events: selected, waterline: 'c' + events.length, next_cursor: selected.at(-1)?.cursor || 'c' + after, has_more: false });
      }
      if (path === '/v1/threads/thread/messages' && options.method === 'POST') {
        const body = JSON.parse(options.body); posts.push(body);
        let r = server.get(body.client_message_id);
        if (!r) { r = { id: 'rc_' + server.size, thread_id: 'thread', client_message_id: body.client_message_id, state: 'running', durable: true }; server.set(body.client_message_id, r); eventFor(r); }
        if (loseAck) { loseAck = false; throw new TypeError('Network request failed'); }
        return response({ receipt: { ...r } }, 202);
      }
      if (path === '/v1/threads/thread/messages') {
        const messages = [...server.values()].map((r, i) => ({ id: 'm' + i, ref_seq: i + 1, role: 'user', text: 'same text', receipt_id: r.id, client_message_id: r.client_message_id }));
        return response({ messages, older_cursor: null, next_cursor: null });
      }
      if (path.startsWith('/v1/receipts/')) {
        const r = [...server.values()].find(r => r.id === path.split('/').at(-1));
        assert.ok(r); const copy = { ...r };
        if (holdStale && !staleStarted) { staleStarted = true; await stale.promise; }
        return response({ receipt: copy });
      }
      if (path === '/v1/threads/thread/stop') {
        stopCount++;
        const r = [...server.values()].findLast(r => r.state === 'running');
        if (r) { r.state = 'interrupted'; eventFor(r); }
        return response({ stopped: !!r });
      }
      throw Error('Unexpected fixture path: ' + path);
    };
    const storage = { async getItemAsync(k) { return values.get(k) ?? null; }, async setItemAsync(k,v) { values.set(k,v); }, async deleteItemAsync(k) { values.delete(k); } };
    sdk = new HermesClient({ ...nativeTransport(config.baseUrl), token: () => config.token, requestTimeoutMs: 1500, livenessMs: 5000, backoffMs: [5],
      onChange: () => box?.reconcile(), onConnectionState: state => { states.push(state); box?.setConnection(state); }, onError: e => errors.push(e.name) });
    sdk.cursor = 'c0';
    box = new MobileOutbox(new OutboxStore(storage, config), sdk, () => {}, () => Date.now(), () => 0, 25);
    await box.start(); await sdk.connect(); await until(() => sdk.connectionState === 'online');
    for (let n = 1; n <= 6; n++) {
      if (n === 4) loseAck = true;
      await box.enqueue(draft(n));
      await until(() => box.records.some(r => r.clientMessageId === draft(n).clientMessageId && r.status === 'accepted'));
      const r = server.get(draft(n).clientMessageId);
      let oldRequest;
      if (n === 2) { holdStale = true; oldRequest = sdk.getReceipt(r.id); await until(() => staleStarted); }
      assert.equal(await sdk.stop('thread'), true);
      // Force an authoritative terminal read ahead of the delayed running read.
      await sdk.getReceipt(r.id);
      if (oldRequest) { stale.resolve(); await oldRequest; assert.equal(sdk.receipts.get(r.id).state, 'interrupted'); holdStale = false; }
      await until(() => !box.records.some(x => x.clientMessageId === r.client_message_id));
      if (n === 3) { const old = sockets.at(-1); box.setConnection('suspended'); sdk.close(); await sdk.connect(); await until(() => sdk.connectionState === 'online'); old.emit('{stale invalid frame'); }
      assert.equal(sdk.connectionState, 'online');
    }
    await box.enqueue(draft(7));
    await until(() => box.records.some(r => r.clientMessageId === draft(7).clientMessageId && r.status === 'accepted'));
    const rows = projectTimeline(sdk.messages.get('thread') || [], null, 'thread', undefined, true, box.records, sdk.receipts, []);
    const row = rows.find(r => r.key === `local:${draft(7).clientMessageId}`);
    assert.ok(row);
    assert.equal(!!row.optimistic && row.status !== 'accepted', false, 'production pending-color condition is cleared');
    // Identity and confirmation assertions below do not infer state from text.
    assert.equal(box.records.find(r => r.clientMessageId === draft(7).clientMessageId).status, 'accepted');
    assert.equal(server.size, 7); assert.equal(stopCount, 6);
    assert.equal(posts.filter(p => p.client_message_id === draft(4).clientMessageId).length, 2, 'lost ACK reuses ID rather than executing a new message');
    assert.deepEqual(posts.filter(p => p.client_message_id === draft(4).clientMessageId)[0], posts.filter(p => p.client_message_id === draft(4).clientMessageId)[1]);
    assert.equal(rows.length, 7); assert.equal(rows.filter(r => r.optimistic && r.status !== 'accepted').length, 0);
    assert.deepEqual(errors, []); assert.equal(states.at(-1), 'online');
  } finally { stale.resolve(); sdk?.close(); await box?.stop(); globalThis.fetch = oldFetch; globalThis.WebSocket = oldSocket; }
});
