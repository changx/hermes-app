import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { HttpError } from '../../../packages/client/dist/index.js';
import { utf8Size } from '../../../packages/client/src/workspace.ts';
import { threadPatch } from '../src/channel-edits.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const state = initialized => ({channelId:'p_one',initialized,agentsBytes:12000,fileBytes:10485760});
const document = (content='Original',etag='original-version') => ({channelId:'p_one',path:'AGENTS.md',content,etag});
function clientFixture() {
  let saved = document(), initialized=true;
  const calls=[];
  const client={supportsChannelWorkspace:true,connectionState:'online',channels:new Map([['p_one',{id:'p_one',name:'Project'}]]),threads:new Map(),
    workspace:{async getState(){calls.push('state');return state(initialized);},async initialize(){calls.push('initialize');initialized=true;return state(true);},
      async getAgents(){calls.push('read');if(!saved)throw new HttpError(404);return saved;},
      async saveAgents(cid,content,etag){calls.push(['save',cid,content,etag]);saved=document(content,'saved-version');return saved;},
      async list(cid,path,after){calls.push(['list',cid,path,after]);return {channelId:cid,path,items:[{name:'docs',path:'docs',kind:'directory',size:null},{name:'AGENTS.md',path:'AGENTS.md',kind:'file',size:5}],nextAfter:null};},
      async attachments(){calls.push('attachments');return {channelId:'p_one',items:[{id:'att_one',thread_id:'th_one',name:'note.txt',size:4,mime:'text/plain',receipt_id:null,state:'available'}],nextAfter:null};}},
  };
  return {client,calls,get saved(){return saved},set saved(value){saved=value},set initialized(value){initialized=value}};
}

async function harness(file,name,client,extra={}) {
  const Focus=React.createContext(true), alerts=[], navigation=[], viewers=[], actions=[];
  let prevention;
  const mocks={react:React,'react-native':{View:'View',Pressable:'Pressable',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',Text:'Text',TextInput:'TextInput',
    FlatList:props=>React.createElement('List',{},props.data.length?props.data.map(item=>React.createElement(React.Fragment,{key:props.keyExtractor(item)},props.renderItem({item}))):props.ListEmptyComponent,props.ListFooterComponent),
    Alert:{alert:(...args)=>alerts.push(args)},StyleSheet:{create:x=>x}},
    'expo-router':{useIsFocused:()=>React.useContext(Focus),useNavigation:()=>({dispatch:action=>navigation.push(action)}),
      useFocusEffect:callback=>{const focused=React.useContext(Focus);React.useEffect(()=>focused?callback():undefined,[focused,callback]);}},
    'expo-router/react-navigation':{usePreventRemove:(prevent,callback)=>{prevention={prevent,callback};}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:34})},'expo-symbols':{SymbolView:'Symbol'},
    '../../../packages/client/src/index':{HttpError,utf8Size},'./FontSize':{Text:'Text',TextInput:'TextInput'},'./MessageContent':{MessageContent:'Markdown'},
    './Viewers':{useViewer:()=>({openViewer:(title,content)=>viewers.push({title,content})})},
    './WorkspaceFilePreview':{WorkspaceFilePreview:'Preview'},'./channel-edits':{threadPatch},'./NewTopicComposer':{NewTopicComposer:'Composer'},'./MessageTime':{MessageTime:'Time'},
  };
  function load(path){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../src/'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,console,AbortController,require:id=>{if(!(id in mocks))throw Error(id);return mocks[id];}});return exports;}
  mocks['./WorkspaceUI']=load('WorkspaceUI.tsx');
  const exports=load(file),props={client,channelId:'p_one',directory:'',onDirectory:path=>actions.push(['directory',path]),onAgents:()=>actions.push(['agents']),
    onContext:id=>actions.push(['context',id]),onFiles:id=>actions.push(['files',id]),onThread:()=>{},onChannel:()=>{},onNewChannel:()=>{},enqueueFirstMessage:async()=>{},...extra};
  let root;
  const render=async(focus=true)=>act(async()=>{const tree=React.createElement(Focus.Provider,{value:focus},React.createElement(exports[name],props));if(root)root.update(tree);else root=create(tree);});
  await render();
  return {get root(){return root},alerts,navigation,viewers,actions,render,get prevention(){return prevention},
    button:label=>root.root.findAllByType('Pressable').find(node=>node.props.accessibilityLabel===label),
    input:()=>root.root.findByType('TextInput'),
    async press(label){await act(async()=>this.button(label).props.onPress());},async type(value){await act(async()=>this.input().props.onChangeText(value));},
    async close(){await act(async()=>root.unmount());}};
}

const editor=f=>harness('ChannelAgentsScreen.tsx','ChannelAgentsScreen',f.client);

