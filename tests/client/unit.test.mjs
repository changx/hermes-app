import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError, ResyncRequired } from '../../packages/client/dist/index.js';
const base = {http:{async request(){throw new Error('unplanned request')}},socket:{async connect(){throw new Error('unplanned socket')}},token:()=> 'synthetic-token'};
const receipt=(id='rc_1',state='queued')=>({id,client_message_id:'device-1',thread_id:'th_1',state,durable:true});
const event=(n,kind='receipt',ref='rc_1')=>({event_id:n,cursor:'c'+n,kind,thread_id:'th_1',ref,version:1});
test('same send ID/payload is retried; separate same-text IDs remain separate',async()=>{
  const calls=[]; const c=new HermesClient({...base,http:{async request(method,path,token,body){calls.push({method,path,token,body});return {status:202,body:{receipt:{...receipt('rc_'+body.client_message_id),client_message_id:body.client_message_id}}}}}});
  const a=await c.send('th_1','device-1','hello'); const b=await c.send('th_1','device-1','hello'); const d=await c.send('th_1','device-2','hello');
  assert.equal(a.id,b.id); assert.notEqual(a.id,d.id); assert.equal(calls.length,3); assert.deepEqual(calls[0].body,calls[1].body);
  await assert.rejects(c.send('th_1','bad id','hello'),ProtocolError);
});
test('receipt terminal and unknown states are preserved without automatic resend',async()=>{
  let post=0;const c=new HermesClient({...base,http:{async request(method){if(method==='POST')post++;return {status:200,body:{receipt:receipt('rc_1','unknown')}}}}});
  assert.equal((await c.getReceipt('rc_1')).state,'unknown'); assert.equal(post,0);
});
test('snapshot first waterline, pages, replay and event invalidations',async()=>{
  const paths=[];const summary=id=>({id,project_id:'p',title:id,archived:0,last_ref:0,read_ref:0,unread_count:0});
  const c=new HermesClient({...base,http:{async request(method,path){paths.push(path);
    if(path.startsWith('/v1/snapshot')) return {status:200,body:path.includes('after=')?{threads:[summary('th_2')],waterline:'later',next_after:null}:{threads:[summary('th_1')],waterline:'early',next_after:'page2'}};
    if(path==='/v1/channels') return {status:200,body:{channels:[{id:'p',name:'one'}]}};
    if(path.startsWith('/v1/sync')) return {status:200,body:{events:[event(8,'channel','p'),event(9,'thread','th_1')],waterline:'c9',next_cursor:'c9',has_more:false}};
    if(path==='/v1/threads/th_1') return {status:200,body:{thread:{id:'th_1',project_id:'p',title:'updated',archived:0}}};
    throw new Error(path);
  }}});
  await c.snapshot(); assert.equal(c.cursor,'early'); assert.equal(c.threads.size,2); await c.catchUp();
  assert.equal(c.cursor,'c9');assert.equal(c.threads.get('th_1').title,'updated'); assert.ok(paths.some(x=>x.includes('cursor=early')));
});
test('cursor 400 and gap demand explicit resync, retaining processed cursor',async()=>{
  const c=new HermesClient({...base,http:{async request(){return {status:400,body:'bad'}}}}); c.cursor='foreign';await assert.rejects(c.catchUp(),ResyncRequired);assert.equal(c.cursor,'foreign');
  const d=new HermesClient({...base,http:{async request(_method,path){return path.startsWith('/v1/sync') ? {status:200,body:{events:[event(2,'receipt','rc_1'),event(4,'receipt','rc_1')],waterline:'c4',next_cursor:'c4',has_more:false}} : {status:200,body:{receipt:receipt()}}}}}); d.cursor='c1';d.lastEventId=1;
  await assert.rejects(d.catchUp(),ResyncRequired);assert.equal(d.cursor,'c2');assert.equal(d.lastEventId,2);
});
test('older thread fetch cannot overwrite a newer event fetch',async()=>{
  let firstResolve;let calls=0;
  const c=new HermesClient({...base,http:{request(){calls++; if(calls===1)return new Promise(r=>firstResolve=r);return Promise.resolve({status:200,body:{thread:{id:'th_1',project_id:'p',title:'new',archived:0}}})}}});
  const old=c.getThread('th_1',1);await c.getThread('th_1',2);firstResolve({status:200,body:{thread:{id:'th_1',project_id:'p',title:'old',archived:0}}});await old;
  assert.equal(c.threads.get('th_1').title,'new');
});
test('history de-duplicates refs, read advances monotonically, invalid data fails',async()=>{
  let read=0;const c=new HermesClient({...base,http:{async request(method,path){
    if(path.endsWith('/read')) return {status:200,body:{ref_seq:++read===1?3:2,unread_count:0}};
    return {status:200,body:{messages:[{id:'1',ref_seq:1,role:'user',text:'one'}],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
  }}}); c.threads.set('th_1',{id:'th_1',project_id:'p',title:'t',archived:0,last_ref:3,read_ref:0,unread_count:2});
  await c.history('th_1');await c.history('th_1');assert.equal(c.messages.get('th_1').length,1);
  await c.markRead('th_1',3);await c.markRead('th_1',2);assert.equal(c.threads.get('th_1').read_ref,3);
  const bad=new HermesClient({...base,http:{async request(){return {status:200,body:{messages:'bad',next_cursor:null}}}}});await assert.rejects(bad.history('th_1'),ProtocolError);
});
test('socket event triggers durable replay; duplicate frames and close do not send or stop execution',async()=>{
  let emit,closeFrame,closed=0,connectPath,connectToken,posts=0,replays=0;
  let ready;const connected=new Promise(r=>ready=r);
  const c=new HermesClient({...base,http:{async request(method,path){if(method==='POST')posts++;
    if(path.startsWith('/v1/sync')) {replays++;return {status:200,body:{events:replays===1?[]:[event(1,'receipt','rc_1')],waterline:'c1',next_cursor:replays===1?'c0':'c1',has_more:false}}}
    if(path==='/v1/receipts/rc_1')return {status:200,body:{receipt:receipt()}};
    throw new Error(path);
  }},socket:{async connect(path,token){connectPath=path;connectToken=token;ready();return {onMessage(fn){emit=fn},onClose(fn){closeFrame=fn},close(){closed++}}}}});
  c.cursor='c0';await c.connect();await connected;await new Promise(r=>setTimeout(r,0));
  assert.equal(connectPath,'/v1/events?cursor=c0');assert.equal(connectToken,'synthetic-token');
  emit(JSON.stringify({type:'event',...event(1)}));emit(JSON.stringify({type:'event',...event(1)}));
  for(let i=0;i<20 && c.cursor!=='c1';i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(c.cursor,'c1');assert.equal(c.receipts.size,1);c.close();closeFrame();assert.ok(closed>=1);assert.equal(posts,0);
});
test('non-2xx send and unknown event fail visibly without cursor advancement',async()=>{
  const c=new HermesClient({...base,http:{async request(){return {status:409,body:'conflict'}}}});
  await assert.rejects(c.send('th_1','id-1','hello'),ProtocolError);
  const d=new HermesClient({...base,http:{async request(){return {status:200,body:{events:[event(1,'unsupported')],waterline:'c1',next_cursor:'c1',has_more:false}}}}});
  d.cursor='c0';await assert.rejects(d.catchUp(),ProtocolError);assert.equal(d.cursor,'c0');
});
test('late queued receipt response cannot replace completed state',async()=>{
  let resolveFirst,calls=0;
  const c=new HermesClient({...base,http:{request(){calls++;return calls===1?new Promise(r=>resolveFirst=r):Promise.resolve({status:200,body:{receipt:receipt('rc_1','completed')}})}}});
  const first=c.getReceipt('rc_1');await c.getReceipt('rc_1');resolveFirst({status:200,body:{receipt:receipt('rc_1','queued')}});await first;
  assert.equal(c.receipts.get('rc_1').state,'completed');
});
