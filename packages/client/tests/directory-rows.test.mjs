import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/liveClient.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LiveSessionClient}=module.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async predicate=>{const end=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<end,'condition timed out');await tick();}};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};

// Synthetic server: a directory of two Threads in Channel p; A has an unread result at ref 2.
function fixture({rows=true}={}){
  const calls=[], gates=[], sockets=[];
  const server={channels:[{id:'p',name:'P'}],threads:{
    A:{id:'A',project_id:'p',title:'A',archived:false,running:false,completed_unread:true,result_version:1,result_ref:2},
    B:{id:'B',project_id:'p',title:'B',archived:false,running:false}}};
  let failRows=false;
  const sdk=new LiveSessionClient({token:()=>'synthetic',livenessMs:5000,backoffMs:[5],onChange:()=>{},
    http:{async request(method,path,_token,body){
      calls.push(method+' '+path);
      if(path==='/v1/capabilities')return {status:200,body:{protocol:1,open_session_live:true,history_latest:true,history_full:true,...(rows?{catalogue_threads:true}:{})}};
      if(path.startsWith('/v1/catalogue/threads?')){
        const ids=new URL('https://fixture.test'+path).searchParams.getAll('id');
        // Rows are read when the request arrives, like the server's read transaction.
        const snapshot=structuredClone(server.threads);
        const gate=gates.shift();if(gate)await gate.promise;
        if(failRows)return {status:500,body:{}};
        return {status:200,body:{items:ids.filter(id=>snapshot[id]).sort().map(id=>({kind:'session',value:snapshot[id]})),missing:ids.filter(id=>!snapshot[id])}};
      }
      if(path.startsWith('/v1/catalogue'))return {status:200,body:{items:[...server.channels.map(value=>({kind:'channel',value})),...Object.values(server.threads).map(value=>({kind:'session',value}))],next_after:null}};
      if(method==='POST'&&path==='/v1/threads/A/result-read'){
        const t=server.threads.A;if(body.result_version===t.result_version)t.completed_unread=false;
        return {status:200,body:{thread_id:'A',completed_unread:t.completed_unread,result_version:t.result_version,result_ref:t.result_ref}};
      }
      if(path.includes('/messages'))return {status:200,body:{messages:[{id:'a2',ref_seq:2,role:'assistant',text:'result'}],complete:true,older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      if(path.endsWith('/live-state'))return {status:200,body:{thread_id:'A',active_receipts:[],pending_interactions:[]}};
      throw new Error('unexpected '+path);
    }},
    socket:{async connect(){let listener;const pending=[];
      const socket={closed:false,emit(frame){const data=typeof frame==='string'?frame:JSON.stringify(frame);if(listener)listener(data);else pending.push(data)},
        onMessage(fn){listener=fn;pending.splice(0).forEach(fn)},onClose(){},close(){this.closed=true},
        send(data){if(data==='ping'){queueMicrotask(()=>this.emit('pong'));return}const c=JSON.parse(data);queueMicrotask(()=>this.emit({type:'watching',thread_id:c.thread_id,request_id:c.request_id}))}};
      sockets.push(socket);queueMicrotask(()=>socket.emit({type:'hello',protocol:1,open_session_live:true}));return socket;}}});
  const changed=frame=>sockets.at(-1).emit({type:'directory_changed',...frame});
  const count=prefix=>calls.filter(call=>call.startsWith(prefix)).length;
  return {sdk,server,calls,gates,changed,count,setFailRows:value=>{failRows=value}};
}
const ready=async f=>{await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady&&f.sdk.connectionState==='online');await f.sdk.openConversation('A');};

test('read acknowledgement clears the marker from its own response, with no catalogue walk',async()=>{
  const f=fixture();try{
    await ready(f);const walks=f.count('GET /v1/catalogue?');
    await f.sdk.markResultRead('A',1,2);
    assert.equal(f.sdk.threads.get('A').completed_unread,false);
    assert.equal(f.count('POST /v1/threads/A/result-read'),1);
    assert.equal(f.count('GET /v1/catalogue'),walks,'no catalogue request after the acknowledgement');
  }finally{f.sdk.close();}
});

test('a row read that started before the acknowledgement cannot restore the marker',async()=>{
  const f=fixture();try{
    await ready(f);
    const gate=deferred();f.gates.push(gate);
    f.changed({thread_ids:['A']});await until(()=>f.count('GET /v1/catalogue/threads')===1);
    await f.sdk.markResultRead('A',1,2);
    assert.equal(f.sdk.threads.get('A').completed_unread,false);
    gate.resolve();await tick();await tick();
    assert.equal(f.sdk.threads.get('A').completed_unread,false,'stale unread row was dropped');
  }finally{f.sdk.close();}
});

test('directory_changed with Thread IDs reads only those rows',async()=>{
  const f=fixture();try{
    await ready(f);const walks=f.count('GET /v1/catalogue?');
    f.server.threads.B={...f.server.threads.B,title:'B renamed',completed_unread:true,result_version:3,result_ref:7};
    delete f.server.threads.A;
    f.changed({thread_ids:['A','B']});
    await until(()=>f.sdk.threads.get('B')?.title==='B renamed');
    assert.deepEqual(f.calls.filter(c=>c.startsWith('GET /v1/catalogue/threads')),['GET /v1/catalogue/threads?id=A&id=B']);
    assert.equal(f.sdk.threads.get('B').completed_unread,true);
    assert.equal(f.sdk.threads.has('A'),false,'a missing Thread leaves the directory');
    assert.equal(f.sdk.currentThreadId,null,'the open Thread closed when it left the directory');
    assert.equal(f.count('GET /v1/catalogue?'),walks,'no catalogue walk');
  }finally{f.sdk.close();}
});

test('an older row response arriving after a newer one is dropped',async()=>{
  const f=fixture();try{
    await ready(f);
    const slow=deferred();f.gates.push(slow);
    f.server.threads.B={...f.server.threads.B,title:'first'};f.changed({thread_ids:['B']});
    await until(()=>f.count('GET /v1/catalogue/threads')===1);
    f.server.threads.B={...f.server.threads.B,title:'second'};f.changed({thread_ids:['B']});
    await until(()=>f.sdk.threads.get('B').title==='second');
    slow.resolve();await tick();await tick();
    assert.equal(f.sdk.threads.get('B').title,'second');
  }finally{f.sdk.close();}
});

test('the whole catalogue is read for a plain frame, an unknown Channel, a failed row read, or an older server',async()=>{
  const f=fixture();try{
    await ready(f);let walks=f.count('GET /v1/catalogue?');
    f.changed({});await until(()=>f.count('GET /v1/catalogue?')===walks+1);walks++;
    f.server.channels.push({id:'q',name:'Q'});f.server.threads.B={...f.server.threads.B,project_id:'q'};
    f.changed({thread_ids:['B']});await until(()=>f.count('GET /v1/catalogue?')===walks+1);walks++;
    await until(()=>f.sdk.channels.has('q')&&f.sdk.threads.get('B').project_id==='q');
    f.setFailRows(true);f.server.threads.B={...f.server.threads.B,title:'after failure'};
    f.changed({thread_ids:['B']});await until(()=>f.sdk.threads.get('B').title==='after failure');
    assert.equal(f.count('GET /v1/catalogue?'),walks+1);assert.equal(f.sdk.connectionState,'online');
  }finally{f.sdk.close();}
  const old=fixture({rows:false});try{
    await ready(old);const walks=old.count('GET /v1/catalogue?');
    old.changed({thread_ids:['B']});await until(()=>old.count('GET /v1/catalogue?')===walks+1);
    assert.equal(old.count('GET /v1/catalogue/threads'),0);
  }finally{old.sdk.close();}
});

test('frames with invalid Thread IDs are rejected',async()=>{
  const protocol=await build({entryPoints:[new URL('../src/liveProtocol.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
  const m={exports:{}};new Function('module','exports',protocol.outputFiles[0].text)(m,m.exports);
  const {parseLiveFrame,parseCatalogueThreads}=m.exports;
  assert.deepEqual(parseLiveFrame({type:'directory_changed',thread_ids:['A']}),{type:'directory_changed',thread_ids:['A']});
  assert.deepEqual(parseLiveFrame({type:'directory_changed'}),{type:'directory_changed'});
  for(const ids of [[],['a','a'],[''],Array.from({length:101},(_,i)=>'t'+i),'A'])assert.throws(()=>parseLiveFrame({type:'directory_changed',thread_ids:ids}));
  const row=id=>({kind:'session',value:{id,project_id:'p',title:id,archived:false,running:false}});
  assert.equal(parseCatalogueThreads({items:[row('A')],missing:['B']},['A','B']).missing[0],'B');
  // Every requested Thread must be answered exactly once, and nothing else.
  for(const body of [{items:[row('A')],missing:[]},{items:[row('A'),row('C')],missing:['B']},{items:[row('A')],missing:['A','B']},{items:[{kind:'channel',value:{id:'A',name:'A'}}],missing:['B']}])
    assert.throws(()=>parseCatalogueThreads(body,['A','B']));
});
