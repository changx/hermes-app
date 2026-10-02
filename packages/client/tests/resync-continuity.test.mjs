import test from 'node:test';
import assert from 'node:assert/strict';
import {HermesClient,HttpError} from '../dist/index.js';
const tick=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
const summary=(id='a')=>({id,project_id:'p',title:id,archived:0,last_ref:3,read_ref:2,unread_count:1});
const rows=[{id:'m1',ref_seq:1,role:'assistant',text:'edited older body',attachments:[]},{id:'m2',ref_seq:3,role:'assistant',text:'newer body',attachments:[]}];
const page=()=>({status:200,body:{messages:rows,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}});
function fixture({historyGate,failHistory=false,failDisk=false,onResync}={}){
  const notices=[],saved=[];let c;
  c=new HermesClient({token:()=> 'synthetic',onChange:()=>notices.push(c.messages.get('a')?.map(m=>m.text)),onResync,onCheckpoint:async value=>{if(failDisk)throw Error('disk failed');saved.push(structuredClone(value))},http:{async request(_m,path){
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[summary()],waterline:'fresh',next_after:null}};
    if(path==='/v1/channels')return {status:200,body:{channels:[{id:'p',name:'P'}]}};
    if(path.startsWith('/v1/sync'))return {status:200,body:{events:[],waterline:'fresh',next_cursor:'fresh',has_more:false}};
    if(path.includes('/messages')){if(historyGate)await historyGate.promise;if(failHistory)return {status:503,body:{}};return page()}
    throw Error(path);
  }},socket:{connect(){throw Error('unused')}}});
  c.cursor='old';c.lastEventId=7;c.channels.set('p',{id:'p',name:'P'});c.threads.set('a',summary());c.messages.set('a',[{...rows[0],text:'still readable'}]);
  return {c,notices,saved};
}

test('resync stages a complete refreshed cached interval, never publishing an empty intermediate view',async()=>{
  const pending=gate();let reset=0;const {c,notices,saved}=fixture({historyGate:pending,onResync:()=>reset++});
  const job=c.resync();await tick();assert.equal(c.cursor,'old');assert.equal(c.messages.get('a')[0].text,'still readable');assert.equal(notices.length,0);assert.equal(saved.length,0);
  pending.resolve();await job;assert.equal(c.cursor,'fresh');assert.deepEqual(c.messages.get('a'),rows);
  assert.equal(notices.length,1);assert.equal(reset,1);assert.equal(saved.length,1);assert.equal(saved[0].cursor,'fresh');
});

test('history or persistence failure retains old projection and cursor rather than clearing the timeline',async()=>{
  for(const options of [{failHistory:true},{failDisk:true}]){
    const {c,notices,saved}=fixture(options);await assert.rejects(c.resync());
    assert.equal(c.cursor,'old');assert.equal(c.lastEventId,7);assert.equal(c.messages.get('a')[0].text,'still readable');assert.equal(notices.length,0);assert.equal(saved.length,0);
  }
});

test('aborted resync cannot publish or persist a replacement',async()=>{
  const pending=gate(),controller=new AbortController();const {c,notices,saved}=fixture({historyGate:pending});
  const job=c.resync(controller.signal);await tick();controller.abort();await assert.rejects(job,/aborted/);pending.resolve();await tick();
  assert.equal(c.cursor,'old');assert.equal(notices.length,0);assert.equal(saved.length,0);
});

test('newer resync owner wins; a slow superseded build cannot overwrite it',async()=>{
  const first=gate();let histories=0;const {c,notices}=fixture();
  const request=c.options.http.request;c.options.http.request=async(m,path,...args)=>{if(path.includes('/messages')&&++histories===1)await first.promise;return request(m,path,...args)};
  const old=c.resync();await tick();await c.resync();first.resolve();await assert.rejects(old,/aborted/);
  assert.equal(c.cursor,'fresh');assert.equal(notices.length,1);
});

test('late read acknowledgement, attachment and approval reads cannot mutate a replacement projection',async()=>{
  const pending=gate();const {c}=fixture();const request=c.options.http.request;
  c.options.http.request=async(m,path,...args)=>{
    if(path.endsWith('/read')){await pending.promise;return {status:200,body:{ref_seq:99,unread_count:0}}}
    if(path.includes('/metadata')){await pending.promise;return {status:200,body:{attachment:{id:'att_old',thread_id:'a',state:'deleted'}}}}
    if(path.includes('/interactions/')){await pending.promise;return {status:200,body:{interaction:{id:'old',thread_id:'a',receipt_id:'r',generation:'g',kind:'approval',state:'pending',prompt:'old',choices:['yes']}}}}
    return request(m,path,...args);
  };
  const read=c.markRead('a',99),attachment=c.getAttachment('a','att_old'),approval=c.getInteraction('a','old');await tick();await c.resync();pending.resolve();await Promise.all([read,attachment,approval]);
  assert.equal(c.threads.get('a').read_ref,2);assert.equal(c.attachments.has('att_old'),false);assert.equal(c.interactions.has('old'),false);
});