test('compact Channel links are capability gated and do not prefetch file details',async()=>{
  const f=clientFixture();f.client.supportsChannelWorkspace=false;
  const h=await harness('ChannelScreens.tsx','ChannelScreens',f.client,{onAgents:id=>h.actions.push(['agents',id])});
  assert.equal(h.button('Channel files'),undefined);
  f.client.supportsChannelWorkspace=true;await h.render();
  await h.press('Channel files');await h.press('Channel AGENTS.md');
  assert.deepEqual(h.actions,[['files','p_one'],['agents','p_one']]);
  assert.equal(f.calls.length,0);assert.equal(h.root.root.findByType('Composer').props.channelId,'p_one');
  await h.close();
});

test('unsupported connection does not issue workspace requests or offer a fake editor',async()=>{
  const f=clientFixture();f.client.supportsChannelWorkspace=false;
  const h=await editor(f);assert.equal(f.calls.length,0);assert.equal(h.button('Edit'),undefined);
  assert.match(JSON.stringify(h.root.toJSON()),/not available on this connection/);await h.close();
});

test('AGENTS setup is explicit, not an entry side effect; missing rules have real creation flow',async()=>{
  const f=clientFixture();f.initialized=false;f.saved=null;
  const h=await editor(f);assert.deepEqual(f.calls,['state']);
  await h.press('Set up channel files');assert.ok(f.calls.includes('initialize'));
  await h.press('Add guidelines');assert.equal(h.button('Save').props.disabled,true);
  await h.type('\nNew rules\n ');await h.press('Save');
  assert.deepEqual(f.calls.find(Array.isArray),['save','p_one','\nNew rules\n ',null]);
  assert.equal(h.root.root.findByType('Markdown').props.text,'\nNew rules\n ');await h.close();
});

test('editing preserves whitespace, sends original version, and allows clearing existing guidelines',async()=>{
  const f=clientFixture(),h=await editor(f);
  await h.press('Edit');await h.type('');await h.press('Save');
  assert.deepEqual(f.calls.find(Array.isArray),['save','p_one','','original-version']);
  assert.equal(h.prevention.prevent,false);assert.ok(h.button('Edit'));await h.close();
});

test('UTF-8 byte limit disables oversized multibyte input without truncating it',async()=>{
  const f=clientFixture(),h=await editor(f);
  await h.press('Edit');const value='汉'.repeat(4001);await h.type(value);
  assert.equal(h.input().props.value,value);assert.equal(h.button('Save').props.disabled,true);
  await h.press('Save');assert.equal(f.calls.some(Array.isArray),false);await h.close();
});

test('conflict keeps local draft/version, and explicit saved-copy replacement is confirmed',async()=>{
  const f=clientFixture(),h=await editor(f);
  f.client.workspace.saveAgents=async(...args)=>{f.calls.push(['save',...args]);f.saved=document('Changed elsewhere','other-version');throw new HttpError(412);};
  await h.press('Edit');await h.type('My draft');await h.press('Save');
  assert.equal(h.input().props.value,'My draft');assert.equal(h.button('Save').props.disabled,true);
  assert.ok(h.button('Review saved version'));await h.press('Review saved version');
  assert.equal(h.viewers[0].title,'Saved AGENTS.md');assert.equal(h.input().props.value,'My draft');
  await h.press('Use saved version');assert.equal(h.alerts[0][0],'Replace your draft?');
  await act(async()=>h.alerts[0][2][1].onPress());
  assert.equal(h.input().props.value,'Changed elsewhere');await h.type('Resolved draft');await h.press('Save');
  assert.equal(f.calls.filter(Array.isArray).at(-1).at(-1),'other-version');await h.close();
});

test('lost write response is confirmed by readback on retry, without duplicate overwrite',async()=>{
  const f=clientFixture(),h=await editor(f);let writes=0;
  f.client.workspace.saveAgents=async(cid,content)=>{writes++;f.saved=document(content,'actual-version');throw new TypeError('response lost');};
  await h.press('Edit');await h.type('Saved but response lost');await h.press('Save');
  assert.equal(h.input().props.value,'Saved but response lost');
  await h.press('Save');assert.equal(writes,1);assert.equal(h.prevention.prevent,false);
  assert.equal(h.root.root.findByType('Markdown').props.text,'Saved but response lost');await h.close();
});

test('failed write retry cannot silently take another writer’s new version',async()=>{
  const f=clientFixture(),h=await editor(f);let writes=0;
  f.client.workspace.saveAgents=async()=>{writes++;throw new TypeError('offline');};
  await h.press('Edit');await h.type('My draft');await h.press('Save');
  f.saved=document('Other edit','other-version');await h.press('Save');
  assert.equal(writes,1);assert.equal(h.input().props.value,'My draft');assert.equal(h.button('Save').props.disabled,true);await h.close();
});

