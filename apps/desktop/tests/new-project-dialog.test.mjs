import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/renderer/new-project-dialog.tsx',import.meta.url).pathname],bundle:true,format:'cjs',platform:'node',external:['react','react/jsx-runtime'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);
const {NewProjectDialog}=mod.exports;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const a={id:'primary',connectionKey:'a'.repeat(24),name:'First',server:'https://first.example.test',state:'online'};
const b={id:'b'.repeat(24),connectionKey:'b'.repeat(24),name:'Second',server:'https://second.example.test',state:'online'};
const snapshot={connections:[a,b],connectionKey:a.connectionKey};
async function fixture(value=snapshot,save=async()=>{}) {
  const calls=[];let closed=0,tree;
  globalThis.window={hermesDesktop:{async createChannel(input){calls.push(input);await save(input);}}};
  const close=()=>closed++;
  await act(async()=>{tree=create(React.createElement(NewProjectDialog,{snapshot:value,close}));});
  const update=async value=>{await act(async()=>tree.update(React.createElement(NewProjectDialog,{snapshot:value,close})));};
  const name=async value=>{await act(async()=>tree.root.findByProps({'aria-label':'Project title'}).props.onChange({target:{value}}));};
  const choose=async value=>{await act(async()=>tree.root.findByProps({'aria-label':'Project connection'}).props.onChange({target:{value}}));};
  const submit=async()=>{await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));};
  return {tree,calls,name,choose,submit,update,closed:()=>closed,dispose:async()=>{await act(async()=>tree.unmount());}};
}
test('multiple connections require explicit choice and active-tab changes retain the chosen target and form',async()=>{
  const f=await fixture();try {
    await f.name('Peer Project');assert.equal(f.tree.root.findByProps({'type':'submit'}).props.disabled,true);
    await f.submit();assert.equal(f.calls.length,0);
    await f.choose(b.connectionKey);await f.update({...snapshot,connectionKey:b.connectionKey,selectedThreadId:'different-tab'});
    assert.equal(f.tree.root.findByProps({'aria-label':'Project title'}).props.value,'Peer Project');
    await f.update(snapshot);await f.submit();assert.deepEqual(f.calls,[{connectionKey:b.connectionKey,name:'Peer Project',description:''}]);assert.equal(f.closed(),1);
  }finally{await f.dispose();}
});
test('removing the selected connection leaves an unavailable target, not automatic selection of another connection',async()=>{
  const f=await fixture();try {
    await f.choose(b.connectionKey);await f.name('Retain me');await f.update({...snapshot,connections:[a]});
    assert.equal(f.tree.root.findByProps({'aria-label':'Project connection'}).props.value,b.connectionKey);
    assert.equal(f.tree.root.findByProps({'type':'submit'}).props.disabled,true);await f.submit();assert.equal(f.calls.length,0);
    assert.equal(f.tree.root.findByProps({'aria-label':'Project title'}).props.value,'Retain me');
  }finally{await f.dispose();}
});
test('offline selected connection cannot submit, even while another connection is online',async()=>{
  const f=await fixture();try {
    await f.choose(b.connectionKey);await f.name('Retain me');await f.update({...snapshot,connections:[a,{...b,state:'retrying'}]});
    await f.submit();assert.equal(f.calls.length,0);assert.equal(f.tree.root.findByProps({'type':'submit'}).props.disabled,true);
  }finally{await f.dispose();}
});
test('ambiguous creation failure preserves values, reports safely and blocks duplicate mutation',async()=>{
  const f=await fixture(snapshot,async()=>{throw Error('private backend detail');});try {
    await f.choose(b.connectionKey);await f.name('Retain me');await f.submit();await f.submit();
    assert.equal(f.calls.length,1);assert.equal(f.closed(),0);assert.equal(f.tree.root.findByProps({'aria-label':'Project title'}).props.value,'Retain me');
    assert.equal(f.tree.root.findByProps({'type':'submit'}).props.disabled,true);
    const alert=f.tree.root.findByProps({'role':'alert'}).children.join('');assert.match(alert,/could not be confirmed/);assert.doesNotMatch(alert,/private backend/);
  }finally{await f.dispose();}
});
test('a single connection is shown explicitly and preselected without an implicit active-connection API',async()=>{
  const f=await fixture({...snapshot,connections:[a]});try {
    assert.equal(f.tree.root.findByProps({'aria-label':'Project connection'}).props.value,a.connectionKey);
    await f.name('First Project');await f.submit();assert.equal(f.calls[0].connectionKey,a.connectionKey);
  }finally{await f.dispose();}
});
