import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, HttpError, ProtocolError, ResyncRequired, TimeoutError, isRetryableError } from '../../packages/client/dist/index.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await pause(5)}assert.fail('condition timed out')};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise}};
const caps={status:200,body:{protocol:1,durable_sync:true,history_latest:true,message_send_identity:true}};
const snap={status:200,body:{threads:[],waterline:'c0',next_after:null}};
const empty={status:200,body:{events:[],waterline:'c0',next_cursor:'c0',has_more:false}};
const hello=JSON.stringify({type:'hello',protocol:1,durable_sync:true});
const socket=(notify=true)=>{let message,close;const item={onMessage(fn){message=fn;if(notify)queueMicrotask(()=>fn(hello))},onClose(fn){close=fn},close(){item.closes++;},send(data){item.sent.push(data)},closes:0,sent:[],emit(data){message?.(data)},drop(){close?.()}};return item};
const fixture=(http,sockets,extra={})=>new HermesClient({http:{request:async(method,path,token,body,signal)=>{
  if(path==='/v1/capabilities')return caps;
  if(path.startsWith('/v1/snapshot'))return snap;
  if(path==='/v1/channels')return {status:200,body:{channels:[]}};
  return http(method,path,token,body,signal);
}},socket:{connect:async()=>{const s=socket();sockets.push(s);return s}},token:()=> 'owner-token',backoffMs:[5,10],requestTimeoutMs:45,connectTimeoutMs:45,...extra});

test('initial capabilities failure remains inside single-flight recovery, online waits for hello and durable replay',async()=>{
  let capsCalls=0,syncCalls=0,opened=0;const states=[];const gate=deferred();
  const c=new HermesClient({http:{request:async(_method,path)=>{
    if(path==='/v1/capabilities')return ++capsCalls===1?{status:503,body:{}}:caps;
    if(path.startsWith('/v1/snapshot'))return snap;
    if(path==='/v1/channels')return {status:200,body:{channels:[]}};
    if(path.startsWith('/v1/sync')){syncCalls++;return syncCalls===2?gate.promise:empty}
    throw Error(path);
  }},socket:{async connect(){opened++;return socket()}},token:()=> 'owner',backoffMs:[5],requestTimeoutMs:100,connectTimeoutMs:100,onConnectionState:s=>states.push(s)});
  await Promise.all([c.connect(),c.connect(),c.connect()]);
  try {
    await until(()=>opened===1);
    assert.notEqual(c.connectionState,'online');
    gate.resolve(empty);await until(()=>c.connectionState==='online');
    assert.equal(capsCalls,2);assert.equal(opened,1);
    assert.ok(states.includes('retrying'));assert.ok(states.includes('syncing'));
  } finally {c.close()}
});

test('a frame arriving during hello replay cannot mark online before both durable passes finish',async()=>{
  let syncs=0;const gate=deferred(),sockets=[];
  const c=fixture((_m,p)=>{if(p.startsWith('/v1/sync'))return ++syncs===2?gate.promise:empty;throw Error(p)},sockets,{socket:{async connect(){const s=socket(false);sockets.push(s);return s}}});
  c.cursor='c0';await c.connect();
  try {
    await until(()=>sockets.length===1);
    sockets[0].emit(hello);
    await until(()=>syncs===2);
    sockets[0].emit(JSON.stringify({type:'event',event_id:1,cursor:'c1',kind:'receipt',thread_id:'th',ref:'r1',version:1}));
    assert.equal(c.connectionState,'syncing');gate.resolve(empty);
    await until(()=>syncs>=3);await until(()=>c.connectionState==='online');
  }finally{c.close()}
});

test('idle durable replay repairs a lost receipt frame; missing pong rotates half-open socket',async()=>{
  let syncs=0;const sockets=[];
  const c=fixture((_method,path)=>{
    if(path.startsWith('/v1/sync')) {
      syncs++;
      if(syncs===3)return {status:200,body:{events:[{event_id:1,cursor:'c1',kind:'receipt',thread_id:'th',ref:'r1',version:1}],waterline:'c1',next_cursor:'c1',has_more:false}};
      return {status:200,body:{events:[],waterline:'c1',next_cursor:syncs>=3?'c1':'c0',has_more:false}};
    }
    if(path==='/v1/receipts/r1')return {status:200,body:{receipt:{id:'r1',client_message_id:'original',thread_id:'th',state:'completed',durable:true}}};
    throw Error(path);
  },sockets,{livenessMs:20});
  await c.connect();
  try {
    await until(()=>c.connectionState==='online');
    await until(()=>c.receipts.get('r1')?.state==='completed');
    assert.equal(c.cursor,'c1');assert.equal(sockets[0].sent[0],'ping');
    await until(()=>sockets.length>=2);
    assert.ok(sockets[0].closes>=1);
    assert.equal(c.receipts.get('r1').client_message_id,'original');
  } finally {c.close()}
});

