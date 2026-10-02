import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/liveProtocol.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {parseCatalogue,parseLiveFrame,watchCommand,LiveProtocolError}=module.exports;
const session={id:'th_A',project_id:'p',title:'A',archived:false,running:true};
test('directory decoding keeps only lightweight fields, never unread, bodies or prompts',()=>{
  const result=parseCatalogue({items:[{kind:'channel',value:{id:'p',name:'P',description:'not in list'}},{kind:'session',value:{...session,unread_count:9,messages:['private'],active_receipts:[{pending_text:'private'}],pending_interactions:['private'],version:4}}],next_after:null});
  assert.deepEqual(result,{items:[{kind:'channel',value:{id:'p',name:'P'}},{kind:'session',value:session}],next_after:null});
});
test('catalogue rejects incomplete/malformed pages and duplicate identities',()=>{
  for(const body of [{items:[],next_after:undefined},{items:[{kind:'session',value:{...session,running:'yes'}}],next_after:null},{items:[{kind:'session',value:session},{kind:'session',value:session}],next_after:null}])assert.throws(()=>parseCatalogue(body),LiveProtocolError);
});
test('live hints have no sync cursor or per-entity version, subscription identity is echoed exactly',()=>{
  const input={type:'conversation_changed',thread_id:'th_A',request_id:'A:second',event_id:90,cursor:'not-consumed',version:88};
  assert.deepEqual(parseLiveFrame(input),{type:'conversation_changed',thread_id:'th_A',request_id:'A:second'});
  assert.equal(watchCommand('th_A','A:second'),'{"type":"watch","thread_id":"th_A","request_id":"A:second"}');
  assert.deepEqual(parseLiveFrame(JSON.parse(watchCommand(null,'close').replace('"watch"','"watching"'))),{type:'watching',thread_id:null,request_id:'close'});
});
test('only explicit supported scopes and packet types are accepted',()=>{
  assert.deepEqual(parseLiveFrame({type:'hello',protocol:1,open_session_live:true}),{type:'hello',protocol:1,open_session_live:true});
  assert.deepEqual(parseLiveFrame({type:'session_state',thread_id:'th_B',running:false}),{type:'session_state',thread_id:'th_B',running:false});
  for(const frame of [{type:'hello',protocol:1},{type:'event',event_id:1},{type:'conversation_changed',thread_id:'th_A'},{type:'watching',thread_id:'',request_id:'x'}])assert.throws(()=>parseLiveFrame(frame),LiveProtocolError);
});
