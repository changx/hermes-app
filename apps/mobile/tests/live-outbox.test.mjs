import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { connection, newSend } from '../src/send.ts';
const config=connection('https://example.test','synthetic-only','live-A');
const makeRecord=()=>newSend(config,'thread','original','mob_123e4567-e89b-12d3-a456-000000000001');
const flush=async()=>{for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));};
class Store { data=new Map(); failRemove=false; async getItemAsync(k){return this.data.get(k)??null;}async setItemAsync(k,v){this.data.set(k,v);}async deleteItemAsync(k){if(this.failRemove)throw Error('disk');this.data.delete(k);} }
function fixture(receiptPatch={}){
 const store=new Store(),calls=[],notices=[];
 const client={messages:new Map(),receipts:new Map(),supportsLatest:true,isCatalogueReady:true,isThreadAvailable:()=>true,
 async send(thread,id,text){calls.push(['send',thread,id,text]);return {id:'r1',thread_id:thread,client_message_id:id,state:'running',processing:'running',durable:true,ref_seq:7,...receiptPatch};},
 async getReceipt(id){calls.push(['receipt',id]);return {id,thread_id:'thread',client_message_id:makeRecord().clientMessageId,state:'unknown',processing:'unknown',durable:true,ref_seq:7,...receiptPatch};},
 async historyTail(){calls.push(['history']);throw Error('must not read body');},rememberAcceptedInput(...args){calls.push(['echo',...args]);}};
 const box=new MobileOutbox(new OutboxStore(store,config),client,(_items,notice)=>{if(notice)notices.push(notice);},()=>1000,()=>0,12000,true);
 return {store,client,calls,box,notices};
}
test('matching durable running ACK retires local original without execution/history polling',async()=>{
 const f=fixture();await f.box.start();f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();
 assert.equal(f.box.records.length,0);assert.deepEqual(f.calls.map(x=>x[0]),['send','echo']);
 for(let i=0;i<100;i++)f.box.reconcile();await flush();assert.equal(f.calls.length,2);await f.box.stop();
});
test('durable unknown execution ACK is reception, never a model rerun',async()=>{
 const f=fixture({state:'unknown',processing:'unknown'});await f.box.start();f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();
 assert.equal(f.box.records.length,0);assert.equal(f.calls.filter(x=>x[0]==='send').length,1);await f.box.stop();
});
test('foreign/non-durable ACK preserves the original and does not clear storage',async()=>{
 for(const patch of [{durable:false},{client_message_id:'other'},{thread_id:'other'}]){const f=fixture(patch);await f.box.start();f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();assert.equal(f.box.records[0].text,'original');assert.equal(f.box.records[0].status,'blocked');assert.ok(f.store.data.size);await f.box.stop();}
});
test('received record without original reference is checked once per reconnect, never periodically sent/read',async()=>{
 const f=fixture({ref_seq:undefined});await f.box.start();f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();
 for(let i=0;i<100;i++)f.box.reconcile();await flush();assert.equal(f.calls.filter(x=>x[0]==='send').length,1);assert.equal(f.calls.filter(x=>x[0]==='receipt').length,0);
 f.box.setConnection('suspended');f.box.setConnection('online');await flush();assert.equal(f.calls.filter(x=>x[0]==='receipt').length,1);assert.equal(f.box.records[0].text,'original');await f.box.stop();
});
test('archive prevents delivery but retains user input',async()=>{
 const f=fixture();f.client.isThreadAvailable=()=>false;await f.box.start();f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();assert.equal(f.calls.length,0);assert.equal(f.box.records[0].status,'blocked');assert.equal(f.box.records[0].text,'original');await f.box.stop();
});
test('failed local cleanup keeps confirmed input; restart retires it without any network calls',async()=>{
 const f=fixture();await f.box.start();f.store.failRemove=true;f.box.setConnection('online');await f.box.enqueue(makeRecord());await flush();assert.equal(f.box.records.length,1);assert.equal(f.box.records[0].receiptRefSeq,7);await f.box.stop();
 f.store.failRemove=false;const next=new MobileOutbox(new OutboxStore(f.store,config),f.client,()=>{},undefined,undefined,undefined,true);await next.start();next.setConnection('online');await flush();assert.equal(next.records.length,0);assert.deepEqual(f.calls.map(x=>x[0]),['send','echo']);await next.stop();
});