test('back/cancel guard, temporary blur and capability loss do not discard the draft',async()=>{
  const f=clientFixture(),h=await editor(f);await h.press('Edit');await h.type('Keep me');
  const reads=f.calls.filter(x=>x==='read').length;await h.render(false);await h.render(true);
  assert.equal(h.input().props.value,'Keep me');assert.equal(f.calls.filter(x=>x==='read').length,reads);
  f.client.supportsChannelWorkspace=false;await h.render();assert.equal(h.input().props.value,'Keep me');assert.equal(h.button('Save').props.disabled,true);
  await act(async()=>h.prevention.callback({data:{action:{type:'GO_BACK'}}}));
  assert.equal(h.alerts[0][0],'Discard changes?');await act(async()=>h.alerts[0][2][1].onPress());
  assert.deepEqual(h.navigation,[{type:'GO_BACK'}]);await h.close();
});

test('pending read aborted on blur cannot populate hidden guidelines; refocus reads fresh data',async()=>{
  const f=clientFixture(),wait=deferred();let signal;
  f.client.workspace.getState=(_id,s)=>{signal=s;return wait.promise;};
  const h=await editor(f);await h.render(false);assert.equal(signal.aborted,true);
  await act(async()=>wait.resolve(state(true)));assert.equal(h.root.root.findAllByType('Markdown').length,0);
  f.client.workspace.getState=async()=>state(true);await h.render(true);
  assert.equal(h.root.root.findByType('Markdown').props.text,'Original');await h.close();
});

test('pending save prevents duplicate writes/back removal, and failed save keeps text',async()=>{
  const f=clientFixture(),h=await editor(f),wait=deferred();let writes=0;
  f.client.workspace.saveAgents=async()=>{writes++;await wait.promise;throw Error('failed');};
  await h.press('Edit');await h.type('Pending');await act(async()=>h.button('Save').props.onPress());
  assert.equal(h.input().props.editable,false);assert.equal(h.prevention.prevent,true);
  await act(async()=>{h.button('Saving…').props.onPress();h.prevention.callback({data:{action:{type:'GO_BACK'}}});});
  assert.equal(writes,1);assert.equal(h.alerts.length,0);
  await act(async()=>wait.resolve());assert.equal(h.input().props.value,'Pending');assert.equal(h.button('Save').props.disabled,false);await h.close();
});

test('Files browse directory/AGENTS or a selected attachment without fetching hidden conversation bodies',async()=>{
  const f=clientFixture(),h=await harness('ChannelFilesScreen.tsx','ChannelFilesScreen',f.client);
  await h.press('docs');await h.press('AGENTS.md');assert.deepEqual(h.actions,[['directory','docs'],['agents']]);
  await h.press('Attachments');await h.press('note.txt');assert.equal(h.viewers[0].title,'note.txt');
  assert.equal(h.viewers[0].content.props.attachment.id,'att_one');assert.equal(f.calls.some(x=>String(x).includes('messages')),false);await h.close();
});

test('attachment inventory remains usable before workspace initialization; folder setup is never automatic',async()=>{
  const f=clientFixture();f.initialized=false;
  const h=await harness('ChannelFilesScreen.tsx','ChannelFilesScreen',f.client);
  assert.ok(h.button('Set up channel files'));assert.equal(f.calls.includes('initialize'),false);
  await h.press('Attachments');assert.ok(h.button('note.txt'));assert.equal(f.calls.includes('initialize'),false);await h.close();
});

test('pagination appends owned metadata and detects repeated rows instead of duplicating them',async()=>{
  const f=clientFixture();let count=0;
  f.client.workspace.list=async()=>({channelId:'p_one',path:'',items:[{name:++count===1?'a.txt':'b.txt',path:count===1?'a.txt':'b.txt',kind:'file',size:1}],nextAfter:count===1?'a.txt':null});
  const h=await harness('ChannelFilesScreen.tsx','ChannelFilesScreen',f.client);
  assert.ok(h.button('a.txt'));await h.press('Load more');assert.ok(h.button('a.txt'));assert.ok(h.button('b.txt'));assert.equal(h.button('Load more'),undefined);await h.close();
});

test('native routes validate opaque channel and relative folder and key drafts by connection',()=>{
  const folder=readFileSync(new URL('../src/app/channels/[channelId]/files.tsx',import.meta.url),'utf8');
  const agents=readFileSync(new URL('../src/app/channels/[channelId]/agents.tsx',import.meta.url),'utf8');
  assert.match(folder,/routeId\(rawId\)/);assert.match(folder,/workspacePath\(rawPath \?\? '', true\)/);
  assert.match(folder,/config.id \+ ':' \+ id \+ ':' \+ directory/);assert.match(agents,/config.id \+ ':' \+ id/);
  assert.match(agents,/<FormKeyboardAvoidingView>/);
});
