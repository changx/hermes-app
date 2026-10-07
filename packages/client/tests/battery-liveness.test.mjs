import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/livePages.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LivePageClient}=module.exports;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,limit=2000)=>{const end=Date.now()+limit;while(!fn()){assert.ok(Date.now()<end,'condition timed out');await pause(1);}};

/** Real SDK with a synthetic socket: records pings, answers pong unless `silent`. */
function fixture({livenessMs=40,idleLivenessMs=160,backoffMs=[5],backoffJitter,failFirst=0,status=503,retryAfterMs}={}){
  const pings=[],schedules=[],sockets=[],caps=[];let failures=failFirst;const control={silent:false};
  const sdk=new LivePageClient({token:()=> 'synthetic',livenessMs,idleLivenessMs,backoffMs,backoffJitter,onRetryScheduled:at=>schedules.push({at,now:Date.now()}),
    http:{async request(_m,path){
      if(path==='/v1/capabilities'){caps.push(Date.now());if(failures>0){failures--;return {status,body:{},retryAfterMs};}return {status:200,body:{protocol:1,durable_sync:true,open_session_live:true}};}
      return {status:200,body:{items:[{kind:'channel',value:{id:'p',name:'P'}}],next_after:null}};}},
    socket:{async connect(){let message,close,closed=false;const s={onMessage(fn){message=fn;queueMicrotask(()=>message(JSON.stringify({type:'hello',protocol:1,open_session_live:true,multi_session_live:true})));},onClose(fn){close=fn;},
      send(data){if(data!=='ping')return;pings.push(Date.now());if(!control.silent)queueMicrotask(()=>{if(!closed)message('pong')});},close(){if(!closed){closed=true;close?.();}}};sockets.push(s);return s;}}});
  return {sdk,pings,schedules,sockets,caps,control};
}
const gaps=list=>list.slice(1).map((at,i)=>at-list[i]);

test('active liveness keeps the configured interval; idle stretches it',async()=>{
  const f=fixture();try{
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    await until(()=>f.pings.length>=3);
    for(const gap of gaps(f.pings))assert.ok(gap>=35&&gap<120,`active gap ${gap}`);
    f.sdk.setLivenessIdle(true);assert.equal(f.sdk.isLivenessIdle,true);
    const start=f.pings.length;await until(()=>f.pings.length>=start+3,3000);
    const idle=gaps(f.pings.slice(start));
    for(const gap of idle)assert.ok(gap>=150,`idle gap ${gap}`);
  }finally{f.sdk.close();}
});

test('leaving idle brings the next ping forward to the active interval',async()=>{
  const f=fixture({idleLivenessMs:2000});try{
    f.sdk.setLivenessIdle(true);
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    await pause(60);assert.equal(f.pings.length,0,'idle waits the longer interval');
    f.sdk.setLivenessIdle(false);
    await until(()=>f.pings.length>=1,200);
  }finally{f.sdk.close();}
});

test('idle pong deadline stays at the active interval',async()=>{
  const f=fixture({idleLivenessMs:100});try{
    f.sdk.setLivenessIdle(true);
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    f.control.silent=true;
    await until(()=>f.pings.length>=1,500);const sent=f.pings[0];
    await until(()=>f.sdk.connectionState==='retrying',500);
    const detected=Date.now()-sent;assert.ok(detected<100,`missing pong detected after ${detected}ms`);
  }finally{f.sdk.close();}
});

test('a network change probes an open socket at once',async()=>{
  const f=fixture({idleLivenessMs:5000,livenessMs:3000});try{
    f.sdk.setLivenessIdle(true);
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');
    f.control.silent=true;
    f.sdk.acquirePage('t').networkChanged();
    assert.equal(f.pings.length,1);
    f.sdk.networkChanged();assert.equal(f.pings.length,1,'one probe while waiting for pong');
  }finally{f.sdk.close();}
});

test('a network change ends an ordinary backoff and restarts the schedule',async()=>{
  const f=fixture({backoffMs:[5000],failFirst:1});try{
    await f.sdk.connect();await until(()=>f.sdk.connectionState==='retrying'&&f.sdk.nextRetryAt!==null);
    assert.ok(f.sdk.nextRetryAt-Date.now()>4000);
    f.sdk.networkChanged();
    await until(()=>f.sdk.connectionState==='online',1000);
    assert.equal(f.caps.length,2);
  }finally{f.sdk.close();}
});

test('a network change never shortens a server Retry-After wait',async()=>{
  const f=fixture({backoffMs:[5],failFirst:1,status:429,retryAfterMs:150});try{
    const started=Date.now();
    await f.sdk.connect();await until(()=>f.sdk.nextRetryAt!==null);
    f.sdk.networkChanged();await pause(40);assert.equal(f.caps.length,1);
    await until(()=>f.sdk.connectionState==='online');assert.ok(Date.now()-started>=145);
  }finally{f.sdk.close();}
});

test('backoff jitter stays within the configured spread',async()=>{
  const f=fixture({backoffMs:[400],backoffJitter:0.2,failFirst:1});try{
    await f.sdk.connect();await until(()=>f.schedules.some(s=>s.at!==null));
    const s=f.schedules.find(s=>s.at!==null);const delay=s.at-s.now;
    assert.ok(delay>=315&&delay<=485,`jittered delay ${delay}`);
  }finally{f.sdk.close();}
});

test('suspend during a wakeable backoff stays suspended',async()=>{
  const f=fixture({backoffMs:[5000],failFirst:3});try{
    await f.sdk.connect();await until(()=>f.sdk.nextRetryAt!==null);
    f.sdk.suspendConnection();f.sdk.networkChanged();await pause(40);
    assert.equal(f.sdk.connectionState,'suspended');assert.equal(f.caps.length,1);
  }finally{f.sdk.close();}
});
