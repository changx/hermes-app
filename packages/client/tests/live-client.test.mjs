import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/liveClient.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LiveSessionClient}=module.exports;
const tick=()=>new Promise(r=>setImmediate(r));
const until=async fn=>{const end=Date.now()+2000;while(!fn()){assert.ok(Date.now()<end,'condition timed out');await tick()}};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)}};
const message=(id,text=id)=>({id,ref_seq:Number(id.slice(1)),role:'assistant',text});
const entry=id=>({kind:'session',value:{id,project_id:'p',title:id,archived:false,running:id==='B'}});
function fixture({request,ack=true}={}){
  const paths=[],sockets=[],errors=[],records={A:[message('m1','A')],B:[message('m2','B')]};
  let items=[{kind:'channel',value:{id:'p',name:'P'}},entry('A'),entry('B')];
  const defaultReply=path=>{
    if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true,history_latest:true,message_send_identity:true,open_session_live:true}};
    if(path.startsWith('/v1/catalogue'))return {status:200,body:{items,next_after:null}};
    const id=path.split('/')[3];
    if(path.includes('/messages')){const params=new URL('https://fixture.test'+path).searchParams,exact=params.get('ref_seq'),after=params.get('after_ref_seq');let rows=records[id]||[];if(exact)rows=rows.filter(m=>m.ref_seq===Number(exact));else if(after)rows=rows.filter(m=>m.ref_seq>Number(after));return {status:200,body:{messages:rows,older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}}}
    if(path.endsWith('/live-state'))return {status:200,body:{thread_id:id,active_receipts:[],pending_interactions:[]}};
    if(path.startsWith('/v1/receipts/'))return {status:200,body:{receipt:{id:'rB',thread_id:'B',client_message_id:'inputB',state:'queued',durable:true,ref_seq:2}}};
    if(path==='/v1/threads/B/messages')return {status:202,body:{receipt:{id:'rB',thread_id:'B',client_message_id:'inputB',state:'queued',durable:true,ref_seq:2}}};
    throw Error('unexpected request '+path);
  };
  const sdk=new LiveSessionClient({token:()=> 'synthetic',http:{async request(method,path,_token,body,signal){paths.push([method,path]);if(request){const reply=await request(method,path,body,signal,defaultReply);if(reply)return reply}return defaultReply(path)}},socket:{async connect(path){assert.equal(path,'/v1/live');let listener,closedListener,closed=false;const pending=[];const socket={sent:[],closeCount:0,
    emit(frame){const value=typeof frame==='string'?frame:JSON.stringify(frame);if(listener)listener(value);else pending.push(value)},
    onMessage(fn){listener=fn;for(const p of pending.splice(0))fn(p)},onClose(fn){closedListener=fn;if(closed)fn()},
    send(value){this.sent.push(value);if(value==='ping'){queueMicrotask(()=>this.emit('pong'));return}const frame=JSON.parse(value);if(ack)queueMicrotask(()=>this.emit({...frame,type:'watching'}))},
    close(){if(closed)return;closed=true;this.closeCount++;closedListener?.()},get closed(){return closed}};
    sockets.push(socket);queueMicrotask(()=>socket.emit({type:'hello',protocol:1,open_session_live:true}));return socket;
  }},onError:e=>errors.push(e),livenessMs:20,backoffMs:[5,10]});
  return {sdk,paths,sockets,records,errors,setItems(value){items=value}};
}
const watch=(socket,id)=>socket.sent.map(s=>s==='ping'?null:JSON.parse(s)).filter(s=>s?.thread_id===id).at(-1);

test('completed-unread remains directory-only and only an opened loaded exact result can be acknowledged',async()=>{
  const items=[{kind:'channel',value:{id:'p',name:'P'}},{...entry('A'),value:{...entry('A').value,completed_unread:true,result_version:7,result_ref:1}},entry('B')];
  const f=fixture({request:async(method,path,body)=>{
    if(path.startsWith('/v1/catalogue'))return {status:200,body:{items,next_after:null}};
    if(path.endsWith('/result-read')){
      assert.equal(method,'POST');assert.deepEqual(body,{result_version:7});
      items[1].value.completed_unread=false;
      return {status:200,body:{thread_id:'A',completed_unread:false,result_version:7,result_ref:1}};
    }
  }});
  try{
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    assert.equal(f.sdk.threads.get('A').completed_unread,true);assert.equal(f.sdk.messages.size,0);
    await f.sdk.markResultRead('A',7,1);assert.ok(f.paths.every(([,p])=>!p.endsWith('/result-read')));
    await f.sdk.openConversation('A');
    await f.sdk.markResultRead('A',6,1);await f.sdk.markResultRead('A',7,9);await f.sdk.markResultRead('B',7,1);
    assert.ok(f.paths.every(([,p])=>!p.endsWith('/result-read')));
    await f.sdk.markResultRead('A',7,1);assert.equal(f.sdk.threads.get('A').completed_unread,false);
    assert.ok(f.paths.every(([,p])=>!p.includes('/B/messages')));
    f.sdk.closeConversation();assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.threads.get('A').result_version,7);
  }finally{f.sdk.close()}
});

