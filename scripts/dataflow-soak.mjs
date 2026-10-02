// Bounded real HTTP/WS + real SQLite-worker soak. Server messages are explicit
// synthetic fixtures, not a Hermes model run or a production-latency benchmark.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {HermesClient} from '../packages/client/dist/index.js';
import {desktopTransport} from '../tests/client/desktop/transport.mjs';
const require=createRequire(import.meta.url),WS=require('ws');
const root=resolve(new URL('..',import.meta.url).pathname);
const bundled=await build({stdin:{resolveDir:root,contents:'export {ProjectionCacheWorker} from "./apps/desktop/src/main/projection-cache-worker"; export {DesktopConnectionService} from "./apps/desktop/src/main/connection-service"; export {snapshotDelta} from "./apps/desktop/src/shared/snapshot-delta"; export {DesktopSnapshotStore} from "./apps/desktop/src/renderer/desktop-store-core";'},bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,module,module.exports);
const {ProjectionCacheWorker,DesktopConnectionService,snapshotDelta,DesktopSnapshotStore}=module.exports;
const rounds=Number(process.env.HERMES_DATAFLOW_SOAK_ROUNDS||300),interval=Number(process.env.HERMES_DATAFLOW_SOAK_INTERVAL_MS||200);
assert.ok(Number.isSafeInteger(rounds)&&rounds>=10&&rounds<=1000);assert.ok(interval>=0&&interval<=1000);
const directory=await mkdtemp(join(tmpdir(),'core-dataflow-soak-'));
const sessions=Array.from({length:100},(_,i)=>'session-'+i),history=new Map(),active=new Map(),receipts=new Map(),readRefs=new Map(),events=[];
let ref=0,httpRequests=0,summaryRequests=0,connections=0,expiries=0,disconnects=0,notifications=0,ipcBytes=0,selectionCount=0,resyncs=0;
const tokens=new Set(['synthetic-soak-a','synthetic-soak-b']);
for(const id of sessions)history.set(id,[{id:'m'+(++ref),ref_seq:ref,role:'assistant',text:'Synthetic seed '+id}]);
const cursor=n=>'c'+n;
const summary=id=>({id,project_id:'p',title:id,archived:0,last_ref:history.get(id).at(-1).ref_seq,read_ref:readRefs.get(id)||0,unread_count:history.get(id).filter(m=>m.ref_seq>(readRefs.get(id)||0)).length,active_receipts:active.has(id)?[active.get(id)]:[]});
let wsServer,expireOnce=false;
const emit=(kind,id,record,version=1)=>{
  const n=events.length+1,event={type:'event',event_id:n,cursor:cursor(n),kind,thread_id:id,ref:String(record),version};events.push(event);
  for(const socket of wsServer.clients)if(socket.readyState===WS.OPEN)socket.send(JSON.stringify(event));
};
const server=createServer(async(request,response)=>{
  httpRequests++;const auth=(request.headers.authorization||'').replace(/^Bearer /,'');
  const reply=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body))};
  if(!tokens.has(auth))return reply(401,{});
  const url=new URL(request.url,'http://localhost'),path=url.pathname;
  if(path==='/v1/capabilities')return reply(200,{protocol:1,durable_sync:true,history_latest:true});
  if(path==='/v1/channels')return reply(200,{channels:[{id:'p',name:'Synthetic soak'}]});
  if(path==='/v1/snapshot'){summaryRequests++;return reply(200,{threads:sessions.map(summary),waterline:cursor(events.length),next_after:null})}
  if(path==='/v1/sync'){
    if(expireOnce&&auth==='synthetic-soak-a'){expireOnce=false;expiries++;return reply(410,{code:'cursor_expired'})}
    const start=Number((url.searchParams.get('cursor')||'c0').slice(1)),page=events.slice(start,start+200);
    return reply(200,{events:page,waterline:cursor(events.length),next_cursor:page.at(-1)?.cursor||cursor(start),has_more:start+page.length<events.length});
  }
  const id=path.split('/')[3];
  if(path.endsWith('/messages')&&history.has(id)){
    const list=history.get(id),limit=Number(url.searchParams.get('limit')||50),before=url.searchParams.get('before');
    if(url.searchParams.get('latest')==='true'||before){const eligible=before?list.filter(m=>m.ref_seq<Number(before.slice(2))):list,page=eligible.slice(-limit);return reply(200,{messages:page,older_cursor:eligible.length>page.length?'b:'+page[0].ref_seq:null})}
    const threshold=url.searchParams.has('after')?Number(url.searchParams.get('after').slice(2)):Number(url.searchParams.get('after_ref_seq')||0),eligible=list.filter(m=>m.ref_seq>threshold),page=eligible.slice(0,limit);
    return reply(200,{messages:page,next_cursor:eligible.length>page.length?'f:'+page.at(-1).ref_seq:null,incomplete_turns:[],turn_outcomes:[]});
  }
  if(path.startsWith('/v1/receipts/'))return reply(200,{receipt:receipts.get(path.split('/')[3])});
  if(path.endsWith('/read')&&history.has(id)){
    let raw='';for await(const chunk of request)raw+=chunk;const value=JSON.parse(raw).ref_seq;
    readRefs.set(id,Math.max(readRefs.get(id)||0,value));emit('read',id,value,events.length+1);
    return reply(200,{ref_seq:readRefs.get(id),unread_count:summary(id).unread_count});
  }
  if(path==='/v1/channels/p/threads')return reply(200,{threads:sessions.map(summary),next_cursor:null});
  return reply(404,{});
});
wsServer=new WS.Server({server,path:'/v1/events'});
wsServer.on('connection',(socket,request)=>{
  if(!tokens.has((request.headers.authorization||'').replace(/^Bearer /,''))){socket.close();return}
  connections++;socket.send(JSON.stringify({type:'hello',protocol:1,durable_sync:true}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,workerPath=join(root,'apps/desktop/dist/main/cache-worker.cjs');
const cache=new ProjectionCacheWorker(join(directory,'a.sqlite'),'a'.repeat(24),workerPath);
let clients=[],lastSnapshot,listener,bridgeStop;
const service=new DesktopConnectionService(snapshot=>{if(lastSnapshot){const delta=snapshotDelta(lastSnapshot,snapshot);ipcBytes+=Buffer.byteLength(JSON.stringify(delta));listener?.(delta)}else listener?.(snapshot);lastSnapshot=snapshot});
service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24)};
const renderer=new DesktopSnapshotStore({getSnapshot:async()=>service.snapshot(),subscribe(fn){listener=fn;return()=>listener=undefined}});
bridgeStop=renderer.subscribe(()=>notifications++);
const errors=[];
clients=[new HermesClient({...desktopTransport(base),token:()=> 'synthetic-soak-a',onCheckpoint:async value=>{await cache.save(value)},onChange:()=>service.changed(),onResync:()=>{resyncs++;void service.refreshSelectedHistory(clients[0])},onError:error=>errors.push(error.name),backoffMs:[10,30,100],livenessMs:500}),new HermesClient({...desktopTransport(base),token:()=> 'synthetic-soak-b',onError:error=>errors.push(error.name),backoffMs:[10,30,100],livenessMs:500})];
service.client=clients[0];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async fn=>{const end=Date.now()+30_000;while(!fn()){if(Date.now()>end)throw Error('soak condition timed out');await wait(20)}};
const started=performance.now(),heapBefore=process.memoryUsage().heapUsed;
try{
  await Promise.all(clients.map(c=>c.connect()));await until(()=>clients.every(c=>c.connectionState==='online'));
  await service.selectThread(sessions[0]);
  for(let round=0;round<rounds;round++){
    for(let i=0;i<20;i++){
      const id=sessions[(round*20+i)%sessions.length];
      if(active.has(id)){const old=active.get(id),done={...old,state:'completed',processing:'completed',version:2};receipts.set(old.id,done);active.delete(id);emit('receipt',id,old.id,2)}
      if(round%2===0){const rid='r_'+round+'_'+i,item={id:rid,client_message_id:'run_'+round+'_'+i,thread_id:id,state:'running',processing:'running',durable:true,version:1};receipts.set(rid,item);active.set(id,item);emit('receipt',id,rid)}
      const message={id:'m'+(++ref),ref_seq:ref,role:'assistant',text:'Synthetic network output '+round+' '+id};history.get(id).push(message);emit('message',id,message.ref_seq);
    }
    if(round===Math.floor(rounds/3)){for(const socket of wsServer.clients)socket.close();disconnects++}
    if(round===Math.floor(rounds*2/3))expireOnce=true;
    if(round%5===0){const id=sessions[round%sessions.length];await service.selectThread(id);selectionCount++;const visible=service.snapshot().messages.at(-1)?.refSeq;if(visible)await clients[0].markRead(id,visible)}
    if(interval)await wait(interval);
  }
  for(const [id,item]of active){const done={...item,state:'completed',processing:'completed',version:2};receipts.set(item.id,done);emit('receipt',id,item.id,2)}active.clear();
  await until(()=>clients.every(c=>c.cursor===cursor(events.length)));
  for(const c of clients)for(const id of sessions){assert.deepEqual(c.messages.get(id).map(m=>m.ref_seq),history.get(id).map(m=>m.ref_seq));assert.equal(c.threads.get(id).read_ref,summary(id).read_ref);assert.equal(c.threads.get(id).unread_count,summary(id).unread_count)}
  await clients[0].catchUp();const saved=await cache.load();assert.equal(saved.cursor,cursor(events.length));
  const cold=new HermesClient({...desktopTransport(base),token:()=> 'synthetic-soak-a'});cold.restoreCheckpoint(saved);assert.equal(cold.messages.size,100);cold.close();
  const view=renderer.getSnapshot();assert.equal(view.selectedThreadId,service.snapshot().selectedThreadId);assert.deepEqual(view.messages,service.snapshot().messages);
  const heapAfter=process.memoryUsage().heapUsed;assert.ok(heapAfter-heapBefore<256*1024*1024);
  console.log(JSON.stringify({scenario:'synthetic fixtures over real HTTP/WS, real SDK/service/delta store and SQLite worker',sessions:sessions.length,rounds,messageRows:[...history.values()].reduce((n,rows)=>n+rows.length,0),events:events.length,httpRequests,summaryRequests,connections,disconnects,expiries,resyncs,selectionCount,notifications,ipcBytes,elapsedMs:Math.round(performance.now()-started),heapBefore,heapAfter,databaseBytes:(await stat(join(directory,'a.sqlite'))).size,result:'passed'}));
}finally{
  service.close();for(const c of clients)c.close();bridgeStop();await cache.close();
  for(const socket of wsServer.clients)socket.terminate();await new Promise(resolve=>wsServer.close(resolve));await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
}
