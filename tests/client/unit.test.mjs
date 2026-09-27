import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError, ResyncRequired } from '../../packages/client/dist/index.js';
import {desktopTransport} from './desktop/transport.mjs';
import {mobileTransport} from './mobile/transport.js';
const base = {http:{async request(){throw new Error('unplanned request')}},socket:{async connect(){throw new Error('unplanned socket')}},token:()=> 'synthetic-token'};
const receipt=(id='rc_1',state='queued')=>({id,client_message_id:'device-1',thread_id:'th_1',state,durable:true});
const event=(n,kind='receipt',ref='rc_1')=>({event_id:n,cursor:'c'+n,kind,thread_id:'th_1',ref,version:1});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const emptySync={status:200,body:{events:[],waterline:'c0',next_cursor:'c0',has_more:false}};
test('newest window preserves sparse refs, cursor direction and authoritative send IDs',async()=>{
  const paths=[];
  const c=new HermesClient({...base,http:{async request(_method,path){
    paths.push(path);
    if(path==='/v1/capabilities') return {status:200,body:{protocol:1,durable_sync:true,history_latest:true,message_send_identity:true}};
    const older=path.includes('before=');
    return {status:200,body:{messages:older?[{id:'old',ref_seq:3,role:'user',text:'same',receipt_id:'r0',client_message_id:'zero'}]:[{id:'new',ref_seq:901,role:'user',text:'same',receipt_id:'r1',client_message_id:'one'}],older_cursor:older?null:'back:901'}};
  }}});
  await c.capabilities(); assert.ok(c.supportsLatest); assert.ok(c.supportsSendIdentity);
  const first=await c.historyWindow('t');
  assert.equal(first.older_cursor,'back:901'); assert.equal(first.messages[0].client_message_id,'one');
  await c.historyWindow('t',first.older_cursor);
  assert.deepEqual(c.messages.get('t').map(m=>m.ref_seq),[3,901]);
  assert.match(paths[1],/latest=true/); assert.match(paths[2],/before=back%3A901/);
  assert.doesNotMatch(paths[2],/latest=/);
});
test('tool display survives history replay, tail updates and cold reload with stable identity', async () => {
  const calls = [{ id: 'c1', name: 'terminal', label: '运行命令', detail: 'git status', arguments: { secret: 'NOT-DISPLAYED' }, result: 'RAW-RESULT' }];
  const messages = [
    { id: '1', ref_seq: 1, role: 'assistant', text: '先检查', tool_calls: calls },
    { id: '2', ref_seq: 2, role: 'assistant', text: '', tool_calls: [{ id: 'c2', name: 'read_file', label: '读取 README.md' }] },
    { id: '3', ref_seq: 3, role: 'assistant', text: '完成' }
  ];
  let count = 1;
  const http = { async request(_method, path) {
    const after = path.includes('after_ref_seq=1');
    return { status: 200, body: { messages: after ? messages.slice(1) : messages.slice(0, count), next_cursor: null, incomplete_turns: [], turn_outcomes: [] } };
  } };
  const client = new HermesClient({ ...base, http });
  await client.history('th_1'); await client.history('th_1');
  assert.equal(client.messages.get('th_1').length, 1);
  await client.historyTail('th_1');
  count = 3;
  await client.history('th_1');
  const all = client.messages.get('th_1');
  assert.deepEqual(all.map(m => m.ref_seq), [1, 2, 3]);
  assert.equal(all[1].text, '');
  assert.deepEqual(all[0].tool_calls, [{ id: 'c1', name: 'terminal', label: '运行命令', detail: 'git status' }]);
  assert.doesNotMatch(JSON.stringify(all), /NOT-DISPLAYED|RAW-RESULT|arguments/);
  const cold = new HermesClient({ ...base, http }); await cold.history('th_1');
  assert.deepEqual(cold.messages.get('th_1'), all);
});

