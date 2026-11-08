import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/liveClient.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LiveSessionClient}=module.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async predicate=>{const end=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<end,'condition timed out');await tick();}};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};

// Synthetic server whose catalogue walk can be held open with gates, one per page request.
function fixture({pageLimit,ignoreLimit=false}={}){
  const calls=[], gates=[], sockets=[], states=[];
  const server={channels:[{id:'p',name:'P'}],threads:{
    A:{id:'A',project_id:'p',title:'A',archived:false,running:false},
    B:{id:'B',project_id:'p',title:'B',archived:false,running:false}}};
  let failWalk=false;
  const sdk=new LiveSessionClient({token:()=>'synthetic',livenessMs:5000,backoffMs:[5],onChange:()=>{},onConnectionState:state=>states.push(state),
    http:{async request(method,path){
      calls.push(method+' '+path);
      if(path==='/v1/capabilities')return {status:200,body:{protocol:1,open_session_live:true,history_latest:true,history_full:true,catalogue_threads:true,
        ...(pageLimit===undefined?{}:{catalogue_page_limit:pageLimit})}};
      if(path.startsWith('/v1/catalogue?')){
        const gate=gates.shift();if(gate)await gate.promise;
        if(failWalk)return {status:500,body:{}};
        // Same paging as the plugin: ordered keys, at most `limit` items, next_after = last key.
        const query=new URLSearchParams(path.slice(path.indexOf('?')+1)),limit=ignoreLimit?Infinity:Number(query.get('limit')),after=query.get('after');
        const rows=[...server.channels.map(value=>['channel:'+value.id,{kind:'channel',value}]),...Object.values(server.threads).map(value=>['session:'+value.id,{kind:'session',value}])]
          .sort((a,b)=>a[0]<b[0]?-1:1).filter(([key])=>!after||key>after);
        const page=rows.slice(0,limit);
        return {status:200,body:{items:page.map(row=>row[1]),next_after:rows.length>limit?page.at(-1)[0]:null}};
      }
      if(path.includes('/messages'))return {status:200,body:{messages:[{id:'a1',ref_seq:1,role:'assistant',text:'hello'}],complete:true,older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      if(path.endsWith('/live-state'))return {status:200,body:{thread_id:'A',active_receipts:[],pending_interactions:[]}};
      throw new Error('unexpected '+path);
    }},
    socket:{async connect(){let listener,closed;const pending=[];
      const socket={closed:false,emit(frame){const data=typeof frame==='string'?frame:JSON.stringify(frame);if(listener)listener(data);else pending.push(data)},
        onMessage(fn){listener=fn;pending.splice(0).forEach(fn)},onClose(fn){closed=fn},close(){this.closed=true},drop(){this.closed=true;closed?.()},
        send(data){if(data==='ping'){queueMicrotask(()=>this.emit('pong'));return}const c=JSON.parse(data);queueMicrotask(()=>this.emit({type:'watching',thread_id:c.thread_id,request_id:c.request_id}))}};
      sockets.push(socket);queueMicrotask(()=>socket.emit({type:'hello',protocol:1,open_session_live:true}));return socket;}}});
  const walks=()=>calls.filter(call=>call.startsWith('GET /v1/catalogue?'));
  return {sdk,server,calls,gates,sockets,states,walks,setFailWalk:value=>{failWalk=value}};
}

test('the first connection is online at hello while the catalogue walk is still running',async()=>{
  const f=fixture();const gate=deferred();f.gates.push(gate);
  try{
    await f.sdk.connect();
    await until(()=>f.walks().length===1);
    assert.equal(f.sdk.connectionState,'online','online before the walk returns');
    assert.equal(f.sdk.isCatalogueReady,false,'no directory yet, so availability is still unknown');
    assert.equal(f.states.includes('syncing'),false);
    gate.resolve();
    await until(()=>f.sdk.isCatalogueReady);
    assert.deepEqual([...f.sdk.threads.keys()].sort(),['A','B']);
    assert.equal(f.sdk.connectionState,'online');
  }finally{f.sdk.close();}
});

test('a reconnect keeps the last directory and opens the conversation before the walk ends',async()=>{
  const f=fixture();
  try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    await f.sdk.openConversation('A');
    const gate=deferred();f.gates.push(gate);
    delete f.server.threads.B;
    f.sockets.at(-1).drop();
    await until(()=>f.sockets.length===2&&f.walks().length===2&&f.sdk.connectionState==='online');
    // The old directory is still shown and still trusted while the new walk is held.
    assert.equal(f.sdk.isCatalogueReady,true);
    assert.ok(f.sdk.threads.has('B'),'previous rows stay until the walk replaces them');
    await until(()=>f.calls.filter(c=>c.startsWith('GET /v1/threads/A/live-state')).length===2);
    gate.resolve();
    await until(()=>!f.sdk.threads.has('B'));
    assert.ok(f.sdk.threads.has('A'));
    assert.equal(f.sdk.connectionState,'online');
  }finally{f.sdk.close();}
});

test('the walk uses the page limit the server publishes, and 30 for older servers',async()=>{
  for(const [published,expected] of [[undefined,30],[500,500],[200,200],[100000,500],[12,30],['500',30],[1.5,30]]){
    const f=fixture({pageLimit:published});
    try{
      await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
      assert.deepEqual(f.walks(),['GET /v1/catalogue?limit='+expected],'published '+String(published));
    }finally{f.sdk.close();}
  }
});

test('a directory larger than one page loads at every published page size',async()=>{
  // jamie has 801 catalogue rows: more than 100 per page broke the walk on 500-row pages.
  for(const [published,pages] of [[500,2],[undefined,27],[200,5]]){
    const f=fixture({pageLimit:published});
    for(let i=0;i<800;i++){const id='T'+String(i).padStart(4,'0');f.server.threads[id]={id,project_id:'p',title:id,archived:false,running:false}}
    try{
      await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
      assert.equal(f.walks().length,pages,'published '+String(published));
      assert.equal(f.sdk.threads.size,802);
      assert.equal(f.sdk.connectionState,'online');
      assert.equal(f.states.includes('retrying'),false,'the walk must not end the connection');
    }finally{f.sdk.close();}
  }
});

test('a page with more rows than the client asked for is still rejected',async()=>{
  // A server that ignores `limit` (43 rows on a 30-row page) is a protocol error, not a directory.
  const f=fixture({ignoreLimit:true});
  for(let i=0;i<40;i++){const id='T'+i;f.server.threads[id]={id,project_id:'p',title:id,archived:false,running:false}}
  try{
    await f.sdk.connect();
    // A protocol error on the first walk suspends the connection; it is never left online.
    await until(()=>f.states.includes('suspended')||f.states.includes('retrying'));
    assert.equal(f.sdk.isCatalogueReady,false);
  }finally{f.sdk.close();}
});

test('a failed background walk reconnects instead of leaving a stale online state',async()=>{
  const f=fixture();
  try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    f.setFailWalk(true);
    f.sockets.at(-1).drop();
    await until(()=>f.sockets.length>=3);
    assert.ok(f.states.includes('retrying'),'the failed walk ends that connection');
    f.setFailWalk(false);
    await until(()=>f.sdk.connectionState==='online'&&f.walks().length>=4);
    assert.equal(f.sdk.isCatalogueReady,true);
  }finally{f.sdk.close();}
});
