import test from 'node:test';
import { withPages } from './page-fixture.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const root=new URL('../../../',import.meta.url).pathname;
const bundle=await build({stdin:{resolveDir:root,contents:'export {DesktopConnectionService} from "./apps/desktop/src/main/connection-service";'},bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {DesktopConnectionService}=mod.exports;
const rows=(start,end)=>Array.from({length:end-start+1},(_,i)=>({id:'m'+(start+i),ref_seq:start+i,role:'assistant',text:'synthetic '+(start+i)}));
function fixture(){
 const published=[],calls=[],server=new Map([['a',rows(1,1000)],['b',rows(1,5)]]);
 const service=new DesktopConnectionService(value=>published.push(value));service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24)};
 service.client={channels:new Map([['p',{id:'p',name:'P'}]]),threads:new Map([['a',{id:'a',project_id:'p',title:'A',running:false}],['b',{id:'b',project_id:'p',title:'B',running:true}]]),messages:new Map(),receipts:new Map(),attachments:new Map(),interactions:new Map(),supportsLatest:true,isCatalogueReady:true,
 isThreadAvailable(id){return this.threads.has(id);},closeConversation(){this.messages.clear();this.receipts.clear();this.attachments.clear();this.interactions.clear();this.currentThreadId=null;},
 async openConversation(id){this.closeConversation();this.currentThreadId=id;await this.load(id);},
 async load(id){calls.push(['open',id]);this.messages.set(id,server.get(id).slice(-50));this.currentOlderCursor=id==='a'?'older':null;},
 async loadFullHistory(id){calls.push(['all',id]);this.messages.set(id,server.get(id));this.currentOlderCursor=null;},
 async historyWindow(id,before){calls.push(['older',id,before]);const page=server.get(id).slice(-100,-50);this.messages.set(id,[...page,...this.messages.get(id)]);return {messages:page,older_cursor:null};},close(){this.closeConversation();}};
 withPages(service.client);return {service,published,calls,server};
}
test('covered pages retain distinct timelines until actual removal',async()=>{
 const {service}=fixture();await service.selectThread('a');assert.equal(service.snapshot().messages.length,50);await service.selectThread('b');assert.deepEqual([...service.client.messages.keys()],['a','b']);assert.equal(service.snapshot().sessionPages.length,2);assert.equal(service.snapshot().messages.length,5);service.close();assert.equal(service.client.messages.size,0);
});
test('return to existing tab preserves both older windows without reopening',async()=>{
 const {service,calls}=fixture();await service.selectThread('a');await service.loadOlder();assert.equal(service.snapshot().messages[0].refSeq,1);await service.selectThread('b');await service.selectThread('a');assert.equal(service.snapshot().messages[0].refSeq,1);assert.deepEqual(calls.filter(x=>x[0]==='open').map(x=>x[1]),['a','b']);assert.deepEqual([...service.client.messages.keys()],['a','b']);service.close();
});
test('channel selection preserves open tabs without body reads',async()=>{
 const {service,calls}=fixture();await service.selectThread('a');const count=calls.length;await service.selectChannel('p');assert.equal(calls.length,count);assert.equal(service.client.messages.size,1);assert.equal(service.snapshot().selectedThreadId,'a');service.close();
});
test('explicit close removes only that page, preserves other history and leaves local drafts alone',async()=>{
 const {service}=fixture();await service.selectThread('a');await service.loadOlder();await service.selectThread('b');
 const a=service.client.messages.get('a');service.closeSessionPage('b');
 assert.equal(service.snapshot().selectedThreadId,'a');assert.equal(service.client.messages.get('a'),a);
 assert.deepEqual(service.snapshot().sessionPages.map(p=>p.id),['a']);
 service.closeSessionPage('a');assert.equal(service.snapshot().selectedThreadId,undefined);assert.equal(service.client.messages.size,0);service.close();
});
test('destroying window pages clears all content but account remains usable for a fresh window',async()=>{
 const {service}=fixture();await service.selectThread('a');await service.selectThread('b');const client=service.client;
 service.closeSessionPages();assert.equal(service.client,client);assert.equal(client.messages.size,0);
 assert.equal(service.pageStates.size,0);assert.equal(service.snapshot().sessionPages.length,0);
 await service.selectThread('a');assert.equal(service.snapshot().selectedThreadId,'a');assert.equal(service.snapshot().messages.length,50);service.close();
});
test('closing a covered page preserves the selected page and its exact row objects',async()=>{
 const {service}=fixture();await service.selectThread('a');await service.selectThread('b');const b=service.client.messages.get('b');
 service.closeSessionPage('a');assert.equal(service.snapshot().selectedThreadId,'b');assert.equal(service.client.messages.get('b'),b);
 assert.deepEqual(service.snapshot().sessionPages.map(p=>p.id),['b']);service.close();
});
test('directory running state needs no cached receipts and has no unread count',()=>{
 const {service}=fixture();assert.equal(service.snapshot().threads.find(x=>x.id==='b').running,true);assert.ok(service.snapshot().threads.every(x=>!('unreadCount' in x)));assert.equal(service.client.receipts.size,0);service.close();
});
test('desktop build and service have no SQLite worker or checkpoint ownership',async()=>{
 for(const path of ['src/main/connection-service.ts','build.mjs']){const source=await readFile(new URL('../'+path,import.meta.url),'utf8');assert.doesNotMatch(source,/ProjectionCacheWorker|SQLite|onCheckpoint|restoreCheckpoint|cache-worker/);} });
