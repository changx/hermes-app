import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const output=await build({entryPoints:[new URL('../src/MessageTime.tsx',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'native-boundary',setup(b){
  b.onResolve({filter:/^(react-native|\.\/FontSize)$/},args=>({path:args.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='./FontSize'?"export const Text='Text';":"export const AppState={currentState:'active',addEventListener(){throw Error('Clock-only messages must not subscribe or schedule relative ticks')}};"}));
}}]});
const mod={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(mod,mod.exports,require);
test('production clock-only metadata has full accessible date, no relative tick subscription and preserves epoch/missing values',async()=>{
  const seconds=new Date(2026,9,5,22,11).getTime()/1000;
  let root;await act(async()=>{root=create(React.createElement(mod.exports.MessageTime,{seconds,clockOnly:true}));});
  try {
    let text=root.root.findByType('Text');assert.equal(text.props.children,'22:11');assert.equal(text.props.accessibilityLabel,'Sent 2026-10-05 22:11');
    await act(async()=>root.update(React.createElement(mod.exports.MessageTime,{seconds:0,clockOnly:true})));
    text=root.root.findByType('Text');assert.notEqual(text.props.children,'—');assert.ok(text.props.accessibilityLabel.startsWith('Sent '));
    await act(async()=>root.update(React.createElement(mod.exports.MessageTime,{clockOnly:true})));
    text=root.root.findByType('Text');assert.equal(text.props.children,'—');assert.equal(text.props.accessibilityLabel,'Time unavailable');
  }finally{await act(async()=>root.unmount());}
});
