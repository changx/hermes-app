import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError, HttpError } from '../dist/index.js';
const settings = {scope:'connected-default',provider:'custom:one',model:'m1',providers:[{id:'custom:one',name:'One',models:['m1','m2']}]};
function fixture(reply) {
 const calls=[];
 const client=new HermesClient({token:()=> 'synthetic-device',socket:{connect:async()=>{throw Error('no socket expected');}},http:{request:async(...args)=>{calls.push(args);return typeof reply==='function'?reply(...args):reply;}}});
 return {client,calls};
}
test('model options and explicit default save use authenticated bounded API and whitelist fields',async()=>{
 const {client,calls}=fixture({status:200,body:{...settings,effective:'next-turn',api_key:'server-only',providers:[{...settings.providers[0],api_url:'private',api_key:'secret'}]}});
 assert.deepEqual(await client.getModelSettings(),settings);
 assert.deepEqual(await client.setModelSettings('custom:one','m1'),settings);
 assert.equal(calls[0][0],'GET');assert.equal(calls[0][1],'/v1/agent/model/options');assert.equal(calls[0][2],'synthetic-device');
 assert.equal(calls[1][0],'PUT');assert.deepEqual(calls[1][3],{scope:'connected-default',provider:'custom:one',model:'m1',confirm_selection:false});
 assert.equal(client.messages.size,0);assert.equal(client.receipts.size,0);
});
test('native confirmation remains unsaved and confirmation identity is exact',async()=>{
 const warning={confirmation_required:true,provider:'custom:one',model:'m2',warning:'Review data policy.'};
 const {client,calls}=fixture({status:200,body:warning});
 assert.deepEqual(await client.setModelSettings('custom:one','m2'),warning);
 await client.setModelSettings('custom:one','m2',undefined,true);assert.equal(calls[1][3].confirm_selection,true);
 await assert.rejects(()=>client.setModelSettings('custom:one','m1'),ProtocolError);
});
test('wrong scope malformed inventory and unconfirmed writes fail closed',async()=>{
 for(const body of [{...settings,scope:'thread'},{...settings,providers:[...settings.providers,...settings.providers]},{...settings,providers:[{id:'x',name:'X',models:[false]}]}]){
  await assert.rejects(()=>fixture({status:200,body}).client.getModelSettings(),ProtocolError);
 }
 await assert.rejects(()=>fixture({status:200,body:settings}).client.setModelSettings('custom:one','m1'),ProtocolError);
 await assert.rejects(()=>fixture({status:401,body:{}}).client.getModelSettings(),HttpError);
});
test('cancelled model settings read does not issue a request',async()=>{
 const f=fixture({status:200,body:settings}), controller=new AbortController();controller.abort();
 await assert.rejects(()=>f.client.getModelSettings(controller.signal));assert.equal(f.calls.length,0);
});
