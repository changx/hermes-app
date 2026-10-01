import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

const receipt = (version = 2, processing = 'completed') => ({ id: 'r', client_message_id: 'c', thread_id: 'th', ref_seq: 1, state: 'completed', durable: true, version, processing });
const message = r => ({ id: 'receipt:r', role: 'user', text: 'same', ref_seq: 1, receipt_id: 'r', client_message_id: 'c', ...(r ? {receipt:r} : {}) });
const body = messages => ({messages:messages.map(({receipt,...m})=>m), ...(messages.some(m=>m.receipt) ? {receipts:messages.filter(m=>m.receipt).map(m=>m.receipt)} : {}), next_cursor:null, older_cursor:null, incomplete_turns:[], turn_outcomes:[]});
const client = (request, onChange) => {
  const sdk = new HermesClient({ token: () => 'test', http: {request}, socket: {connect() {}}, onChange });
  sdk.supportsLatest = true;
  return sdk;
};
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve} };

for (const method of ['forward', 'latest', 'older', 'exact']) {
  test(`${method} history publishes matching execution state with the first row notification`, async () => {
    const calls = [], published = [];
    const sdk = client(async (_method, path) => { calls.push(path); return {status:200, body:body([message(receipt())])} }, () => {
      if (sdk.messages.get('th')?.length) published.push(sdk.receipts.get('r'));
    });
    if (method === 'latest' || method === 'older') await sdk.historyWindow('th', method === 'older' ? 'before' : undefined);
    else await sdk.history('th', undefined, 30, undefined, undefined, method === 'exact' ? 1 : undefined);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('/messages?'));
    assert.deepEqual(published, [receipt()]);
    assert.deepEqual(sdk.receipts.get('r'), receipt());
    assert.equal(sdk.messages.get('th')[0].receipt_id, 'r');
  });
}

test('all bundled identities are validated before committing any page state', async () => {
  for (const change of [{id:'foreign'}, {thread_id:'other'}, {client_message_id:'other'}, {ref_seq:2}, {version:undefined}, {version:-1}, {version:1.5}, {version:'2'}]) {
    const sdk = client(async () => ({status:200,body:body([message({...receipt(), ...change})])}));
    await assert.rejects(sdk.history('th'), ProtocolError);
    assert.equal(sdk.receipts.size, 0);
    assert.equal(sdk.messages.size, 0);
  }
  for (const messages of [
    [{...message(receipt()), role:'assistant'}],
    [message(receipt()), {...message(receipt()),ref_seq:2}],
    [message(receipt()), {...message({...receipt(),id:'other',ref_seq:2}),ref_seq:2,receipt_id:'other',client_message_id:'wrong'}]
  ]) {
    const sdk = client(async () => ({status:200,body:body(messages)}));
    await assert.rejects(sdk.historyWindow('th'), ProtocolError);
    assert.equal(sdk.receipts.size, 0);
    assert.equal(sdk.messages.size, 0);
  }
});

test('late history cannot overwrite newer live outcome or feedback', async () => {
  const gate = deferred();
  const live = {...receipt(5, 'unknown'), state:'unknown', feedback:'new feedback'};
  const sdk = client(async (_method,path) => path.includes('/messages') ? gate.promise : {status:200,body:{receipt:live}});
  const history = sdk.historyWindow('th');
  await sdk.getReceipt('r');
  gate.resolve({status:200,body:body([message({...receipt(2,'running'),state:'running',feedback:'old feedback'})])});
  await history;
  assert.deepEqual(sdk.receipts.get('r'), live);
});

test('newer live result updates a historical state and late ACK stays behind version fence', async () => {
  let value = receipt(2,'unknown');
  const sdk = client(async (_method,path) => ({status:200,body:path.includes('/messages') ? body([message(value)]) : {receipt:value}}));
  await sdk.history('th');
  value = receipt(4,'failed');
  await sdk.getReceipt('r');
  value = {...receipt(3,'running'),state:'running'};
  await sdk.getReceipt('r');
  assert.equal(sdk.receipts.get('r').processing,'failed');
  assert.equal(sdk.receipts.get('r').version,4);
});

test('legacy history retains identities without fabricating an execution state', async () => {
  const sdk = client(async () => ({status:200,body:body([message()])}));
  await sdk.historyWindow('th');
  assert.equal(sdk.receipts.size,0);
  assert.equal(sdk.messages.get('th')[0].receipt_id,'r');
});

test('cold new client restores terminal state without receipt round trips', async () => {
  for (let n = 0; n < 2; n++) {
    let requests = 0;
    const sdk = client(async () => { requests++; return {status:200,body:body([message(receipt())])} });
    await sdk.historyWindow('th');
    assert.equal(requests,1);
    assert.equal(sdk.receipts.get('r').processing,'completed');
  }
});