test('rapid close/resume ignores old callbacks and never marks online before new hello',async()=>{
  const sockets=[];const c=fixture((_m,p)=>p.startsWith('/v1/sync')?empty:Promise.reject(Error(p)),sockets,{socket:{async connect(){const s=socket(false);sockets.push(s);return s}},backoffMs:[5]});
  c.cursor='c0';await c.connect();await until(()=>sockets.length===1);
  assert.notEqual(c.connectionState,'online');sockets[0].emit(hello);await until(()=>c.connectionState==='online');
  c.close();await c.connect();await until(()=>sockets.length===2);
  sockets[0].emit('{bad');sockets[0].drop();await tick();
  assert.notEqual(c.connectionState,'online');sockets[1].emit(hello);await until(()=>c.connectionState==='online');c.close();
});

test('socket close aborts replay; late HTTP and receipt callbacks cannot mutate a successor',async()=>{
  const sockets=[],oldSync=deferred(),oldReceipt=deferred();let syncs=0,receiptCalls=0;
  const event={event_id:1,cursor:'c1',kind:'receipt',thread_id:'th',ref:'r1',version:1};
  const page={status:200,body:{events:[event],waterline:'c1',next_cursor:'c1',has_more:false}};
  const c=fixture((_m,p)=>{
    if(p.startsWith('/v1/sync'))return ++syncs===2?oldSync.promise:[4,5].includes(syncs)?page:empty;
    if(p==='/v1/receipts/r1')return ++receiptCalls===1?oldReceipt.promise:{status:200,body:{receipt:{id:'r1',client_message_id:'current',thread_id:'th',state:'completed',durable:true}}};
    throw Error(p);
  },sockets,{requestTimeoutMs:200});
  c.cursor='c0';await c.connect();
  try {
    await until(()=>sockets.length===1);await until(()=>syncs===2);
    sockets[0].drop();await until(()=>sockets.length===2);
    await until(()=>receiptCalls===1);
    sockets[1].drop();await until(()=>sockets.length===3);
    await until(()=>c.receipts.get('r1')?.state==='completed');
    oldSync.resolve(page);
    oldReceipt.resolve({status:200,body:{receipt:{id:'r1',client_message_id:'stale',thread_id:'th',state:'queued',durable:true}}});
    await tick();
    assert.equal(c.receipts.get('r1').client_message_id,'current');
    assert.equal(c.cursor,'c1');assert.equal(c.lastEventId,1);
  } finally {c.close()}
});

test('burst frames and periodic liveness coalesce into one in-flight plus one dirty replay',async()=>{
  let syncs=0;const first=deferred(),second=deferred(),sockets=[];
  const c=fixture((_m,p)=>{
    if(p.startsWith('/v1/sync'))return ++syncs===2?first.promise:syncs===3?second.promise:empty;
    throw Error(p);
  },sockets,{livenessMs:15,requestTimeoutMs:200});
  c.cursor='c0';await c.connect();
  try {
    await until(()=>syncs===2);
    const frame=JSON.stringify({type:'event',event_id:1,cursor:'c1',kind:'receipt',thread_id:'th',ref:'r1',version:1});
    for(let i=0;i<500;i++)sockets[0].emit(frame);
    await pause(30);assert.equal(syncs,2);assert.equal(c.connectionState,'syncing');
    first.resolve(empty);await until(()=>syncs===3);
    for(let i=0;i<500;i++)sockets[0].emit(frame);
    assert.equal(syncs,3);
    second.resolve(empty);await until(()=>c.connectionState==='online');
    assert.equal(syncs,4);assert.deepEqual(sockets[0].sent,['ping']);
  }finally{c.close()}
});

