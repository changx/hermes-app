import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

const final = { id:'f', ref_seq:3, role:'assistant', text:'Result', display_kind:'final' };
const calls = [{ id:'r', name:'read_file', label:'Read file', detail:'path=/repo/src/a.py · offset=10 · limit=3', caption:'Reading a.py L10-12', icon:'📖' }];
function client(messages) {
 return new HermesClient({token:()=> 'fixture',socket:{async connect(){throw Error('unused');}},http:{async request(){return {status:200,body:{messages, next_cursor:null,older_cursor:null,incomplete_turns:[],turn_outcomes:[]}};}}});
}
test('history and search preserve explicit final and Discord captions, never mark untyped prose',async()=>{
 const sdk=client([{id:'p',ref_seq:1,role:'assistant',text:'Result'}, {id:'t',ref_seq:2,role:'assistant',text:'',tool_calls:calls},final]);
 sdk.supportsLatest=true; await sdk.historyWindow('thread');
 const page=sdk.messages.get('thread');
 assert.equal(page[0].display_kind,undefined);
 assert.deepEqual(page[1].tool_calls,calls);
 assert.equal(page[2].display_kind,'final');
 assert.equal((await sdk.search('thread','Result')).messages[2].display_kind,'final');
 await sdk.historyWindow('thread'); assert.deepEqual(sdk.messages.get('thread'),page);
});
test('invalid final types and malformed caption/icon fail protocol validation',async()=>{
 for(const bad of [{...final,role:'user'},{...final,text:''},{...final,tool_calls:calls}]) await assert.rejects(client([bad]).history('thread'),ProtocolError);
 for(const bad of [{...calls[0],caption:'x'.repeat(241)},{...calls[0],icon:'x'.repeat(17)},{...calls[0],caption:'bad\u202e'}]) await assert.rejects(client([{id:'t',ref_seq:2,role:'assistant',text:'',tool_calls:[bad]}]).history('thread'),ProtocolError);
});
test('final classification update replays exact stable ref even behind newer messages',async()=>{
 const original={...final};delete original.display_kind;
 const tail={id:'tail',ref_seq:99,role:'assistant',text:'Later progress'};
 const event={event_id:11,cursor:'c11',kind:'message',thread_id:'thread',ref:'3',version:2};
 const paths=[];
 const sdk=new HermesClient({token:()=> 'fixture',socket:{async connect(){throw Error('unused');}},http:{async request(_method,path){
  paths.push(path);
  if(path.startsWith('/v1/sync'))return {status:200,body:{events:[event],next_cursor:'c11',waterline:'c11',has_more:false}};
  if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null,waterline:'c11'}};
  const query=new URL(path,'https://test.invalid').searchParams;
  return {status:200,body:{messages:query.get('ref_seq')==='3'?[final]:[],next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
 }}});
 sdk.cursor='c10';sdk.lastEventId=10;sdk.messages.set('thread',[original,tail]);
 await sdk.catchUp();assert.deepEqual(sdk.messages.get('thread').map(m=>m.ref_seq),[3,99]);
 assert.equal(sdk.messages.get('thread')[0].display_kind,'final');
 assert.ok(paths.some(path=>path.includes('ref_seq=3')));
});
