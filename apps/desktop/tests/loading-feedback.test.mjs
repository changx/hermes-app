import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
const root=new URL('..',import.meta.url).pathname;
async function load(contents, external){
  const result=await build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',external,write:false});
  const mod={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  return mod.exports;
}
const {DesktopConnectionService,HermesClient}=await load(`export { DesktopConnectionService } from './src/main/connection-service'; export { HermesClient } from '@hermes-app/client';`,['electron']);
const {render}=await load(`import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {DesktopShellView} from './src/renderer/shell'; export const render=(snapshot)=>renderToStaticMarkup(createElement(DesktopShellView,{snapshot}));`,['react','react-dom/server','react/jsx-runtime']);
const base={revision:1,phase:'connected',connectionState:'retrying',connectionLabel:'Reconnecting',channels:[],threads:[],messages:[],interactions:[],canLoadOlder:false};

test('cold startup shows accessible natural loading feedback, not empty-account copy',()=>{
  const markup=render({...base,loadingConversations:true});
  assert.match(markup,/Loading your conversations…/);
  assert.match(markup,/role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.doesNotMatch(markup,/No channels yet|Your conversations will appear here|Reconnecting/);
  assert.match(render({...base,phase:'restoring'}),/Loading your conversations…/);
});

test('real SDK snapshot completion ends first-load feedback even for an empty account',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const service=new DesktopConnectionService(()=>{});service.phase='connected';
  const states=[];
  const client=new HermesClient({token:()=> 'controlled-test-token',socket:{connect:async()=>{throw new Error('not used');}},http:{request:async(_method,path)=>{
    if(path.startsWith('/v1/snapshot')){await gate;return {status:200,body:{waterline:'test-waterline',threads:[],next_after:null}};}
    if(path==='/v1/channels')return {status:200,body:{channels:[]}};
    throw new Error('unexpected controlled route');
  }},onChange:()=>states.push(service.snapshot().loadingConversations)});
  service.client=client;
  const pending=client.snapshot();
  assert.equal(service.snapshot().loadingConversations,true);
  release();await pending;
  assert.equal(client.cursor,'test-waterline');
  assert.equal(service.snapshot().loadingConversations,false);
  assert.equal(states.at(-1),false);
  assert.match(render(service.snapshot()),/No channels yet/);
  assert.doesNotMatch(render(service.snapshot()),/Loading your conversations/);
  service.connectionState='retrying';
  assert.equal(service.snapshot().loadingConversations,false);
  client.close();
});

test('actionable connection failure is not masked by first-load feedback',()=>{
  const markup=render({...base,loadingConversations:true,errorMessage:'This device is no longer authorized. Pair it again.'});
  assert.match(markup,/role="alert"/);
  assert.match(markup,/no longer authorized/);
  assert.doesNotMatch(markup,/Loading your conversations|No channels yet/);
});

test('existing conversation stays readable during reconnect',()=>{
  const markup=render({...base,loadingConversations:false,selectedThreadId:'test-thread',selectedThreadTitle:'Test',messages:[{id:'test-message',role:'assistant',text:'Already loaded content',toolCalls:[],attachments:[]}]});
  assert.match(markup,/Already loaded content/);
  assert.doesNotMatch(markup,/Loading your conversations/);
});
