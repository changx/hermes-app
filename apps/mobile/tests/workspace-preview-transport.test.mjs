import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { nativeTransport } from '../src/transport.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

test('native conditional transport preserves auth and exact precondition; rejects unversioned/ambiguous writes',async()=>{
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return {status:200,headers:new Headers({'content-type':'application/json','content-length':'2'}),text:async()=>'{}'};};
  try{
    const http=nativeTransport('https://example.test').http,etag='"'+'a'.repeat(64)+'"';
    await http.conditionalRequest('PUT','/v1/channels/p_one/agents','private-credential',{'If-Match':etag},{content:'中文\n'});
    assert.deepEqual(calls[0].options.headers,{Authorization:'Bearer private-credential','Content-Type':'application/json','If-Match':etag});
    assert.deepEqual(JSON.parse(calls[0].options.body),{content:'中文\n'});assert.ok(!calls[0].url.includes('private-credential'));
    await http.conditionalRequest('PUT','/v1/channels/p_one/agents','private-credential',{'If-None-Match':'*'},{content:''});
    for(const headers of [{},{'If-Match':'*'},{'If-Match':etag,'If-None-Match':'*'}])await assert.rejects(http.conditionalRequest('PUT','/v1/channels/p_one/agents','private-credential',headers,{}));
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;}
});

test('workspace JSON response bounds are checked before/after text allocation',async()=>{
  const original=globalThis.fetch;let reads=0;
  try{
    const http=nativeTransport('https://example.test').http;
    globalThis.fetch=async()=>({status:200,headers:new Headers({'content-length':'1048577'}),text:async()=>{reads++;return '{}';}});
    await assert.rejects(http.request('GET','/v1/channels/p_one/files','synthetic'));assert.equal(reads,0);
    globalThis.fetch=async()=>({status:200,headers:new Headers(),text:async()=> '汉'.repeat(350000)});
    await assert.rejects(http.request('GET','/v1/channels/p_one/files','synthetic'));
  }finally{globalThis.fetch=original;}
});

test('AGENTS JSON transport accepts escaped large documents but still bounds wire allocation',async()=>{
  const original=globalThis.fetch;let reads=0;
  try{
    const http=nativeTransport('https://example.test').http;
    const content='汉🌍\n'.repeat(120000),raw=JSON.stringify({content});
    globalThis.fetch=async()=>({status:200,headers:new Headers({'content-type':'application/json','content-length':String(Buffer.byteLength(raw))}),text:async()=>{reads++;return raw;}});
    assert.equal((await http.request('GET','/v1/channels/p_one/agents','synthetic')).body.content,content);
    globalThis.fetch=async()=>({status:200,headers:new Headers({'content-length':String(6*10485760+4097)}),text:async()=>{reads++;return '{}';}});
    await assert.rejects(http.request('GET','/v1/channels/p_one/agents','synthetic'));assert.equal(reads,1);
  }finally{globalThis.fetch=original;}
});

async function preview({name='note.md',size=4,bytes=new TextEncoder().encode('text'),wait,attachment,source,supported=false}={}){
  const Focus=React.createContext(true),files=[],calls=[],navigation=[],sourceCalls=[];let root;
  class File{constructor(){this.uri='cache://private-'+files.length;this.exists=false;files.push(this);}create(){this.exists=true;}write(value){this.bytes=value;}async text(){return new TextDecoder().decode(this.bytes);}delete(){this.exists=false;this.deleted=true;}}
  const exports={},mocks={react:React,'react-native':{ActivityIndicator:'Spinner',Platform:{OS:'ios'},ScrollView:'ScrollView',View:'View'},
    'expo-router':{useRouter:()=>({push:route=>navigation.push(route)})},
    'expo-file-system':{File,Paths:{cache:'private-cache'}},'expo-crypto':{randomUUID:()=> 'synthetic-preview-id'},
    './FontSize':{Text:'Text'},'./Attachments':{ImageViewer:'Image'},'./MessageContent':{MessageContent:'Markdown'},
    './WorkspaceUI':{workspaceStyles:{page:{},hint:{},error:{},content:{}},WorkspaceAction:props=>React.createElement('Action',props)},};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/WorkspaceFilePreview.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,console,AbortController,require:id=>{if(!(id in mocks))throw Error(id);return mocks[id];}});
  const client={supportsAttachmentOrigin:supported,async download(){throw Error('Conversation is not open');},workspace:{async attachmentSource(cid,selected,signal){sourceCalls.push({cid,selected,signal});return source??null;},async readFile(cid,path,signal){calls.push({cid,path,signal});return wait??bytes;},async readAttachment(selected,signal){calls.push({attachment:selected,signal});return wait??bytes;}}};
  const props={client,channelId:'p_one',path:attachment?undefined:name,attachment,name,size};
  const render=async(focused=true)=>act(async()=>{const node=React.createElement(Focus.Provider,{value:focused},React.createElement(exports.WorkspaceFilePreview,props));if(root)root.update(node);else root=create(node);});
  await render();return{get root(){return root},calls,files,navigation,sourceCalls,render,async close(){await act(async()=>root.unmount());}};
}