test('HTTP, WS opening and hello timeouts are bounded even with abort-insensitive adapters',async()=>{
  let attempts=0,lateClosed=0;const late=deferred(),sockets=[];
  const c=fixture((_m,p)=>p.startsWith('/v1/sync')?empty:Promise.reject(Error(p)),sockets,{connectTimeoutMs:15,backoffMs:[5],socket:{connect:async()=>{attempts++;if(attempts===1)return late.promise;const s=socket(false);sockets.push(s);return s}}});
  c.cursor='c0';await c.connect();
  try {
    await until(()=>attempts>=2);
    late.resolve({onMessage(){},onClose(){},close(){lateClosed++}});await until(()=>lateClosed===1);
    await until(()=>attempts>=3);assert.notEqual(c.connectionState,'online');
    sockets.at(-1).emit(hello);await until(()=>c.connectionState==='online');
  } finally {c.close()}
  let count=0;const lateHttp=deferred();const d=fixture((_m,p)=>{
    if(p.startsWith('/v1/sync'))return ++count===1?lateHttp.promise:empty;
    throw Error(p)
  },[],{requestTimeoutMs:15});d.cursor='c0';await d.connect();
  try {await until(()=>count>=2);lateHttp.resolve({status:200,body:{events:[{event_id:1,cursor:'c1',kind:'receipt',thread_id:'th',ref:'r1',version:1}],waterline:'c1',next_cursor:'c1',has_more:false}});await tick();assert.equal(d.cursor,'c0')} finally {d.close()}
});

test('401/403 block; 429 Retry-After and 5xx retry; arbitrary writes never auto-retry',async()=>{
  for(const status of [401,403]) {
    let attempts=0;const c=fixture(()=>{attempts++;return {status,body:{}}},[]);
    c.cursor='c0';await c.connect();try {await until(()=>c.connectionState==='blocked');await pause(30);assert.equal(attempts,1)}finally{c.close()}
  }
  let attempts=0;const times=[],sockets=[];
  const c=fixture((_m,p)=>{if(p.startsWith('/v1/sync')){times.push(Date.now());return ++attempts===1?{status:429,body:{},retryAfterMs:65}:attempts===2?{status:503,body:{}}:empty}throw Error(p)},sockets,{backoffMs:[1]});
  c.cursor='c0';await c.connect();try {await until(()=>sockets.length>0);assert.ok(times[1]-times[0]>=58);assert.ok(attempts>=3)}finally{c.close()}
  let writes=0;const d=fixture((m)=>{if(m==='POST'){writes++;return {status:503,body:{}}}return empty},[]);
  await assert.rejects(d.send('th','same-id','original'),e=>e instanceof HttpError && e.status===503);
  assert.equal(writes,1);
  assert.equal(isRetryableError(new HttpError(429,20)),true);
  assert.equal(isRetryableError(new HttpError(401)),false);
  assert.equal(isRetryableError(new ProtocolError('bad')),false);
  assert.equal(isRetryableError(new TimeoutError('slow')),true);
});

test('only explicitly identified expired sync cursor auto-resyncs; 400/foreign/future never reset',async()=>{
  for(const reply of [{status:400,body:'invalid sync cursor'},{status:410,body:{code:'other'}}]){
    let snapshots=0;const c=fixture((_m,p)=>{if(p.startsWith('/v1/sync'))return reply;throw Error(p)},[],{http:{request:async(_m,p)=>{if(p==='/v1/capabilities')return caps;if(p.startsWith('/v1/snapshot')){snapshots++;return snap}return p.startsWith('/v1/sync')?reply:{status:200,body:{channels:[]}}}}});
    c.cursor='foreign';await c.connect();try {await until(()=>c.connectionState==='suspended');assert.equal(c.cursor,'foreign');assert.equal(snapshots,0)}finally{c.close()}
  }
  let syncs=0;const sockets=[];const c=fixture((_m,p)=>{if(p.startsWith('/v1/sync'))return ++syncs===1?{status:410,body:{code:'cursor_expired'}}:empty;throw Error(p)},sockets);
  c.cursor='expired';c.messages.set('th',[{id:'old',ref_seq:1,role:'user',text:'old'}]);await c.connect();
  try {await until(()=>c.connectionState==='online');assert.equal(c.cursor,'c0');assert.equal(c.messages.size,0);assert.equal(sockets.length,1)}finally{c.close()}
  const x=fixture(()=>({status:400,body:'invalid sync cursor'}),[]);x.cursor='foreign';await assert.rejects(x.catchUp(),ResyncRequired);assert.equal(x.cursor,'foreign');
});

