import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/livePages.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LivePageClient}=module.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async predicate=>{const end=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<end,'condition timed out');await tick();}};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(multi=true){
  const sockets=[], paths=[], gates=new Map(), statusGates=new Map(), rows={A:[{id:'a1',ref_seq:1,role:'assistant',text:'A'}],B:[{id:'b2',ref_seq:2,role:'assistant',text:'B'}]};
  let available=['A','B'];
  const sdk=new LivePageClient({token:()=> 'synthetic',livenessMs:50,backoffMs:[5],onChange:()=>{},
    http:{async request(method,path,_token,body,signal){
      paths.push([method,path]);
      if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true,history_latest:true,message_send_identity:true,open_session_live:true}};
      if(path.startsWith('/v1/catalogue'))return {status:200,body:{items:[{kind:'channel',value:{id:'p',name:'P'}},...available.map(id=>({kind:'session',value:{id,project_id:'p',title:id,archived:false,running:false}}))],next_after:null}};
      const id=path.split('/')[3];
      if(path.includes('/messages')){
        const gate=gates.get(id); if(gate){gates.delete(id);await gate.promise;}
        const query=new URL('https://fixture.test'+path).searchParams;
        let result=rows[id]??[];
        if(query.has('ref_seq'))result=result.filter(row=>row.ref_seq===Number(query.get('ref_seq')));
        else if(query.has('after_ref_seq'))result=result.filter(row=>row.ref_seq>Number(query.get('after_ref_seq')));
        return {status:200,body:{messages:result,older_cursor:'before:'+id,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      }
      if(path.endsWith('/live-state')){const gate=statusGates.get(id);if(gate){statusGates.delete(id);await gate.promise;}return {status:200,body:{thread_id:id,active_receipts:[],pending_interactions:[]}};}
      throw new Error('unexpected '+path);
    }},
    socket:{async connect(){let listener,closeListener,closed=false;const pending=[], watches=new Map();
      const socket={sent:[],watches,get closed(){return closed},emit(frame){const data=typeof frame==='string'?frame:JSON.stringify(frame);if(listener)listener(data);else pending.push(data)},onMessage(fn){listener=fn;pending.splice(0).forEach(fn)},onClose(fn){closeListener=fn},send(data){this.sent.push(data);if(data==='ping'){queueMicrotask(()=>this.emit('pong'));return;}const command=JSON.parse(data);if(command.mode==='remove'){if(watches.get(command.thread_id)===command.request_id)watches.delete(command.thread_id);return;}if(!command.mode)watches.clear();if(command.thread_id)watches.set(command.thread_id,command.request_id);queueMicrotask(()=>this.emit({...command,type:'watching'}))},close(){if(!closed){closed=true;closeListener?.()}}};
      sockets.push(socket);queueMicrotask(()=>socket.emit({type:'hello',protocol:1,open_session_live:true,multi_session_live:multi}));return socket;
    }}});
  const watch=id=>sockets.find(s=>!s.closed&&s.watches.has(id));
  const hint=id=>{const socket=watch(id);socket.emit({thread_id:id,request_id:socket.watches.get(id),type:'conversation_changed'});};
  return {sdk,sockets,paths,rows,gates,statusGates,watch,hint,remove:id=>{available=available.filter(value=>value!==id);for(const s of sockets.filter(s=>!s.closed))s.emit({type:'directory_changed'});}};
}

test('A and B live simultaneously; covered A updates, B release keeps A exact objects and boundaries',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A');await a.openConversation('A');const key=a.currentConversationKey, original=a.messages.get('A')[0], cursor=a.currentOlderCursor;
    const b=f.sdk.acquirePage('B');await b.openConversation('B');
    const unchanged=a.messages.get('A');await a.history('A');assert.equal(a.messages.get('A'),unchanged);
    assert.equal(a.channels,f.sdk.channels);assert.equal(b.threads,f.sdk.threads);
    assert.equal(f.sockets.length,1);assert.equal(f.paths.filter(([,p])=>p==='/v1/capabilities').length,1);assert.equal(f.paths.filter(([,p])=>p.startsWith('/v1/catalogue')).length,1);
    assert.equal(f.sdk.acquirePage('A'),a);assert.deepEqual(f.sdk.openedPageIds,['A','B']);assert.equal(a.messages.get('A')[0],original);
    f.rows.A.push({id:'a3',ref_seq:3,role:'assistant',text:'new in covered A'});f.hint('A');
    f.rows.B.push({id:'b4',ref_seq:4,role:'assistant',text:'new in B'});f.hint('B');
    await until(()=>a.messages.get('A')?.length===2&&b.messages.get('B')?.length===2);
    assert.equal(f.sdk.messages.get('A'),a.messages.get('A'));assert.equal(f.sdk.messages.get('B'),b.messages.get('B'));
    f.sdk.releasePage('B',b);assert.deepEqual(f.sdk.openedPageIds,['A']);assert.equal(b.messages.size,0);assert.equal(f.watch('B'),undefined);
    assert.equal(a.currentConversationKey,key);assert.equal(a.currentOlderCursor,cursor);assert.equal(a.messages.get('A')[0],original);
    assert.ok(f.paths.every(([,p])=>!p.includes('/stop')&&!p.includes('/sync')));
  }finally{f.sdk.close();}
});

