import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../dist/index.js';

test('native replies survive history, search and same-identity edits', async () => {
  let text = 'Compressing context…';
  const sdk = new HermesClient({ token: () => 'synthetic',
    socket: { async connect() { throw new Error('unused'); } },
    http: { async request() { return { status: 200, body: { messages: [{ id: 'dm_one', ref_seq: 2,
      role: 'assistant', text, created_at: 123.5, display_kind: 'direct' }],
      next_cursor: null, older_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }
  });
  sdk.supportsLatest = true;
  await sdk.historyWindow('thread');
  assert.equal(sdk.messages.get('thread')[0].display_kind, 'direct');
  text = 'Context compressed.';
  await sdk.historyWindow('thread');
  assert.equal(sdk.messages.get('thread').length, 1);
  assert.equal(sdk.messages.get('thread')[0].text, text);
  assert.equal(sdk.messages.get('thread')[0].created_at, 123.5);
  assert.equal((await sdk.search('thread', 'compressed')).messages[0].display_kind, 'direct');
});

test('durable edit replay refreshes an older exact ref and preserves tail order', async () => {
  const paths = [];
  let fail = true;
  const original = {id:'dm_one',ref_seq:2,role:'assistant',text:'Compressing…',created_at:12,display_kind:'direct'};
  const tail = {id:'last',ref_seq:999,role:'assistant',text:'Other reply',created_at:20};
  const event = {event_id:11,cursor:'c11',kind:'message',thread_id:'thread',ref:'2',version:2};
  const sdk = new HermesClient({token:()=> 'synthetic',socket:{async connect(){throw new Error('unused');}},
    http:{async request(method,path) {
      paths.push(path);
      if(path.startsWith('/v1/sync')) return {status:200,body:{events:[event],next_cursor:'c11',waterline:'c11',has_more:false}};
      if(path.startsWith('/v1/snapshot')) return {status:200,body:{threads:[],next_after:null,waterline:'c11'}};
      const q = new URL(path,'https://test.invalid').searchParams;
      if(q.get('ref_seq')==='2') {
        if(fail)return {status:503,body:{}};
        return {status:200,body:{messages:[{...original,text:'Compressed.'}],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      }
      assert.equal(q.get('after_ref_seq'),'999');
      return {status:200,body:{messages:[],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
    }}});
  sdk.cursor='c10';sdk.lastEventId=10;sdk.messages.set('thread',[original,tail]);
  await assert.rejects(sdk.catchUp());
  assert.equal(sdk.cursor,'c10');assert.equal(sdk.messages.get('thread')[0].text,'Compressing…');
  fail=false;await sdk.catchUp();
  assert.equal(sdk.cursor,'c11');
  assert.deepEqual(sdk.messages.get('thread').map(m=>m.ref_seq),[2,999]);
  assert.equal(sdk.messages.get('thread')[0].text,'Compressed.');
  assert.equal(sdk.messages.get('thread')[0].created_at,12);
  const count=paths.length;await sdk.catchUp();
  assert.equal(paths.length,count+1); // replayed event never reapplies the edit
});

test('wrong exact-reference response cannot replace the cached native reply', async () => {
  const sdk = new HermesClient({token:()=> 'synthetic',socket:{async connect(){throw new Error('unused');}},
    http:{async request(){return {status:200,body:{messages:[{id:'wrong',ref_seq:7,role:'assistant',text:'wrong'}],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};}}});
  await assert.rejects(sdk.history('thread',undefined,1,undefined,undefined,2),/reference mismatch/);
  assert.equal(sdk.messages.has('thread'),false);
});
