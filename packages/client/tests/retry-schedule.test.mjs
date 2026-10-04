import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/livePages.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LivePageClient}=module.exports;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{const end=Date.now()+2000;while(!fn()){assert.ok(Date.now()<end,'condition timed out');await pause(1);}};
function fixture({status=429,delay=100}={}){
 const requests=[],schedules=[],sockets=[];let first=true;
 const sdk=new LivePageClient({token:()=> 'synthetic',backoffMs:[5],livenessMs:1000,onRetryScheduled:at=>schedules.push(at),
 http:{async request(_m,path){requests.push({path,at:Date.now()});if(path==='/v1/capabilities')return {status:200,body:{protocol:1,durable_sync:true,open_session_live:true}};
 if(first){first=false;return {status,body:{},retryAfterMs:delay};}
 return {status:200,body:{items:[{kind:'channel',value:{id:'p',name:'P'}}],next_after:null}};}},
 socket:{async connect(){let message,close,closed=false;const s={onMessage(fn){message=fn;queueMicrotask(()=>message(JSON.stringify({type:'hello',protocol:1,open_session_live:true,multi_session_live:true})));},onClose(fn){close=fn;},send(){},close(){if(!closed){closed=true;close?.();}}};sockets.push(s);return s;}}});
 return {sdk,requests,schedules,sockets};
}
test('429 catalogue Retry-After is honored and exact schedule clears before reconnect',async()=>{
 const f=fixture();try{await f.sdk.connect();await until(()=>f.sdk.nextRetryAt!==null);const at=f.sdk.nextRetryAt;assert.equal(f.sdk.connectionState,'retrying');assert.equal(f.sdk.acquirePage('A').nextRetryAt,at);assert.deepEqual(f.schedules,[at]);await pause(30);assert.equal(f.sockets.length,1);await until(()=>f.sdk.connectionState==='online');const reads=f.requests.filter(r=>r.path.startsWith('/v1/catalogue'));assert.ok(reads[1].at-reads[0].at>=95);assert.ok(f.requests.filter(r=>r.path==='/v1/capabilities')[1].at>=at-5);assert.equal(f.sdk.nextRetryAt,null);assert.deepEqual(f.schedules,[at,null]);}finally{f.sdk.close();}
});
test('suspend during backoff clears deadline and cancels the pending retry',async()=>{
 const f=fixture({delay:150});try{await f.sdk.connect();await until(()=>f.sdk.nextRetryAt!==null);f.sdk.suspendConnection();assert.equal(f.sdk.nextRetryAt,null);assert.equal(f.sdk.connectionState,'suspended');assert.equal(f.schedules.at(-1),null);await pause(170);assert.equal(f.sockets.length,1);await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');assert.equal(f.sdk.nextRetryAt,null);}finally{f.sdk.close();}
});
for(const status of [401,403,400])test(`HTTP ${status} has no retry schedule or automatic retry`,async()=>{
 const f=fixture({status});try{await f.sdk.connect();await until(()=>['blocked','suspended'].includes(f.sdk.connectionState));assert.equal(f.sdk.connectionState,status===400?'suspended':'blocked');assert.equal(f.sdk.nextRetryAt,null);assert.deepEqual(f.schedules,[]);await pause(20);assert.equal(f.sockets.length,1);}finally{f.sdk.close();}
});
test('ordinary 503 uses the actual configured backoff, not Retry-After metadata',async()=>{
 const f=fixture({status:503,delay:1000});try{await f.sdk.connect();await until(()=>f.sdk.connectionState==='online');assert.equal(f.schedules.length,2);assert.equal(f.schedules[1],null);assert.equal(f.sockets.length,2);}finally{f.sdk.close();}
});