test('directory invalidation clears remote read and preserves a newer unread result without fetching its body',async()=>{
  const f=fixture();await f.sdk.connect();
  try{
    await until(()=>f.sdk.connectionState==='online');
    const items=unread=>[{kind:'channel',value:{id:'p',name:'P'}},{...entry('B'),value:{...entry('B').value,completed_unread:unread,result_version:2,result_ref:2}}];
    f.setItems(items(true));f.sockets[0].emit({type:'directory_changed'});await until(()=>f.sdk.threads.get('B')?.completed_unread===true);
    f.setItems(items(false));f.sockets[0].emit({type:'directory_changed'});await until(()=>f.sdk.threads.get('B')?.completed_unread===false);
    assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.receipts.size,0);assert.ok(f.paths.every(([,p])=>!p.includes('/messages')));
    f.sdk.suspendConnection();f.setItems(items(true));await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    assert.equal(f.sdk.threads.get('B').completed_unread,true);assert.equal(f.sdk.messages.size,0);
  }finally{f.sdk.close()}
});

test('idle account keeps only directory; heartbeat and closed running state fetch no business data',async()=>{
  const {sdk,paths,sockets}=fixture();await sdk.connect();
  try{
    await until(()=>sdk.connectionState==='online');assert.equal(sdk.messages.size,0);assert.equal(sdk.receipts.size,0);
    const count=paths.length;await new Promise(r=>setTimeout(r,65));assert.equal(paths.length,count);assert.ok(sockets[0].sent.includes('ping'));
    sockets[0].emit({type:'session_state',thread_id:'B',running:false});await tick();assert.equal(sdk.threads.get('B').running,false);assert.equal(paths.length,count);assert.equal(sdk.messages.size,0);
    await assert.rejects(sdk.historyWindow('B'),/not open/);assert.equal(paths.length,count);
    await sdk.markRead('B',9);assert.equal(paths.length,count);assert.ok(paths.every(([,p])=>!p.startsWith('/v1/sync')&&!p.endsWith('/read')));
  }finally{sdk.close()}
});

test('open reads only acknowledged watched session, close releases all content without stopping the server',async()=>{
  const {sdk,paths,sockets}=fixture();await sdk.openConversation('A');
  try{
    assert.equal(sdk.currentThreadId,'A');assert.deepEqual([...sdk.messages.keys()],['A']);assert.equal(sdk.messages.get('A')[0].text,'A');
    assert.ok(paths.every(([,p])=>!p.includes('/B/messages')));sdk.closeConversation();
    assert.equal(sdk.messages.size,0);assert.equal(sdk.receipts.size,0);assert.equal(sdk.interactions.size,0);assert.equal(sdk.attachments.size,0);assert.equal(sdk.drafts.size,0);
    assert.equal(sdk.threads.size,2);assert.equal(sdk.currentThreadId,null);assert.ok(watch(sockets[0],null));assert.ok(paths.every(([m,p])=>m==='GET'&&!p.endsWith('/stop')));
    assert.throws(()=>sdk.checkpoint(),/not persisted/);
  }finally{sdk.close()}
});

test('rapid A/B/A cancels old history and old watch identity cannot fetch or resurrect stale A',async()=>{
  const gate=deferred();let first=true;
  const f=fixture({request:async(_m,p)=>{if(p.includes('/A/messages')&&first){first=false;return gate.promise}}});
  const a=f.sdk.openConversation('A');await until(()=>f.paths.some(([,p])=>p.includes('/A/messages')));const stale=watch(f.sockets[0],'A');
  await f.sdk.openConversation('B');await assert.rejects(a,/aborted/);await f.sdk.openConversation('A');
  const count=f.paths.length;f.sockets[0].emit({type:'conversation_changed',thread_id:'A',request_id:stale.request_id});await tick();assert.equal(f.paths.length,count);
  gate.resolve({status:200,body:{messages:[message('m1','OLD')],older_cursor:null}});await tick();assert.equal(f.sdk.messages.get('A')[0].text,'A');assert.deepEqual([...f.sdk.messages.keys()],['A']);f.sdk.close();
});