test('recognized expiry during live replay resyncs even after bootstrap recovery',async()=>{
  const sockets=[];let snapshots=0,syncs=0;
  const expiry={status:410,body:{code:'cursor_expired'}};
  const c=fixture(()=>{throw Error('unreachable')},sockets,{http:{request:async(_m,p)=>{
    if(p==='/v1/capabilities')return caps;
    if(p.startsWith('/v1/snapshot')){snapshots++;return snap}
    if(p==='/v1/channels')return {status:200,body:{channels:[]}};
    if(p.startsWith('/v1/sync'))return [1,4].includes(++syncs)?expiry:empty;
    throw Error(p);
  }}});
  c.cursor='expired';c.receipts.set('obsolete',{id:'obsolete',client_message_id:'old',thread_id:'th',state:'queued',durable:true});
  await c.connect();
  try {
    await until(()=>sockets.length===1);await until(()=>c.connectionState==='online');
    sockets[0].emit(JSON.stringify({type:'event',event_id:1,cursor:'ignored',kind:'receipt',thread_id:'th',ref:'r1',version:1}));
    await until(()=>sockets.length===2);await until(()=>c.connectionState==='online');
    assert.equal(snapshots,2);assert.equal(c.receipts.size,0);assert.equal(c.cursor,'c0');
  }finally{c.close()}
});

test('a confirmed pong rearms recovery for a later genuine expiry',async()=>{
  const sockets=[];let syncs=0,snapshots=0;
  const expired={status:410,body:{code:'cursor_expired'}};
  const c=fixture(()=>{throw Error('unreachable')},sockets,{livenessMs:15,http:{request:async(_m,p)=>{
    if(p==='/v1/capabilities')return caps;
    if(p.startsWith('/v1/snapshot')){snapshots++;return snap}
    if(p==='/v1/channels')return {status:200,body:{channels:[]}};
    if(p.startsWith('/v1/sync'))return [1,5].includes(++syncs)?expired:empty;
    throw Error(p);
  }}});
  c.cursor='c0';await c.connect();try {
    await until(()=>sockets.length===1);await until(()=>c.connectionState==='online');
    await until(()=>sockets[0].sent.length===1);sockets[0].emit('pong');
    sockets[0].emit(JSON.stringify({type:'event',event_id:1,cursor:'ignored',kind:'receipt',thread_id:'th',ref:'r1',version:1}));
    await until(()=>sockets.length===2);await until(()=>c.connectionState==='online');
    assert.equal(snapshots,2);assert.equal(syncs,7);
  }finally{c.close()}
});

test('repeated bad expiry stops resetting; 400 during live still refuses to rewind',async()=>{
  let snapshots=0,syncs=0;const sockets=[];
  const expiry={status:410,body:{code:'cursor_expired'}};
  const c=fixture(()=>expiry,sockets,{http:{request:async(_m,p)=>{
    if(p==='/v1/capabilities')return caps;
    if(p.startsWith('/v1/snapshot')){snapshots++;return snap}
    if(p==='/v1/channels')return {status:200,body:{channels:[]}};
    if(p.startsWith('/v1/sync')){syncs++;return expiry}
    throw Error(p);
  }}});
  c.cursor='old';await c.connect();try {await until(()=>c.connectionState==='suspended');assert.equal(snapshots,2);assert.equal(syncs,3);assert.equal(sockets.length,0)}finally{c.close()}

  let resets=0,requests=0;const liveSockets=[];const live=fixture(()=>{throw Error('unreachable')},liveSockets,{http:{request:async(_m,p)=>{
    if(p==='/v1/capabilities')return caps;
    if(p.startsWith('/v1/snapshot')){resets++;return snap}
    if(p.startsWith('/v1/sync'))return ++requests===3?{status:400,body:{code:'invalid_cursor'}}:empty;
    throw Error(p);
  }}});
  live.cursor='c0';await live.connect();try {
    await until(()=>live.connectionState==='online');
    liveSockets[0].emit(JSON.stringify({type:'event',event_id:1,cursor:'ignored',kind:'receipt',thread_id:'th',ref:'r1',version:1}));
    await until(()=>live.connectionState==='suspended');
    assert.equal(resets,0);assert.equal(requests,3);assert.equal(live.cursor,'c0');
  }finally{live.close()}
});

test('idle durable replay repairs a missed message into latest history with exact send identity',async()=>{
  let syncs=0,history=0;const sockets=[];
  const c=fixture((_method,path)=>{
    if(path.startsWith('/v1/sync'))return ++syncs===3 ? {status:200,body:{events:[{event_id:1,cursor:'c1',kind:'message',thread_id:'th',ref:'msg-1',version:1}],waterline:'c1',next_cursor:'c1',has_more:false}} : {status:200,body:{events:[],waterline:'c1',next_cursor:syncs>=3?'c1':'c0',has_more:false}};
    if(path.includes('/messages')){history++;return {status:200,body:{messages:[{id:'msg-1',ref_seq:47,role:'user',text:'same text',receipt_id:'r1',client_message_id:'original'}],older_cursor:null}}}
    throw Error(path);
  },sockets,{livenessMs:20});
  c.cursor='c0';await c.connect();
  try {await until(()=>c.messages.get('th')?.length===1 && c.cursor==='c1');assert.equal(history,1);assert.equal(c.messages.get('th')[0].client_message_id,'original')}finally{c.close()}
});

