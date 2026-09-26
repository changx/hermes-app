import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTimeline, followAfterUserScroll } from '../src/timeline.ts';
const record = {threadId:'t',clientMessageId:'one',text:'same',status:'accepted',receiptState:'running',receiptId:'rc1',connectionId:'c'};
test('accepted optimistic message keeps stable key until authoritative identity replaces it', () => {
  const pending = projectTimeline([], record, 't', undefined, true);
  assert.equal(pending.length,1);
  const final = projectTimeline([{id:'row',ref_seq:91,role:'user',text:'same',client_message_id:'one',receipt_id:'rc1'}], record, 't', undefined, true);
  assert.equal(final.length,1); assert.equal(final[0].key,pending[0].key); assert.equal(final[0].optimistic,undefined);
});
test('same text separate sends and pending queued messages retain separate identities', () => {
  const other = {...record,clientMessageId:'two',receiptId:'rc2'};
  const rows = projectTimeline([{id:'row',ref_seq:91,role:'user',text:'same',client_message_id:'one'}], other, 't', undefined, true,[record,other]);
  assert.deepEqual(rows.map(x=>x.key),['local:one','local:two']);
  assert.equal(projectTimeline([],record,'foreign',undefined,true,[other]).length,0);
});
test('cold restart does not resurrect completed local send outside latest page', () => {
  assert.equal(projectTimeline([], {...record,receiptState:'completed'}, 't', undefined, true).length,0);
});
test('manual upward movement releases follow even inside bottom threshold', () => {
  assert.equal(followAfterUserScroll(500,495,1000,500),false);
  assert.equal(followAfterUserScroll(490,500,1000,500),true);
  assert.equal(followAfterUserScroll(100,200,1000,500),false);
});