test('change during initial read is reconciled after the ACK without a replay request',async()=>{
  const gate=deferred();let first=true;
  const f=fixture({request:async(_m,p)=>{if(p.includes('/A/messages')&&first){first=false;return gate.promise}}});
  const opened=f.sdk.openConversation('A');await until(()=>f.paths.some(([,p])=>p.includes('/A/messages')));
  f.records.A=[message('m1','edited'),message('m3','new')];f.sockets[0].emit({type:'conversation_changed',thread_id:'A',request_id:watch(f.sockets[0],'A').request_id});
  gate.resolve({status:200,body:{messages:[message('m1','old')],older_cursor:null}});await opened;await until(()=>f.sdk.messages.get('A')?.length===2);
  assert.equal(f.sdk.messages.get('A')[0].text,'edited');assert.ok(f.paths.every(([,p])=>!p.startsWith('/v1/sync')));f.sdk.close();
});

test('directory removal releases an opened target and retains lightweight other-session state',async()=>{
  const f=fixture();await f.sdk.openConversation('A');f.setItems([{kind:'channel',value:{id:'p',name:'P'}},entry('B')]);
  f.sockets[0].emit({type:'directory_changed'});await until(()=>f.sdk.currentThreadId===null);assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.threads.has('A'),false);assert.equal(f.sdk.threads.has('B'),true);f.sdk.close();
});

test('transient receipt/proof operations for closed targets retain no content cache',async()=>{
  const f=fixture();await f.sdk.openConversation('A');f.records.B=[{...message('m2','input'),role:'user',receipt_id:'rB',client_message_id:'inputB'}];
  const receipt=await f.sdk.getReceipt('rB');assert.equal(receipt.thread_id,'B');assert.equal(f.sdk.receipts.has('rB'),false);
  const page=await f.sdk.history('B',undefined,1,undefined,undefined,2);assert.equal(page.messages.length,1);assert.equal(f.sdk.messages.has('B'),false);assert.deepEqual([...f.sdk.messages.keys()],['A']);f.sdk.close();
});

test('reconnect rereads directory/current content, never closed-session history or old events',async()=>{
  const f=fixture();await f.sdk.openConversation('A');f.records.A=[message('m1','after reconnect')];f.sockets[0].close();
  await until(()=>f.sockets.length===2&&f.sdk.connectionState==='online');await until(()=>f.sdk.messages.get('A')?.[0].text==='after reconnect');
  assert.ok(f.paths.every(([,p])=>!p.includes('/B/messages')&&!p.startsWith('/v1/sync')));f.sdk.close();
});

test('no content read starts before the matching watch acknowledgement',async()=>{
  const f=fixture({ack:false});await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
  const opened=f.sdk.openConversation('A');await tick();await assert.rejects(f.sdk.historyWindow('A'),/not open/);assert.ok(f.paths.every(([,p])=>!p.includes('/A/messages')));
  const selected=watch(f.sockets[0],'A');f.sockets[0].emit({type:'watching',thread_id:'A',request_id:'stale'});await tick();assert.ok(f.paths.every(([,p])=>!p.includes('/A/messages')));
  f.sockets[0].emit({type:'watching',thread_id:'A',request_id:selected.request_id});await opened;f.sdk.close();
});

test('repeated switching retains only one message map and close retains no server content',async()=>{
  const f=fixture();
  try{for(let n=0;n<100;n++){const id=n%2?'B':'A';await f.sdk.openConversation(id);assert.deepEqual([...f.sdk.messages.keys()],[id]);f.sdk.closeConversation();assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.receipts.size,0);assert.equal(f.sdk.attachments.size,0);assert.equal(f.sdk.interactions.size,0)}assert.equal(f.sdk.threads.size,2)}finally{f.sdk.close()}
});

test('opened content is not periodically reread between actual notifications',async()=>{
  const f=fixture();await f.sdk.openConversation('A');
  try{const count=f.paths.length;await new Promise(r=>setTimeout(r,65));assert.equal(f.paths.length,count)}finally{f.sdk.close()}
});

test('late callbacks from a closed connection cannot close or mutate its successor',async()=>{
  const f=fixture();await f.sdk.openConversation('A');const old=f.sockets[0];
  f.sdk.close();await f.sdk.connect();await until(()=>f.sockets.length===2&&f.sdk.connectionState==='online');
  old.emit({type:'hello',protocol:1,open_session_live:true});old.emit({type:'directory_changed'});await tick();
  assert.equal(f.sockets[1].closed,false);assert.equal(f.sdk.connectionState,'online');f.sdk.close();
});

