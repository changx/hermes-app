import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, HttpError, ResyncRequired } from '../dist/index.js';

const summary = id => ({id,project_id:'p',title:id,archived:0,last_ref:20,read_ref:0,unread_count:20});
const message = n => ({id:'m'+n,ref_seq:n,role:'assistant',text:'synthetic '+n});
const event = (n,thread='a',kind='message',ref=String(n),version=1) => ({event_id:n,cursor:'c'+n,kind,thread_id:thread,ref,version});
const page = messages => ({status:200,body:{messages,older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const fixture = (events, handle, onChange) => {
  const paths=[];
  const c=new HermesClient({token:()=> 'synthetic-token',onChange,http:{async request(_method,path){
    paths.push(path);
    if(path.startsWith('/v1/sync'))return {status:200,body:{events,waterline:events.at(-1)?.cursor??'c0',next_cursor:events.at(-1)?.cursor??'c0',has_more:false}};
    return handle(path);
  }},socket:{connect(){throw Error('unused')}}});
  c.cursor='c0';c.supportsLatest=true;
  return {c,paths};
};

test('20 message invalidations fetch one tail and one summary page, publishing two batches not 2020 notifications',async()=>{
  let changes=0;
  const {c,paths}=fixture(Array.from({length:20},(_,i)=>event(i+1)),path=>path.startsWith('/v1/snapshot')
    ? {status:200,body:{threads:Array.from({length:100},(_,i)=>summary('t'+i)),next_after:null}}
    : page(Array.from({length:20},(_,i)=>message(i+1))),()=>changes++);
  await c.catchUp();
  assert.equal(paths.length,3);
  assert.equal(paths.filter(p=>p.includes('/messages')).length,1);
  assert.equal(paths.filter(p=>p.startsWith('/v1/snapshot')).length,1);
  assert.equal(changes,2);
  assert.equal(c.cursor,'c20');assert.equal(c.messages.get('a').length,20);
});

test('slow session never blocks another session projection or sidebar; checkpoint waits for all owners',async()=>{
  const gate=deferred();
  const {c}=fixture([event(1,'slow'),event(2,'fast')],async path=>{
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[summary('slow'),summary('fast')],next_after:null}};
    if(path.includes('/slow/'))await gate.promise;
    return page([message(1)]);
  });
  const job=c.catchUp();await tick();
  assert.equal(c.messages.get('fast').length,1);
  assert.equal(c.threads.size,2);
  assert.equal(c.messages.has('slow'),false);
  assert.equal(c.cursor,'c0');
  gate.resolve();await job;assert.equal(c.cursor,'c2');
});

test('a failed owner leaves checkpoint unacknowledged; retry merges identities without duplicate messages',async()=>{
  let fail=true;
  const {c}=fixture([event(1,'a'),event(2,'b')],path=>{
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null}};
    if(path.includes('/b/')&&fail)return {status:503,body:{}};
    return page([message(1)]);
  });
  await assert.rejects(c.catchUp(),HttpError);assert.equal(c.cursor,'c0');assert.equal(c.lastEventId,0);
  assert.equal(c.messages.get('a').length,1);
  fail=false;await c.catchUp();assert.equal(c.cursor,'c2');assert.equal(c.messages.get('a').length,1);
});

test('multiple versions of an older exact ref hydrate it once; distinct edited refs are all preserved',async()=>{
  const {c,paths}=fixture([event(1,'a','message','1',2),event(2,'a','message','1',3),event(3,'a','message','2',2)],path=>{
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null}};
    const ref=new URL('https://synthetic.test'+path).searchParams.get('ref_seq');
    return page(ref?[{...message(Number(ref)),text:'edited '+ref}]:[]);
  });
  c.messages.set('a',[message(1),message(2),message(100)]);
  await c.catchUp();
  assert.equal(paths.filter(p=>p.includes('ref_seq=1&')).length,1);
  assert.equal(paths.filter(p=>p.includes('ref_seq=2&')).length,1);
  assert.deepEqual(c.messages.get('a').map(m=>m.text),['edited 1','edited 2','synthetic 100']);
});

test('receipt versions coalesce by identity, not text, and message/read events share one summary refresh',async()=>{
  const {c,paths}=fixture([event(1,'a','receipt','r',1),event(2,'a','receipt','r',2),event(3,'a'),event(4,'a','read','4')],path=>{
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null}};
    if(path.startsWith('/v1/receipts'))return {status:200,body:{receipt:{id:'r',client_message_id:'send',thread_id:'a',state:'completed',version:2,durable:true}}};
    return page([message(1)]);
  });
  await c.catchUp();assert.equal(paths.filter(p=>p.startsWith('/v1/receipts')).length,1);
  assert.equal(paths.filter(p=>p.startsWith('/v1/snapshot')).length,1);assert.equal(c.receipts.get('r').state,'completed');
});

test('abort leaves page checkpoint untouched even after another session published',async()=>{
  const gate=deferred(),controller=new AbortController();
  const {c}=fixture([event(1,'a'),event(2,'b')],async path=>{
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null}};
    if(path.includes('/b/'))await gate.promise;
    return page([message(1)]);
  });
  const job=c.catchUp(controller.signal);await tick();assert.equal(c.messages.get('a').length,1);
  controller.abort();await assert.rejects(job,/aborted/);gate.resolve();await tick();
  assert.equal(c.cursor,'c0');assert.equal(c.messages.has('b'),false);
});

test('gap hydrates and acknowledges only the valid prefix, never the event beyond it',async()=>{
  const {c,paths}=fixture([event(2,'a'),event(4,'b')],path=>path.startsWith('/v1/snapshot')?{status:200,body:{threads:[],next_after:null}}:page([message(1)]));
  c.lastEventId=1;c.cursor='c1';
  await assert.rejects(c.catchUp(),ResyncRequired);assert.equal(c.cursor,'c2');
  assert.equal(paths.some(p=>p.includes('/b/')),false);
});
