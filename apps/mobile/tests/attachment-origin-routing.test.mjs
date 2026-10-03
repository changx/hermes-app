import test from 'node:test';
import * as sessionLinks from '../../../packages/client/src/sessionLinks.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { routeId } from '../src/routeId.ts';

const app=ts.createSourceFile('App.tsx',readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let opener;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(app)==='openThread')opener=node.initializer.getText(app);ts.forEachChild(node,visit);}
visit(app);assert.ok(opener);
function openHarness({failure,gate}={}){
  const events=[],focusedRef={current:true},openingRef={current:0};
  const client={currentThreadId:'th_one',currentConversationKey:{},currentOlderCursor:'older',messages:new Map([['th_one',[{ref_seq:19},{ref_seq:73}]]]),
    async openConversation(id,target){events.push(['open',id,target]);await gate;if(failure)throw Error('unavailable');}};
  const context={client,focusedRef,appActive:{current:true},openingRef,ownedWatch:{current:null},
    setPageCursor:value=>events.push(['cursor',value]),setHistoryBusy:value=>events.push(['busy',value]),setLocated:value=>events.push(['located',value]),setStartRef:value=>events.push(['start',value]),setError:value=>events.push(['error',value]),
    async loadHistoryBlocks(){events.push(['blocks']);return {olderCursor:'older-latest',startRef:99};}};
  runInNewContext(ts.transpileModule('globalThis.openThread='+opener,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {context,events,client};
}
test('production source opening publishes the around window without latest block loading; normal entry unchanged',async()=>{
  const h=openHarness();await h.context.openThread('th_one',73);
  assert.deepEqual(h.events.find(e=>e[0]==='open'),['open','th_one',73]);assert.equal(h.events.some(e=>e[0]==='blocks'),false);
  assert.deepEqual(h.events.filter(e=>e[0]==='start').at(-1),['start',19]);assert.deepEqual(h.events.filter(e=>e[0]==='located').at(-1),['located',true]);
  const ordinary=openHarness();await ordinary.context.openThread('th_one',undefined);assert.equal(ordinary.events.filter(e=>e[0]==='blocks').length,1);
});
test('source failure never falls back to latest; late open cannot publish into a departed scene',async()=>{
  const failed=openHarness({failure:true});await failed.context.openThread('th_one',73);
  assert.equal(failed.events.filter(e=>e[0]==='open').length,1);assert.equal(failed.events.some(e=>e[0]==='blocks'),false);assert.match(failed.events.find(e=>e[0]==='error')[1],/source message/);
  let finish;const gate=new Promise(resolve=>finish=resolve),late=openHarness({gate});const task=late.context.openThread('th_one',73);late.context.focusedRef.current=false;finish();await task;
  assert.equal(late.events.some(e=>e[0]==='located'&&e[1]===true),false);
});
test('native session route validates exact positive safe reference without normalizing malformed source tokens',()=>{
  let params={threadId:'th_one'};
  const exports={},modules={'../../../../../packages/client/src/sessionLinks':sessionLinks,react:React,'expo-router':{useLocalSearchParams:()=>params},'react-native-safe-area-context':{SafeAreaView:'SafeArea'},'../../App':{ThreadScreen:'Thread',Notice:'Notice',useApp:()=>({ready:true,config:null})},'../../routeId':{routeId}};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/threads/[threadId].tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,require:name=>modules[name]});
  let tree=exports.default();assert.equal(tree.props.children.props.targetRef,undefined);assert.equal(tree.props.children.key,'th_one');
  params={threadId:'th_one',messageRef:'73'};tree=exports.default();assert.equal(tree.props.children.props.targetRef,73);assert.equal(tree.props.children.key,'th_one:73');
  for(const bad of ['0','-1','073','73.0',' 73','9007199254740992',['73']]){params={threadId:'th_one',messageRef:bad};assert.equal(exports.default().type,'Notice');}
});