test('suspension retains the one current scene, has no background reads, and reconnects without losing ownership',async()=>{
 const f=fixture();await f.sdk.openConversation('A');const owner=f.sdk.currentConversationKey,rows=f.sdk.messages.get('A');const old=f.sockets[0];
 f.sdk.suspendConnection();assert.equal(f.sdk.connectionState,'suspended');assert.equal(f.sdk.currentThreadId,'A');assert.equal(f.sdk.currentConversationKey,owner);assert.equal(f.sdk.messages.get('A'),rows);assert.equal(old.closed,true);
 const count=f.paths.length;await new Promise(r=>setTimeout(r,65));assert.equal(f.paths.length,count);assert.equal(f.sockets.length,1);
 f.records.A.push(message('m3','new while background'));await f.sdk.connect();await until(()=>f.sdk.messages.get('A')?.length===2);assert.equal(f.sdk.currentConversationKey,owner);assert.equal(f.sdk.messages.get('A')[0],rows[0]);assert.ok(f.paths.every(([,p])=>!p.includes('/B/messages')));
 f.sdk.closeConversation();assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.publishedMessages.length,0);f.sdk.close();
});
test('fresh foreground refresh preserves unchanged tool and attachment identities for mounted readers',async()=>{
 const f=fixture();f.records.A[0].tool_calls=[{id:'tool1',name:'web_search',label:'Search web'}];f.records.A[0].attachments=[{id:'att_A',thread_id:'A',state:'available',name:'image.png',mime:'image/png',size:1,receipt_id:null}];await f.sdk.openConversation('A');const row=f.sdk.messages.get('A')[0];assert.equal(row.tool_calls.length,1);assert.equal(row.attachments.length,1);f.sdk.suspendConnection();await f.sdk.connect();await until(()=>f.sockets.length===2&&f.sdk.connectionState==='online');await until(()=>f.paths.filter(([,p])=>p.includes('/A/live-state')).length===2);assert.equal(f.sdk.messages.get('A')[0],row);assert.equal(f.sdk.messages.get('A')[0].tool_calls,row.tool_calls);assert.equal(f.sdk.messages.get('A')[0].attachments,row.attachments);f.sdk.close();
});
test('late old content read during suspension cannot change the retained reading scene',async()=>{
 let pauseNext=false;const gate=deferred();const f=fixture({request:async(_m,p)=>{if(p.includes('/A/messages')&&pauseNext){pauseNext=false;return gate.promise}}});await f.sdk.openConversation('A');const rows=f.sdk.messages.get('A');pauseNext=true;const read=f.sdk.historyWindow('A','older');await tick();f.sdk.suspendConnection();await assert.rejects(read,/aborted/);gate.resolve({status:200,body:{messages:[message('m1','late stale')],older_cursor:null}});await tick();assert.equal(f.sdk.messages.get('A'),rows);f.sdk.close();
});
test('remote archive during background becomes unavailable on recovery and releases content',async()=>{
 const f=fixture();await f.sdk.openConversation('A');f.sdk.suspendConnection();f.setItems([{kind:'channel',value:{id:'p',name:'P'}},entry('B')]);await f.sdk.connect();await until(()=>f.sdk.currentThreadId===null);assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.publishedMessages.length,0);f.sdk.close();
});

test('auth rejection blocks instead of repeatedly reconnecting or pairing',async()=>{
  const f=fixture({request:async(_m,p)=>p==='/v1/capabilities'?{status:403,body:{}}:undefined});await f.sdk.connect();await until(()=>f.sdk.connectionState==='blocked');
  assert.equal(f.paths.length,1);assert.equal(f.sockets.length,0);f.sdk.close();
});

test('conversation ownership survives reconnect but cannot close a later same-ID opening',async()=>{
  const f=fixture();await f.sdk.openConversation('A');const owner=f.sdk.currentConversationKey;
  f.sockets[0].close();await until(()=>f.sockets.length===2&&f.sdk.connectionState==='online');assert.equal(f.sdk.currentConversationKey,owner);
  f.sdk.closeConversation();await f.sdk.openConversation('A');assert.notEqual(f.sdk.currentConversationKey,owner);f.sdk.close();
});
test('durable accepted echo keeps one stable input through history hydration and retains nothing after close',async()=>{
  const f=fixture();await f.sdk.openConversation('A');
  const receipt={id:'rA',thread_id:'A',client_message_id:'inputA',durable:true,ref_seq:5,state:'unknown',processing:'unknown'};
  f.sdk.rememberAcceptedInput('A','inputA','original',[],1000,receipt);
  assert.equal(f.sdk.messages.get('A').filter(m=>m.client_message_id==='inputA').length,1);
  f.records.A.push({id:'m5',ref_seq:5,role:'user',text:'original',client_message_id:'inputA',receipt_id:'rA',created_at:1000});
  await f.sdk.historyWindow('A');assert.equal(f.sdk.messages.get('A').filter(m=>m.client_message_id==='inputA').length,1);
  f.sdk.closeConversation();f.sdk.rememberAcceptedInput('A','inputA','original',[],1000,receipt);assert.equal(f.sdk.messages.size,0);assert.equal(f.sdk.receipts.size,0);f.sdk.close();
});