test('selected Markdown preview loads on demand and deletes only its owned cache on real departure',async()=>{
  const h=await preview({bytes:new TextEncoder().encode('# Reference')});
  assert.equal(h.calls.length,1);assert.equal(h.root.root.findByType('Markdown').props.text,'# Reference');assert.equal(h.files[0].exists,true);
  await h.close();assert.equal(h.files[0].deleted,true);
});

test('Channel attachment preview uses explicit inventory read without requiring a conversation',async()=>{
  const attachment={id:'att_one',thread_id:'th_closed',name:'note.md',size:11,state:'available'};
  const h=await preview({attachment,bytes:new TextEncoder().encode('# Attachment')});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].attachment,attachment);
  assert.equal(h.root.root.findByType('Markdown').props.text,'# Attachment');
  await h.close();assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.files[0].deleted,true);
});

test('unsupported/oversized previews do not silently download or execute content',async()=>{
  for(const options of [{name:'large.md',size:65537},{name:'active.svg',size:4},{name:'document.pdf',size:4}]){
    const h=await preview(options);assert.equal(h.calls.length,0);assert.equal(h.files.length,0);await h.close();
  }
});

test('passive raster header is required even for an image filename',async()=>{
  const h=await preview({name:'fake.png',bytes:new TextEncoder().encode('<svg>active</svg>')});
  assert.equal(h.files.length,0);assert.equal(h.root.root.findAllByType('Image').length,0);assert.match(JSON.stringify(h.root.toJSON()),/Could not preview/);await h.close();
  const png=await preview({name:'real.png',bytes:Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])});
  assert.ok(png.root.root.findByType('Image').props.uri.startsWith('cache://private'));await png.close();assert.equal(png.files[0].deleted,true);
});

test('source entry pushes exact native session target and back retains the mounted reader',async()=>{
  const attachment={id:'att_one',thread_id:'th_closed',name:'note.md',size:4,state:'available'},source={threadId:'th_closed',refSeq:73};
  const h=await preview({attachment,source,supported:true});
  const reader=h.root.root.findByType('ScrollView');
  const button=h.root.root.findAllByType('Action').find(node=>node.props.label==='View in conversation');assert.ok(button);
  await act(async()=>button.props.onPress());assert.deepEqual(JSON.parse(JSON.stringify(h.navigation)),[{pathname:'/threads/[threadId]',params:{threadId:'th_closed',messageRef:'73'}}]);
  await h.render(false);await h.render(true);assert.equal(h.root.root.findByType('ScrollView'),reader);assert.equal(h.calls.length,1);assert.equal(h.sourceCalls.length,1);
  await h.close();assert.equal(h.files[0].deleted,true);assert.equal(h.sourceCalls[0].signal.aborted,true);
});

test('workspace files, old servers and unresolved attachment links never offer a guessed source',async()=>{
  for(const options of [{supported:true},{attachment:{id:'att_draft',thread_id:'th_one'},supported:false},{attachment:{id:'att_missing',thread_id:'th_one'},supported:true}]){
    const h=await preview(options);assert.equal(h.root.root.findAllByType('Action').some(node=>node.props.label==='View in conversation'),false);await h.close();
  }
});

test('late selected bytes after actual removal cannot recreate the private cache',async()=>{
  let finish;const wait=new Promise(resolve=>{finish=resolve;});const h=await preview({wait});await h.close();
  assert.equal(h.calls[0].signal.aborted,true);await act(async()=>finish(new TextEncoder().encode('late')));assert.equal(h.files.length,0);
});

test('covered reader retains its request/content; only actual removal cleans the private file',async()=>{
  let finish;const wait=new Promise(resolve=>{finish=resolve;});
  const h=await preview({wait});await h.render(false);assert.equal(h.calls[0].signal.aborted,false);
  await act(async()=>finish(new TextEncoder().encode('retained')));assert.equal(h.files.length,1);
  const reader=h.root.root.findByType('ScrollView');await h.render(true);assert.equal(h.root.root.findByType('ScrollView'),reader);assert.equal(h.calls.length,1);
  await h.close();assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.files[0].deleted,true);
});
