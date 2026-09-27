import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeTransport } from '../src/transport.ts';
import { newSend, restoreSend, connection } from '../src/send.ts';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { projectTimeline } from '../src/timeline.ts';

const config = connection('https://example.test', 'private-token', 'identity-A');
const id = n => `mob_123e4567-e89b-12d3-a456-${String(n).padStart(12, '0')}`;
const attachment = (n, thread_id = 'thread') => ({ id: `att_${String(n).padStart(32, '0')}`, thread_id, name: `照片${n}.png`, mime: 'image/png', size: n, state: 'available' });
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
class Store {
  data = new Map(); fail = null;
  async getItemAsync(k) { assert.match(k, /^[A-Za-z0-9._-]+$/); if (this.fail?.('get', k)) throw Error('storage failed'); return this.data.get(k) ?? null; }
  async setItemAsync(k,v) { assert.match(k, /^[A-Za-z0-9._-]+$/); assert.ok(Buffer.byteLength(v) <= 2048, 'SecureStore value too large'); if (this.fail?.('set', k)) throw Error('storage failed'); this.data.set(k,v); }
  async deleteItemAsync(k) { if (this.fail?.('delete', k)) throw Error('storage failed'); this.data.delete(k); }
}
const remote = () => ({ sends: [], messages: new Map(), receipts: new Map(), supportsLatest: true,
  async send(...args) { this.sends.push(args); if (this.sends.length === 1) throw new TypeError('Network request failed'); return { id: 'receipt', thread_id: args[0], client_message_id: args[1], durable: true, state: 'queued' }; },
  async getReceipt() { throw Error('unused'); }, async historyTail() {} });

test('attachment-only durable retry preserves descriptor order and ids across cold restart and mutation', async () => {
  const store = new Store(), first = new OutboxStore(store, config), files = [attachment(1), attachment(2)];
  const record = newSend(config, 'thread', '', id(1), files);
  await first.enqueue(record);
  files[0].name = 'changed.png'; record.attachments.reverse();
  const meta = [...store.data].filter(([k]) => !k.includes('.part.')).map(([,v]) => v);
  assert.equal(meta.length, 1); assert.equal(JSON.parse(meta[0]).version, 3);
  assert.ok(!meta[0].includes('照片') && !meta[0].includes('attachments'));
  assert.equal(first.records[0].attachments[0].name, '照片1.png');
  first.records[0].attachments[0].name = 'mutated again';
  await assert.rejects(first.update({ ...first.records[0], attachments: [attachment(2), attachment(1)] }), /The saved message identity or text has changed\./);
  const sdk = remote(), revived = new MobileOutbox(new OutboxStore(store, config), sdk, () => {}, () => Date.now(), () => 0);
  await revived.start(); assert.deepEqual(revived.records[0].attachments.map(a => a.id), [attachment(1).id, attachment(2).id]);
  revived.setConnection('online'); await flush(); assert.equal(revived.records[0].status, 'ambiguous');
  await revived.stop();
  const next = new MobileOutbox(new OutboxStore(store, config), sdk, () => {}, () => Date.now() + 100000, () => 0);
  await next.start(); next.setConnection('online'); await flush();
  assert.deepEqual(sdk.sends.map(args => args.slice(0, 4)), [
    ['thread', id(1), '', [attachment(1).id, attachment(2).id]],
    ['thread', id(1), '', [attachment(1).id, attachment(2).id]]
  ]);
  assert.equal(next.records[0].status, 'accepted'); await next.stop();
});

test('midwrite failure leaves only preparatory marker and no network send; cold load cleans it', async () => {
  const store = new Store(), sdk = remote();
  store.fail = (op, key) => op === 'set' && key.includes('.part.1');
  const box = new MobileOutbox(new OutboxStore(store, config), sdk, () => {});
  await box.start();
  await assert.rejects(box.enqueue(newSend(config, 'thread', '大'.repeat(500), id(2), [attachment(1)])), /storage failed/);
  assert.equal(sdk.sends.length, 0); await box.stop();
  store.fail = null;
  const clean = new OutboxStore(store, config); await clean.load();
  assert.equal(clean.records.length, 0); assert.equal(store.data.size, 0);
});

