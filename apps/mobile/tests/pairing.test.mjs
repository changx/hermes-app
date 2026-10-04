import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { newPairing, restorePairing, completePairing, normalizePairingCode, CONFIG_KEY, PAIRING_KEY } from '../src/pairing.ts';

const make = () => newPairing('https://example.test', 'ABCD-EFGH-IJKL-MNOP', 'iPhone', 'connection-test', randomBytes(44));
const response = (status, body, headers) => new Response(JSON.stringify(body), { status, headers });
const storage = () => ({ data: new Map(), async getItemAsync(k) { return this.data.get(k) ?? null; }, async setItemAsync(k,v) { assert.match(k,/^[\w.-]+$/); this.data.set(k,v); }, async deleteItemAsync(k) { this.data.delete(k); } });
const caps = { protocol:1 };

test('pairing creates exact secure credential format and validates code/base', () => {
  const bytes = randomBytes(44), pending = newPairing('https://example.test/','abcd efgh ijkl mnop','phone','identity',bytes);
  assert.equal(pending.config.token, 'ha_dev_'+bytes.subarray(0,12).toString('hex')+'_'+bytes.subarray(12).toString('base64url'));
  assert.equal(normalizePairingCode('abcd-efgh-ijkl-mnop'),pending.code);
  assert.deepEqual(restorePairing(JSON.stringify(pending)),pending);
  assert.throws(()=>newPairing('http://example.test',pending.code,'phone','id',bytes));
  assert.throws(()=>normalizePairingCode('short'));
  assert.throws(()=>restorePairing('{broken'));
});
test('candidate committed before network and code/secret never enter URL', async () => {
  const pending=make(),store=storage(),abort=new AbortController(); let authorized=false;
  const result=await completePairing(pending,{store,signal:abort.signal,fetcher:async(url,init)=>{
    assert.ok(store.data.has(PAIRING_KEY));assert.equal(url.includes(pending.code),false);assert.equal(url.includes(pending.config.token),false);
    if(url.endsWith('/capabilities')) return response(authorized?200:401,authorized?caps:{});
    assert.equal(init.headers.Authorization,undefined);
    const body=JSON.parse(init.body);assert.equal(body.device_token,pending.config.token);assert.equal(body.code,pending.code);
    authorized=true;return response(201,{device_id:pending.config.token.slice(7,31)});
  }});
  assert.deepEqual(result,pending.config);assert.equal(store.data.has(PAIRING_KEY),false);assert.deepEqual(JSON.parse(store.data.get(CONFIG_KEY)),pending.config);
});
test('lost exchange ACK automatically verifies saved credential without another code',async()=>{
  const pending=make(),store=storage();let authorized=false,exchanges=0;
  const result=await completePairing(pending,{store,signal:new AbortController().signal,delayMs:1,fetcher:async(url)=>{
    if(url.endsWith('/capabilities'))return response(authorized?200:401,authorized?caps:{});
    exchanges++;authorized=true;throw new TypeError('network lost after commit');
  }});
  assert.equal(exchanges,1);assert.deepEqual(result,pending.config);
});
test('cold restore of successful exchange survives expired code',async()=>{
  const pending=make(),store=storage();store.data.set(PAIRING_KEY,JSON.stringify(pending));
  const saved=restorePairing(await store.getItemAsync(PAIRING_KEY));
  const result=await completePairing(saved,{store,signal:new AbortController().signal,fetcher:async(url)=>{
    assert.ok(url.endsWith('/capabilities'));return response(200,caps);
  }});assert.deepEqual(result,pending.config);
});
test('timeout ignoring abort is bounded and retries saved candidate',async()=>{
  const pending=make(),store=storage();let calls=0;
  const result=await completePairing(pending,{store,signal:new AbortController().signal,timeoutMs:5,delayMs:1,fetcher:async()=>{
    calls++;if(calls===1)return new Promise(()=>{});return response(200,caps);
  }});assert.equal(calls,2);assert.deepEqual(result,pending.config);
});
test('invalid code is actionable and cannot replace existing connection',async()=>{
  const pending=make(),store=storage();store.data.set(CONFIG_KEY,'old-connection');
  await assert.rejects(completePairing(pending,{store,signal:new AbortController().signal,fetcher:async(url)=>response(url.endsWith('/capabilities')?401:400,{})}),/pairing code/);
  assert.equal(store.data.get(CONFIG_KEY),'old-connection');assert.ok(store.data.has(PAIRING_KEY));
});
test('abort prevents late ignored-abort reply from activating identity',async()=>{
  const pending=make(),store=storage(),abort=new AbortController();let started;const start=new Promise(r=>started=r);let deliver;
  const result=completePairing(pending,{store,signal:abort.signal,fetcher:async()=>{started();return new Promise(r=>deliver=r);}});
  await start;abort.abort();await assert.rejects(result,{name:'AbortError'});deliver(response(200,caps));await new Promise(r=>setImmediate(r));
  assert.equal(store.data.has(CONFIG_KEY),false);assert.ok(store.data.has(PAIRING_KEY));
});
test('storage failure before network never submits pairing',async()=>{
  const store=storage();store.setItemAsync=async()=>{throw new Error('storage failed');};let calls=0;
  await assert.rejects(completePairing(make(),{store,signal:new AbortController().signal,fetcher:async()=>{calls++;}}),/Pairing has not started/);assert.equal(calls,0);
});
test('authorization rejected after provision does not endlessly redeem',async()=>{
  const pending=make(),store=storage();let exchanges=0;
  await assert.rejects(completePairing(pending,{store,signal:new AbortController().signal,fetcher:async(url)=>{
    if(url.endsWith('/capabilities'))return response(401,{});exchanges++;return response(201,{device_id:pending.config.token.slice(7,31)});
  }}),/has not been authorized yet/);assert.equal(exchanges,1);assert.equal(store.data.has(CONFIG_KEY),false);
});