test('history and state start together; content can render before state without inventing receipts',async()=>{
  const f=fixture();try{
    const history=deferred(),status=deferred();f.gates.set('A',history);f.statusGates.set('A',status);
    const a=f.sdk.acquirePage('A');let shown=0,ready=false;
    const opening=a.openConversation('A',undefined,undefined,()=>shown++).then(()=>{ready=true;});
    await until(()=>f.paths.some(([,p])=>p.endsWith('/A/live-state'))&&f.paths.some(([,p])=>p.includes('/A/messages')));
    assert.equal(shown,0);history.resolve();await until(()=>shown===1);
    assert.equal(a.messages.get('A')[0].text,'A');assert.equal(a.receipts.size,0);assert.equal(a.interactions.size,0);assert.equal(ready,false);
    let returned=0;const same=a.openConversation('A',undefined,undefined,()=>returned++);
    assert.equal(returned,1,'returning to content-ready page does not wait for state');
    status.resolve();await opening;assert.equal(shown,1);
    await same;
  }finally{f.sdk.close();}
});

test('background retains every page and reconnect reconciles them without latest reset or duplicate sockets',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A'),b=f.sdk.acquirePage('B');await Promise.all([a.openConversation('A'),b.openConversation('B')]);
    const key=a.currentConversationKey, original=a.messages.get('A')[0];f.sdk.suspendConnection();
    assert.equal(a.messages.get('A')[0],original);assert.equal(b.messages.get('B').length,1);assert.ok(f.sockets.every(s=>s.closed));
    const count=f.paths.length;await new Promise(r=>setTimeout(r,70));assert.equal(f.paths.length,count);
    f.rows.A.push({id:'a3',ref_seq:3,role:'assistant',text:'offline A'});f.rows.B.push({id:'b4',ref_seq:4,role:'assistant',text:'offline B'});
    await f.sdk.connect();await until(()=>a.messages.get('A')?.length===2&&b.messages.get('B')?.length===2);
    assert.equal(a.currentConversationKey,key);assert.equal(a.messages.get('A')[0],original);assert.equal(f.sockets.filter(s=>!s.closed).length,1);
    assert.ok(f.paths.slice(count).filter(([,p])=>p.includes('/messages')).every(([,p])=>!p.includes('latest=true')));
  }finally{f.sdk.close();}
});

test('late removed-page responses and stale owners cannot resurrect or release a fresh page',async()=>{
  const f=fixture();try{
    const gate=deferred();f.gates.set('A',gate);const a=f.sdk.acquirePage('A'),pending=a.openConversation('A');void pending.catch(()=>{});
    await until(()=>f.paths.some(([,p])=>p.includes('/A/messages')));f.sdk.releasePage('A',a);
    const fresh=f.sdk.acquirePage('A');await fresh.openConversation('A');f.sdk.releasePage('A',a);assert.equal(f.sdk.page('A'),fresh);
    gate.resolve();await tick();assert.equal(a.messages.size,0);assert.equal(f.sdk.page('A'),fresh);
    await assert.rejects(pending,/aborted/);f.sdk.close();assert.equal(f.sdk.messages.size,0);assert.deepEqual(f.sdk.openedPageIds,[]);
  }finally{f.sdk.close();}
});

test('authoritative removal releases only the invalid page subscription',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A'),b=f.sdk.acquirePage('B');await Promise.all([a.openConversation('A'),b.openConversation('B')]);
    const row=b.messages.get('B')[0];f.remove('A');
    await until(()=>!f.sdk.page('A'));
    assert.equal(a.messages.size,0);assert.equal(f.watch('A'),undefined);
    assert.equal(b.messages.get('B')[0],row);assert.equal(f.sdk.page('B'),b);
  }finally{f.sdk.close();}
});

test('accepted echo enters the exact live page only; removed page has no transcript',async()=>{
  const f=fixture();try{
    const a=f.sdk.acquirePage('A'),b=f.sdk.acquirePage('B');await Promise.all([a.openConversation('A'),b.openConversation('B')]);
    const receipt={id:'r',thread_id:'A',client_message_id:'input',durable:true,ref_seq:9,state:'queued'};
    f.sdk.rememberAcceptedInput('A','input','original',[],1,receipt);
    assert.equal(a.messages.get('A').at(-1).client_message_id,'input');assert.ok(b.messages.get('B').every(row=>row.client_message_id!=='input'));
    f.sdk.releasePage('A');f.sdk.rememberAcceptedInput('A','input','original',[],1,receipt);assert.equal(f.sdk.messages.has('A'),false);
  }finally{f.sdk.close();}
});
