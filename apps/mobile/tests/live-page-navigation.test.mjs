import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
const require = createRequire(import.meta.url);
const { StackRouter } = require('../node_modules/expo-router/build/react-navigation/routers/StackRouter.js');
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/sessionNavigation.tsx', import.meta.url),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true},
}).outputText,{exports,require:name=>name==='react'?React:name==='./sessionTimingSwitch'?{beginSessionTiming(){}}:name==='expo-router'?{}:name==='react-native'?{}:{}});

test('new target navigates; existing target dismisses to original native page',()=>{
  const router = StackRouter({initialRouteName:'index'}), options={routeNames:['index','threads/[threadId]'],routeParamList:{},routeGetIdList:{'threads/[threadId]':({params})=>params.threadId}};
  let state=router.getInitialState(options);
  const apply=(type,route)=>{state=router.getStateForAction(state,{type,payload:{name:route.pathname,params:route.params}},options);};
  const navigation={navigate:route=>apply('NAVIGATE',route),dismissTo:route=>apply('POP_TO',route)};
  const hasPage=id=>state.routes.some(route=>route.params?.threadId===id);
  const open=id=>exports.navigateSession(navigation,hasPage,id,{pathname:'threads/[threadId]',params:{threadId:id}});
  open('A');const a=state.routes.at(-1);open('B');assert.equal(state.routes.length,3);
  open('A');assert.equal(state.routes.length,2);assert.equal(state.routes.at(-1).key,a.key);
  open('A');assert.equal(state.routes.length,2);assert.equal(state.routes.at(-1).key,a.key);
  open('C');assert.deepEqual(state.routes.map(route=>route.params?.threadId),[undefined,'A','C']);
});