test('tool display is bounded, validated and unavailable on user messages', async () => {
  const good = { id: 'x', name: 'terminal', label: '运行命令' };
  for (const tool_calls of ['raw', [null], [{ ...good, label: 1 }], [{ ...good, detail: 'x'.repeat(4001) }], [good, good], Array(129).fill(good)]) {
    const c = new HermesClient({ ...base, http: { async request() { return { status: 200, body: { messages: [{ id: '1', ref_seq: 1, role: 'assistant', text: '', tool_calls }], next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } } });
    await assert.rejects(c.history('th_1'), ProtocolError);
    assert.equal(c.messages.has('th_1'), false, 'invalid data must not partially change history');
  }
  const c = new HermesClient({ ...base, http: { async request() { return { status: 200, body: { messages: [{ id: '1', ref_seq: 1, role: 'user', text: 'hello', tool_calls: [good] }], next_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } } });
  await c.history('th_1'); assert.equal(c.messages.get('th_1')[0].tool_calls, undefined);
});

test('legacy server capabilities do not silently use new history query',async()=>{
  const c=new HermesClient({...base,http:{async request(){return {status:200,body:{protocol:1,durable_sync:true}}}}});
  await c.capabilities(); assert.equal(c.supportsLatest,false); await assert.rejects(c.historyWindow('t'),ProtocolError);
});
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
test('background message catch-up never walks unbounded forward history',async()=>{
  const paths=[];let more=true;
  const c=new HermesClient({...base,http:{async request(_method,path){
    paths.push(path);
    const index=paths.length;
    return {status:200,body:{messages:[{id:String(index+1),ref_seq:index+1,role:'assistant',text:'x'}],next_cursor:more?'opaque-'+index:null,incomplete_turns:[],turn_outcomes:[]}};
  }}});
  assert.deepEqual(await c.historyTail('th_1'),[]);
  assert.equal(paths.length,0);
  c.messages.set('th_1',[{id:'1',ref_seq:1,role:'user',text:'start'}]);
  await assert.rejects(c.historyTail('th_1'),ProtocolError);
  assert.equal(paths.length,3);
  assert.match(paths[0],/after_ref_seq=1/);
  assert.match(paths[1],/after=opaque-1/);
  assert.ok(c.tailIncomplete.has('th_1'));
  await assert.rejects(c.historyTail('th_1'),ProtocolError);
  assert.equal(paths.length,3);
  c.resumeTail('th_1');more=false;
  await c.historyTail('th_1');
  assert.equal(paths.length,4);
});
test('explicitly observed empty thread can receive its first live message',async()=>{
  let published=false;let calls=0;
  const c=new HermesClient({...base,http:{async request(){calls++;
    return {status:200,body:{messages:published?[{id:'first',ref_seq:7,role:'user',text:'hi'}]:[],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
  }}});
  await c.history('th_1');published=true;
  await c.historyTail('th_1');
  assert.equal(c.messages.get('th_1')[0].ref_seq,7);
  assert.equal(calls,2);
});
test('socket event triggers durable replay; duplicate frames and close do not send or stop execution',async()=>{
  let emit,closeFrame,closed=0,connectPath,connectToken,posts=0,replays=0;
  let ready;const connected=new Promise(r=>ready=r);
  const c=new HermesClient({...base,http:{async request(method,path){if(method==='POST')posts++;
    if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true}};
    if(path.startsWith('/v1/sync')) {replays++;return {status:200,body:{events:replays===1?[]:[event(1,'receipt','rc_1')],waterline:'c1',next_cursor:replays===1?'c0':'c1',has_more:false}}}
    if(path==='/v1/receipts/rc_1')return {status:200,body:{receipt:receipt()}};
    throw new Error(path);
  }},socket:{async connect(path,token){connectPath=path;connectToken=token;ready();return {onMessage(fn){emit=fn},onClose(fn){closeFrame=fn},close(){closed++}}}}});
  c.cursor='c0';await c.connect();await connected;await new Promise(r=>setTimeout(r,0));
  assert.equal(connectPath,'/v1/events?cursor=c0');assert.equal(connectToken,'synthetic-token');
  emit(JSON.stringify({type:'hello',protocol:1,durable_sync:true}));emit(JSON.stringify({type:'event',...event(1)}));emit(JSON.stringify({type:'event',...event(1)}));
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
test('explicit resync after invalid cursor releases run ownership and reconnects',async()=>{
  let invalid=true,connects=0;const errors=[];
  const c=new HermesClient({...base,onError:e=>errors.push(e.name),http:{async request(_method,path){
    if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true}};
    if(path.startsWith('/v1/sync'))return invalid?{status:400,body:{}}:emptySync;
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],waterline:'c0',next_after:null}};
    if(path==='/v1/channels')return {status:200,body:{channels:[]}};
    throw Error(path);
  }},socket:{async connect(){connects++;return {onMessage(){},onClose(){},close(){}}}}});
  c.cursor='foreign';await c.connect();await tick();assert.deepEqual(errors,['ResyncRequired']);
  invalid=false;await c.resync();await c.connect();await tick();assert.equal(connects,1);c.close();
});
test('delayed old close cannot close the next connection',async()=>{
  let oldClose,connects=0,newClosed=0;
  const c=new HermesClient({...base,http:{async request(_method,path){return path==='/v1/capabilities'?{status:200,body:{protocol:1,durable_sync:true}}:emptySync}},socket:{async connect(){
    const current=++connects;return {onMessage(){},onClose(fn){if(current===1)oldClose=fn},close(){if(current===2)newClosed++}};
  }}});c.cursor='c0';await c.connect();await tick();c.close();await c.connect();await tick();
  assert.equal(connects,2);oldClose();await tick();assert.equal(newClosed,0);c.close();
});
test('close during pending handshake disposes late socket without touching successor',async()=>{
  const pending=deferred();let connects=0,lateClosed=0,newClosed=0;
  const c=new HermesClient({...base,http:{async request(_method,path){return path==='/v1/capabilities'?{status:200,body:{protocol:1,durable_sync:true}}:emptySync}},socket:{connect(){
    return ++connects===1?pending.promise:Promise.resolve({onMessage(){},onClose(){},close(){newClosed++}});
  }}});c.cursor='c0';await c.connect();await tick();c.close();await c.connect();await tick();
  pending.resolve({onMessage(){},onClose(){},close(){lateClosed++}});await tick();
  assert.equal(connects,2);assert.equal(lateClosed,1);assert.equal(newClosed,0);c.close();assert.equal(newClosed,1);
});
test('close during pending replay cannot publish old cursor or block next connect',async()=>{
  const pending=deferred();let syncs=0,connects=0;
  const c=new HermesClient({...base,http:{request(_method,path){
    if(path==='/v1/capabilities')return Promise.resolve({status:200,body:{protocol:1,durable_sync:true}});
    return ++syncs===1?pending.promise:Promise.resolve(emptySync);
  }},socket:{async connect(){connects++;return {onMessage(){},onClose(){},close(){}}}}});
  c.cursor='c0';await c.connect();await tick();c.close();await c.connect();await tick();
  assert.equal(connects,1);pending.resolve({status:200,body:{events:[event(1)],waterline:'c1',next_cursor:'c1',has_more:false}});await tick();
  assert.equal(c.cursor,'c0');assert.equal(c.lastEventId,0);c.close();
});
test('already aborted adapter handshakes create no socket',async()=>{
  const controller=new AbortController();controller.abort();let constructed=0;
  class NativeWebSocket {constructor(){constructed++}}
  await assert.rejects(desktopTransport('http://127.0.0.1:1').socket.connect('/v1/events','synthetic',controller.signal),/aborted/);
  await assert.rejects(mobileTransport('http://127.0.0.1:1',NativeWebSocket,fetch).socket.connect('/v1/events','synthetic',controller.signal),/aborted/);
  assert.equal(constructed,0);
});
test('fresh snapshot bootstraps pending interaction and active receipt, then settles by event',async()=>{
  const item={id:'req-1',kind:'approval',thread_id:'th_1',receipt_id:'rc_1',generation:'g1',prompt:'Approve?',choices:['deny','allow'],state:'pending'};
  const c=new HermesClient({...base,http:{async request(method,path){
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[{id:'th_1',project_id:'p',title:'t',archived:0,last_ref:0,read_ref:0,unread_count:0,active_receipts:[receipt()],pending_interactions:[item]}],waterline:'c1',next_after:null}};
    if(path==='/v1/channels')return {status:200,body:{channels:[]}};
    if(path.startsWith('/v1/sync'))return {status:200,body:{events:[event(2,'interaction','req-1')],waterline:'c2',next_cursor:'c2',has_more:false}};
    if(path.endsWith('/interactions/req-1'))return {status:200,body:{interaction:{...item,state:'settled'}}};
    throw Error(path);
  }}});await c.snapshot();assert.equal(c.interactions.get('req-1').prompt,'Approve?');assert.equal(c.receipts.get('rc_1').state,'queued');await c.catchUp();assert.equal(c.interactions.size,0);
});
test('binary upload, exact retry payload, download and deleted metadata use injected transport',async()=>{
  const calls=[];const bytes=new Uint8Array([0,255,17]);const c=new HermesClient({...base,http:{
    async upload(path,token,name,body){calls.push({path,token,name,body});return {status:201,body:{attachment:{id:'att_1',thread_id:'th_1',name,mime:'application/octet-stream',size:3}}}},
    async download(){return {status:200,body:bytes}},
    async request(method,path,token,body){calls.push({method,path,token,body});if(method==='POST')return {status:202,body:{receipt:receipt()}};if(method==='DELETE')return {status:200,body:{deleted:true}};return {status:200,body:{attachment:{id:'att_1',thread_id:'th_1',state:'deleted'}}}}
  }});const a=await c.upload('th_1','raw.bin',bytes);assert.equal(a.state,'available');await c.send('th_1','device-1','body',[a.id]);await c.send('th_1','device-1','body',[a.id]);assert.deepEqual(calls[1].body,calls[2].body);assert.deepEqual(await c.download('th_1',a.id),bytes);await c.deleteUnattached('th_1',a.id);assert.equal((await c.getAttachment('th_1',a.id)).state,'deleted');
});
test('manual and connected catchUp serialize across distinct signals',async()=>{
  const gate=deferred();let syncs=0;const c=new HermesClient({...base,http:{async request(method,path){if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true}};if(path.startsWith('/v1/sync')){syncs++;if(syncs===1)return gate.promise;return {status:200,body:{events:[],waterline:'c1',next_cursor:'c1',has_more:false}}}if(path==='/v1/receipts/rc_1')return {status:200,body:{receipt:receipt()}};throw Error(path)}},socket:{async connect(){return {onMessage(){},onClose(){},close(){}}}}});
  c.cursor='c0';const manual=c.catchUp();await tick();await c.connect();await tick();assert.equal(syncs,1);gate.resolve({status:200,body:{events:[event(1)],waterline:'c1',next_cursor:'c1',has_more:false}});await manual;await tick();assert.equal(c.cursor,'c1');assert.equal(syncs,2);c.close();
});
