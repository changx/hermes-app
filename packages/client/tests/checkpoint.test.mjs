import test from 'node:test';
import assert from 'node:assert/strict';
import {HermesClient,ResyncRequired} from '../dist/index.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const make=(onCheckpoint)=>{
  const calls=[];
  const c=new HermesClient({token:()=> 'synthetic-only',onCheckpoint,http:{async request(_method,path){calls.push(path);
    if(path.startsWith('/v1/sync'))return {status:200,body:{events:[{event_id:1,cursor:'c1',kind:'message',thread_id:'a',ref:'1',version:1}],waterline:'c1',next_cursor:'c1',has_more:false}};
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],waterline:'c0',next_after:null}};
    if(path==='/v1/channels')return {status:200,body:{channels:[]}};
    return {status:200,body:{messages:[{id:'m1',ref_seq:1,role:'assistant',text:'synthetic'}],older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
  }},socket:{connect(){throw Error('unused')}}});c.cursor='c0';c.supportsLatest=true;
  return {c,calls};
};

test('checkpoint persistence gates acknowledgement but never hides ready message projections',async()=>{
  let release,saved;
  const {c}=make(async checkpoint=>{saved=structuredClone(checkpoint);await new Promise(resolve=>release=resolve)});
  const job=c.catchUp();await tick();assert.equal(c.messages.get('a').length,1);assert.equal(c.cursor,'c0');
  assert.equal(saved.cursor,'c1');assert.equal(saved.messages[0][1][0].id,'m1');
  release();await job;assert.equal(c.cursor,'c1');
  const restored=make().c;restored.cursor=null;restored.restoreCheckpoint(saved);assert.equal(restored.cursor,'c1');assert.equal(restored.messages.get('a').length,1);
});

test('disk failure cannot advance checkpoint; same page retries without duplicate data',async()=>{
  let fail=true,count=0;
  const {c}=make(async()=>{count++;if(fail)throw Error('synthetic disk failure')});
  await assert.rejects(c.catchUp(),/disk failure/);assert.equal(c.cursor,'c0');assert.equal(c.lastEventId,0);
  fail=false;await c.catchUp();assert.equal(c.cursor,'c1');assert.equal(c.messages.get('a').length,1);assert.equal(count,2);
});

test('snapshot cursor is not published until its projection is persisted',async()=>{
  let release,saved;
  const {c}=make(async checkpoint=>{saved=checkpoint;await new Promise(resolve=>release=resolve)});c.cursor=null;
  const job=c.snapshot();await tick();assert.equal(c.cursor,null);assert.equal(saved.cursor,'c0');
  release();await job;assert.equal(c.cursor,'c0');
});

test('malformed page cursor is rejected before reads, persistence or acknowledgement',async()=>{
  let checkpoints=0;
  const c=new HermesClient({token:()=> 'synthetic',onCheckpoint:async()=>checkpoints++,http:{async request(){return {status:200,body:{events:[{event_id:1,cursor:'c1',kind:'read',thread_id:'a',ref:'1',version:1}],next_cursor:'wrong',waterline:'c1',has_more:false}}}},socket:{connect(){throw Error('unused')}}});c.cursor='c0';
  await assert.rejects(c.catchUp(),ResyncRequired);assert.equal(checkpoints,0);assert.equal(c.cursor,'c0');
});

test('cold restored fetch sequence still accepts newer history, while older event versions require no entity reads',async()=>{
  let checkpoint;
  const first=make(async value=>checkpoint=structuredClone(value)).c;await first.catchUp();
  let requests=0;
  const next=new HermesClient({token:()=> 'synthetic',http:{async request(_method,path){requests++;if(path.includes('/messages'))return {status:200,body:{messages:[{id:'m1',ref_seq:1,role:'assistant',text:'new'}],older_cursor:null}};
    return {status:200,body:{events:[{event_id:1,cursor:'c1',kind:'message',thread_id:'a',ref:'1',version:1}],next_cursor:'c1',waterline:'c1',has_more:false}};
  }},socket:{connect(){throw Error('unused')}}});next.restoreCheckpoint(checkpoint);next.supportsLatest=true;
  await next.historyWindow('a');assert.equal(next.messages.get('a')[0].text,'new');await next.catchUp();assert.equal(requests,2);
});