test('text-only v2 remains readable and updateable; invalid attachment metadata cannot enqueue', async () => {
  const store = new Store(), box = new OutboxStore(store, config);
  await box.enqueue(newSend(config, 'thread', 'old text', id(3)));
  assert.equal(JSON.parse([...store.data.values()].find(s => s.startsWith('{'))).version, 2);
  const resumed = new OutboxStore(store, config); await resumed.load();
  await resumed.update({ ...resumed.records[0], status: 'ambiguous' });
  const again = new OutboxStore(store, config); await again.load();
  assert.equal(again.records[0].text, 'old text'); assert.equal(again.records[0].status, 'ambiguous');
  for (const bad of [
    [attachment(1), attachment(1)], Array.from({length:9}, (_, i) => attachment(i+1)),
    [{...attachment(1), thread_id:'foreign'}], [{...attachment(1), state:'missing'}],
    [{...attachment(1), size:0}], [{...attachment(1), size:10485761}],
    [{...attachment(1), name:'../secret'}], [{...attachment(1), receipt_id:'taken'}]
  ]) assert.throws(() => newSend(config,'thread','',id(4),bad));
  assert.equal(restoreSend(JSON.stringify(newSend(config,'thread','',id(5),[attachment(1)])),config).attachments[0].id, attachment(1).id);
});

test('timeline carries optimistic attachments and authoritative replacements under same key', () => {
  const local = newSend(config, 'thread', '', id(6), [attachment(1),attachment(2)]);
  const before = projectTimeline([], local, 'thread', undefined, true)[0];
  const after = projectTimeline([{ id:'row', ref_seq:6, role:'user', text:'', client_message_id:id(6), attachments:[attachment(1),attachment(2)] }],local,'thread',undefined,true)[0];
  assert.equal(before.key,after.key); assert.deepEqual(before.attachments,after.attachments); assert.equal(after.optimistic,undefined);
  assert.equal(projectTimeline([],local,'other',undefined,true).length,0);
});

test('native binary upload/download uses bounded fetch, header auth and exact roundtrip', async () => {
  const original = globalThis.fetch, calls = [], blob = Uint8Array.of(0, 1, 127, 128, 255);
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({url, options});
      if (options.method === 'POST') {
        assert.deepEqual(new Uint8Array(options.body), blob);
        assert.equal(options.headers['X-File-Name'], encodeURIComponent('照片.png'));
        assert.equal(options.headers['X-File-Name-Encoding'], 'percent-utf8');
        return { status:201, headers:{get:k=>k==='content-type'?'application/json':null}, text: async()=>JSON.stringify({attachment:{...attachment(5),name:'照片.png',size:5}}) };
      }
      return {status:200, headers:{get:k=>k==='content-length'?'5':null},arrayBuffer:async()=>blob.slice().buffer};
    };
    const http = nativeTransport(config.baseUrl).http;
    const uploaded = await http.upload('/v1/threads/thread/attachments',config.token,'照片.png',blob);
    assert.equal(uploaded.body.attachment.id,attachment(5).id);
    assert.deepEqual((await http.download(`/v1/threads/thread/attachments/${uploaded.body.attachment.id}`,config.token)).body,blob);
    assert.ok(calls.every(c=>!c.url.includes(config.token) && c.options.headers.Authorization==='Bearer '+config.token));
    const abort = new AbortController(); abort.abort();
    await http.upload('/path',config.token,'照片.png',blob,abort.signal);
    assert.equal(calls[2].options.signal,abort.signal);
  } finally { globalThis.fetch = original; }
});

test('binary adapter enforces upload/download limits and retains Retry-After', async () => {
  const original = globalThis.fetch;
  try {
    let seen;
    globalThis.fetch = async (url, options) => { seen = options; return {status:429,headers:{get:k=>k==='retry-after'?'3':null},text:async()=> 'busy'}; };
    const http = nativeTransport(config.baseUrl).http;
    const reply = await http.upload('/v1/threads/thread/attachments',config.token,'x.png',Uint8Array.of(1));
    assert.equal(reply.retryAfterMs,3000); assert.equal(seen.signal,undefined);
    await assert.rejects(http.upload('/path',config.token,'x',new Uint8Array(10485761)),/10 MiB/);
    globalThis.fetch = async () => ({status:200,headers:{get:()=>String(10485761)},arrayBuffer:async()=>{throw Error('must not allocate');}});
    await assert.rejects(http.download('/path',config.token),/The attachment is too large to download\./);
  } finally {globalThis.fetch = original;}
});
