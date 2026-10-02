import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const root=new URL('../../../',import.meta.url).pathname;
const bundle=await build({stdin:{resolveDir:root,contents:'export {DesktopConnectionService} from "./apps/desktop/src/main/connection-service";'},bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {DesktopConnectionService}=mod.exports;
const messages=(start,end)=>Array.from({length:end-start+1},(_,i)=>({id:'m'+(start+i),ref_seq:start+i,role:'assistant',text:'synthetic '+(start+i)}));
const fixture=()=>{
  const published=[],calls=[];
  const service=new DesktopConnectionService(value=>published.push(value));service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24)};
  service.client={channels:new Map([['p',{id:'p',name:'P'}]]),threads:new Map([['a',{id:'a',project_id:'p',title:'A'}],['b',{id:'b',project_id:'p',title:'B'}]]),messages:new Map([['a',messages(1,1000)],['b',messages(1,5)]]),receipts:new Map(),attachments:new Map(),interactions:new Map(),supportsLatest:true,
    async historyWindow(id,before){calls.push([id,before]);const rows=this.messages.get(id)||[];return {messages:before?rows.slice(-100,-50):rows.slice(-50),older_cursor:before?null:'older'}},close(){}};
  return {service,published,calls};
};

test('switch immediately projects only the latest cached window, without touching connection or another session',async()=>{
  const {service,published}=fixture();let release;
  service.client.historyWindow=async()=>new Promise(resolve=>release=resolve);
  const job=service.selectThread('a');assert.equal(published[0].selectedThreadId,'a');assert.equal(published[0].messages.length,50);
  assert.equal(published[0].messages[0].refSeq,951);assert.equal(service.client.messages.get('a').length,1000);
  release({messages:messages(951,1000),older_cursor:'older'});await job;
  assert.equal(service.snapshot().loadingMessages,false);service.close();
});

test('older window extends presentation only; re-enter starts at latest and cached history is retained',async()=>{
  const {service}=fixture();await service.selectThread('a');await service.loadOlder();
  assert.equal(service.snapshot().messages.length,100);assert.equal(service.snapshot().messages[0].refSeq,901);
  await service.selectThread('b');assert.equal(service.snapshot().messages.length,5);
  await service.selectThread('a');assert.equal(service.snapshot().messages.length,50);assert.equal(service.client.messages.get('a').length,1000);service.close();
});

test('resync refresh preserves an older reading boundary and its pagination cursor',async()=>{
  const {service}=fixture();await service.selectThread('a');await service.loadOlder();
  const boundary=service.visibleStartRef;service.olderCursor='reader-cursor';await service.refreshSelectedHistory(service.client);
  assert.equal(service.visibleStartRef,boundary);assert.equal(service.olderCursor,'reader-cursor');assert.equal(service.snapshot().messages.length,100);service.close();
});

test('sidebar processing outcome overrides stale running lifecycle without affecting unread counts',()=>{
  const {service}=fixture();service.client.threads.get('a').unread_count=3;
  for(const processing of ['completed','failed','interrupted','unknown']) {
    service.client.receipts.set('r',{id:'r',thread_id:'a',state:'running',processing});
    const row=service.snapshot().threads.find(t=>t.id==='a');assert.equal(row.running,false);assert.equal(row.unreadCount,3);
  }
  service.client.receipts.set('r',{id:'r',thread_id:'a',state:'running',processing:'running'});assert.equal(service.snapshot().threads.find(t=>t.id==='a').running,true);service.close();
});

test('cache removal failure is actionable and cannot pretend that forget succeeded',async()=>{
  const {service}=fixture();let deleted=false;
  service.store={async delete(){deleted=true}};service.cache={isClosed:false,async clear(){throw Error('synthetic disk failure')},async close(){}};
  await assert.rejects(service.forgetConnection(),/not confirmed/);assert.equal(deleted,false);assert.match(service.snapshot().errorMessage,/choose Forget connection again/);assert.ok(service.connection);service.close();
});

test('cached selection negotiates capabilities before choosing latest versus legacy history',async()=>{
  const {service,calls}=fixture();service.client.hasCapabilities=false;service.client.supportsLatest=false;
  service.client.capabilities=async()=>{calls.push(['capabilities']);service.client.hasCapabilities=true;service.client.supportsLatest=true};
  service.client.history=async()=>{throw Error('must not select legacy before negotiation')};
  await service.selectThread('a');assert.deepEqual(calls,[['capabilities'],['a',undefined]]);assert.equal(service.snapshot().messages.length,50);service.close();
});

test('late previous-session history never changes active window/loading state or older cursor',async()=>{
  const {service}=fixture();let release;
  service.client.historyWindow=async id=>id==='a'?new Promise(resolve=>release=resolve):{messages:messages(1,5),older_cursor:null};
  const old=service.selectThread('a');await service.selectThread('b');release({messages:messages(901,950),older_cursor:'wrong'});await old;
  const active=service.snapshot();assert.equal(active.selectedThreadId,'b');assert.equal(active.messages.length,5);assert.equal(active.loadingMessages,false);assert.equal(active.canLoadOlder,false);service.close();
});
