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
  let available=['A','B'], holdWatch=false, onChange=()=>{};
  const sdk=new LivePageClient({token:()=> 'synthetic',livenessMs:50,backoffMs:[5],onChange:()=>onChange(),
    http:{async download(path){paths.push(['GET',path]);return {status:200,body:new TextEncoder().encode('image bytes')};},
    async downloadFile(path,_token,destination,_signal,onProgress){paths.push(['FILE',path,destination]);onProgress?.(5,11);onProgress?.(11,11);return {status:200,size:11};},
    async uploadFile(path,_token,name,file){paths.push(['UPLOAD',path,file.uri]);const thread=path.split('/')[3];return {status:201,body:{attachment:{id:'att_up',thread_id:thread,name,mime:'video/mp4',size:file.size}}};},
    async request(method,path,_token,body,signal){
      paths.push([method,path]);
      if(path==='/v1/capabilities')return {status:200,body:{protocol:1,history_latest:true,history_full:true,history_around:true,attachment_origin:true,message_send_identity:true,open_session_live:true}};
      if(method==='POST'&&path==='/v1/channels/p/threads'){available=[...available,body.client_thread_id];return {status:201,body:{thread:{id:body.client_thread_id,project_id:'p',title:body.title,archived:false}}};}
      if(path.startsWith('/v1/catalogue'))return {status:200,body:{items:[{kind:'channel',value:{id:'p',name:'P'}},...available.map(id=>({kind:'session',value:{id,project_id:'p',title:id,archived:false,running:false}}))],next_after:null}};
      const id=path.split('/')[3];
      if(path.includes('/messages')){
        const gate=gates.get(id); if(gate){gates.delete(id);await gate.promise;}
        const query=new URL('https://fixture.test'+path).searchParams;
        let result=rows[id]??[];
        if(query.has('ref_seq'))result=result.filter(row=>row.ref_seq===Number(query.get('ref_seq')));
        else if(query.has('after_ref_seq'))result=result.filter(row=>row.ref_seq>Number(query.get('after_ref_seq')));
        if(query.has('ref_seq')&&!result.length||query.has('around_ref_seq')&&!result.some(row=>row.ref_seq===Number(query.get('around_ref_seq'))))return {status:404,body:{}};
        return {status:200,body:{messages:result,complete:true,older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      }
      if(path.endsWith('/live-state')){const gate=statusGates.get(id);if(gate){statusGates.delete(id);await gate.promise;}return {status:200,body:{thread_id:id,active_receipts:[],pending_interactions:[]}};}
      throw new Error('unexpected '+path);
    }},
    socket:{async connect(){let listener,closeListener,closed=false;const pending=[], watches=new Map();
      const socket={sent:[],watches,get closed(){return closed},emit(frame){const data=typeof frame==='string'?frame:JSON.stringify(frame);if(listener)listener(data);else pending.push(data)},onMessage(fn){listener=fn;pending.splice(0).forEach(fn)},onClose(fn){closeListener=fn},send(data){this.sent.push(data);if(data==='ping'){queueMicrotask(()=>this.emit('pong'));return;}const command=JSON.parse(data);if(command.mode==='remove'){if(watches.get(command.thread_id)===command.request_id)watches.delete(command.thread_id);return;}if(!command.mode)watches.clear();if(command.thread_id)watches.set(command.thread_id,command.request_id);if(!holdWatch)queueMicrotask(()=>this.emit({...command,type:'watching'}))},close(){if(!closed){closed=true;closeListener?.()}}};
      sockets.push(socket);queueMicrotask(()=>socket.emit({type:'hello',protocol:1,open_session_live:true,multi_session_live:multi}));return socket;
    }}});
  const watch=id=>sockets.find(s=>!s.closed&&s.watches.has(id));
  const hint=id=>{const socket=watch(id);socket.emit({thread_id:id,request_id:socket.watches.get(id),type:'conversation_changed'});};
  return {sdk,sockets,paths,rows,gates,statusGates,watch,hint,holdWatch:value=>{holdWatch=value;},onChange:fn=>{onChange=fn;},remove:id=>{available=available.filter(value=>value!==id);for(const s of sockets.filter(s=>!s.closed))s.emit({type:'directory_changed'});}};
}

test('sender labels survive initial history, live refresh and reconnect; invalid metadata drops only itself', async () => {
  const f = fixture();
  try {
    f.rows.A = [{ id: 'a1', ref_seq: 1, role: 'user', text: '[Alice] one', sender: 'Alice' }];
    await f.sdk.connect(); await until(() => f.sdk.isCatalogueReady);
    const page = f.sdk.acquirePage('A'); await page.openConversation('A');
    assert.equal(page.messages.get('A')[0].sender, 'Alice');
    f.rows.A.push({ id: 'a2', ref_seq: 2, role: 'user', text: '[bad name] two', sender: 'bad name' },
      { id: 'a3', ref_seq: 3, role: 'user', text: '[Bob] three', sender: 'Bob' });
    f.hint('A'); await until(() => page.messages.get('A')?.length === 3);
    assert.deepEqual(page.messages.get('A').map(m => m.sender), ['Alice', undefined, 'Bob']);
    f.sdk.suspendConnection();
    f.rows.A.push({ id: 'a4', ref_seq: 4, role: 'user', text: '[legacy] four' });
    await f.sdk.connect(); await until(() => page.messages.get('A')?.length === 4);
    assert.deepEqual(page.messages.get('A').map(m => m.sender), ['Alice', undefined, 'Bob', undefined]);
  } finally { f.sdk.close(); }
});

test('A and B live simultaneously; covered A updates, B release keeps A exact objects and boundaries',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A');await a.openConversation('A');const key=a.currentConversationKey, original=a.messages.get('A')[0], cursor=a.currentOlderCursor;
    const b=f.sdk.acquirePage('B');await b.openConversation('B');
    await assert.rejects(b.openConversation('B',999),error=>error.status===404);
    assert.equal(f.sdk.connectionState,'online');assert.equal(f.sockets[0].closed,false);
    assert.equal(a.messages.get('A')[0],original);await b.openConversation('B');
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

test('accepted echo enters an opening page before its watch is acknowledged',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    f.holdWatch(true);
    const a=f.sdk.acquirePage('A');void a.openConversation('A').catch(()=>{});
    await until(()=>f.watch('A'));
    // A new Thread's first send can be acknowledged before the watch: the
    // outbox retires its copy then, so the open page must keep the input.
    const receipt={id:'r',thread_id:'A',client_message_id:'input',durable:true,ref_seq:9,state:'queued'};
    f.sdk.rememberAcceptedInput('A','input','original',[],1,receipt);
    assert.equal(a.messages.get('A')?.at(-1)?.client_message_id,'input');
  }finally{f.sdk.close();}
});