test('fifth send argument aborts the same-ID request without automatic resubmission',async()=>{
  let writes=0;const gate=deferred();const c=fixture((method)=>{if(method==='POST'){writes++;return gate.promise}throw Error('unexpected')},[],{requestTimeoutMs:30});
  const controller=new AbortController();const pending=c.send('th','same-id','text',[],controller.signal);
  await until(()=>writes===1);controller.abort();await assert.rejects(pending,/aborted/);
  gate.resolve({status:202,body:{receipt:{id:'r1',client_message_id:'same-id',thread_id:'th',state:'queued',durable:true}}});await tick();
  assert.equal(writes,1);assert.equal(c.receipts.size,0);
});

test('resync clears stale receipts and sequence fences while preserving receipt identity',async()=>{
  const staleThread=deferred(),staleReceipt=deferred();let threadCalls=0,receiptCalls=0,conflict=false;
  const summary={id:'th',project_id:'p',title:'snapshot',archived:0,last_ref:0,read_ref:0,unread_count:0};
  const fresh={id:'r1',client_message_id:'original',thread_id:'th',state:'running',durable:true};
  const c=fixture(()=>{throw Error('unreachable')},[],{http:{request:async(_m,p)=>{
    if(p.startsWith('/v1/snapshot'))return {status:200,body:{threads:[{...summary,active_receipts:[fresh]}],waterline:'c0',next_after:null}};
    if(p==='/v1/channels')return {status:200,body:{channels:[]}};
    if(p.startsWith('/v1/sync'))return empty;
    if(p==='/v1/threads/th')return ++threadCalls===1?staleThread.promise:{status:200,body:{thread:{id:'th',project_id:'p',title:'fresh',archived:0}}};
    if(p==='/v1/receipts/r1')return ++receiptCalls===1?staleReceipt.promise:{status:200,body:{receipt:{...fresh,client_message_id:conflict?'forged':'original',state:'completed'}}};
    throw Error(p);
  }}});
  c.cursor='c0';c.receipts.set('obsolete',{id:'obsolete',client_message_id:'old',thread_id:'th',state:'queued',durable:true});
  const oldThread=c.getThread('th');const oldReceipt=c.getReceipt('r1');await until(()=>threadCalls===1&&receiptCalls===1);
  await c.resync();assert.equal(c.receipts.has('obsolete'),false);
  await c.getThread('th');await c.getReceipt('r1');
  staleThread.resolve({status:200,body:{thread:{id:'th',project_id:'p',title:'stale',archived:0}}});
  staleReceipt.resolve({status:200,body:{receipt:{...fresh,state:'queued'}}});
  await Promise.all([oldThread,oldReceipt]);
  assert.equal(c.threads.get('th').title,'fresh');assert.equal(c.receipts.get('r1').state,'completed');
  conflict=true;await c.resync();
  await assert.rejects(c.getReceipt('r1'),e=>e instanceof ProtocolError && /identity/.test(e.message));
  assert.equal(c.receipts.get('r1').client_message_id,'original');
});

test('credential changes cannot reuse cached identity or reconnect under a new bearer',async()=>{
  let token='owner-a',calls=0,opened=0;const states=[];
  const c=new HermesClient({http:{request:async(_m,path,bearer)=>{calls++;assert.equal(bearer,'owner-a');if(path==='/v1/capabilities')return caps;if(path.startsWith('/v1/sync'))return empty;throw Error(path)}},socket:{async connect(){opened++;return socket()}},token:()=>token,backoffMs:[5],onConnectionState:s=>states.push(s)});
  c.cursor='c0';c.messages.set('th',[{id:'owner-a-row',ref_seq:1,role:'user',text:'private'}]);
  await c.connect();await until(()=>c.connectionState==='online');c.close();
  token='owner-b';await c.connect();
  try {await until(()=>c.connectionState==='blocked');assert.equal(opened,1);assert.equal(c.messages.get('th')[0].id,'owner-a-row');assert.ok(states.includes('blocked'));await assert.rejects(c.getReceipt('r1'),/credential changed/)}finally{c.close()}
  assert.ok(calls>=2);
});
