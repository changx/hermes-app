import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function harness(){
 let now=1000;const timers=new Map();let number=0;
 const mocks={react:React,'react-native':{View:'View',StyleSheet:{create:v=>v}},'./FontSize':{Text:'Text'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59})}};
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../src/NetworkStatusToast.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,Date:{now:()=>now},Math,setInterval:fn=>{timers.set(++number,fn);return number;},clearInterval:id=>timers.delete(id),require:id=>mocks[id]});
 let root;const render=async props=>act(async()=>{const component=React.createElement(exports.NetworkStatusToast,props);root?root.update(component):root=create(component);});
 return {render,timers,text:()=>root.root.findAllByType('Text').map(n=>n.props.children),get root(){return root;},async advance(ms){await act(async()=>{now+=ms;for(const fn of timers.values())fn();});},async close(){await act(async()=>root.unmount());},message:exports.networkStatusText};
}
test('production toast counts down actual retry deadline and has no interactive controls',async()=>{
 const h=harness();try{await h.render({state:'retrying',retryAt:4000});assert.deepEqual(h.text(),['Connection interrupted. Retrying in 3s…']);assert.equal(h.root.root.findAllByType('Pressable').length,0);const position=h.root.root.findAllByType('View')[0];assert.equal(position.props.pointerEvents,'none');assert.equal(position.props.style[1].top,67);await h.advance(1100);assert.deepEqual(h.text(),['Connection interrupted. Retrying in 2s…']);const announcement=h.root.root.findAllByType('View')[1].props.accessibilityLabel;assert.equal(announcement,'Connection interrupted. Retrying automatically.');await h.advance(1900);assert.deepEqual(h.text(),['Retrying connection…']);await h.render({state:'online',retryAt:null});assert.equal(h.root.toJSON(),null);assert.equal(h.timers.size,0);}finally{await h.close();}
});
test('each new attempt clears the previous countdown; cleanup and pause stop timers',async()=>{
 const h=harness();try{await h.render({state:'retrying',retryAt:5000});assert.equal(h.timers.size,1);await h.render({state:'retrying',retryAt:null});assert.deepEqual(h.text(),['Retrying connection…']);assert.equal(h.timers.size,0);await h.render({state:'syncing',retryAt:null});assert.deepEqual(h.text(),['Restoring connection…']);await h.render({state:'retrying',retryAt:6000});assert.equal(h.timers.size,1);await h.render({state:'suspended',retryAt:null});assert.equal(h.root.toJSON(),null);assert.equal(h.timers.size,0);await h.render({state:'retrying',retryAt:6000});}finally{await h.close();assert.equal(h.timers.size,0);}
});
test('terminal errors are factual and never claim a scheduled retry',async()=>{
 const h=harness();try{await h.render({state:'blocked',retryAt:null,failed:true});assert.deepEqual(h.text(),['This device is not authorized to connect.']);await h.render({state:'suspended',retryAt:null,failed:true});assert.deepEqual(h.text(),['Connection could not be restored.']);await h.render({state:'connecting',retryAt:null});assert.deepEqual(h.text(),['Connecting…']);}finally{await h.close();}
});