test('a Thread this client just created shows at once; the watch and history read still follow',async()=>{
  const f=fixture();try{
    await f.sdk.createThread('p','New topic','th_fresh');
    const history=deferred();f.gates.set('th_fresh',history);
    const page=f.sdk.acquirePage('th_fresh');let shown=0;
    const opening=page.openConversation('th_fresh',undefined,undefined,()=>shown++);
    await tick();
    assert.equal(shown,1,'content is ready before the history read returns');
    await until(()=>f.paths.some(([,p])=>p.includes('/th_fresh/messages')));
    history.resolve();await opening;assert.equal(shown,1);
    // Only the first open is instant; a later open, or an existing Thread, waits for history.
    f.sdk.releasePage('th_fresh',page);
    const again=f.sdk.acquirePage('th_fresh');const gate=deferred();f.gates.set('th_fresh',gate);let later=0;
    const reopening=again.openConversation('th_fresh',undefined,undefined,()=>later++);
    await tick();assert.equal(later,0);gate.resolve();await reopening;assert.equal(later,1);
  }finally{f.sdk.close();}
});

test('attachment bytes download while a reconnect waits for the watch ack; ownership still applies',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A');await a.openConversation('A');
    f.holdWatch(true);f.sockets[0].close();
    await until(()=>f.sockets.length===2&&f.sockets[1].watches.has('A'));
    // The page keeps its content, and history reads still wait for the watch ack.
    assert.equal(a.messages.get('A')[0].text,'A');
    await assert.rejects(a.history('A'),/Conversation is not open/);
    assert.equal(new TextDecoder().decode(await a.download('A','att1')),'image bytes');
    await assert.rejects(a.download('B','att2'),/Conversation is not open/);
    f.sdk.releasePage('A',a);
    await assert.rejects(a.download('A','att1'),/Conversation is not open/);
  }finally{f.sdk.close();}
});

test('file transfers go through the page that owns the conversation',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A');await a.openConversation('A');
    const progress=[];
    assert.equal(await f.sdk.downloadFile('A','att1','file:///cache/one',undefined,(done,total)=>progress.push([done,total])),11);
    assert.deepEqual(progress,[[5,11],[11,11]],'progress passes through the live page client');
    assert.deepEqual(f.paths.find(p=>p[0]==='FILE'),['FILE','/v1/threads/A/attachments/att1','file:///cache/one']);
    await assert.rejects(f.sdk.downloadFile('B','att2','file:///cache/two'),/Conversation page is not alive/);
    const uploaded=await f.sdk.uploadFile('A','clip.mp4',{uri:'file:///cache/clip.mp4',size:42});
    assert.equal(uploaded.size,42);assert.equal(f.sdk.attachments.get('att_up')?.thread_id,'A');
    f.sdk.releasePage('A',a);
    await assert.rejects(a.downloadFile('A','att1','file:///cache/three'),/Conversation is not open/);
  }finally{f.sdk.close();}
});

test('a new message and its attachment reach the account mirror in the same change',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.isCatalogueReady);
    const a=f.sdk.acquirePage('A');await a.openConversation('A');
    // The desktop main process reads attachments from the account mirror when
    // the renderer asks for an image, so a listed message must have its attachment there.
    const missing=[];
    f.onChange(()=>{for(const row of f.sdk.messages.get('A')??[])for(const item of row.attachments??[])if(!f.sdk.attachments.has(item.id))missing.push(item.id);});
    f.rows.A.push({id:'a3',ref_seq:3,role:'assistant',text:'image',attachments:[{id:'att-new',thread_id:'A',state:'available',name:'chart.png',mime:'image/png',size:11,receipt_id:null}]});
    f.hint('A');
    await until(()=>f.sdk.messages.get('A')?.length===2);
    assert.deepEqual(missing,[]);
    assert.equal(f.sdk.attachments.get('att-new')?.name,'chart.png');
  }finally{f.sdk.close();}
});
