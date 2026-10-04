import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/renderer/sidebar-width.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports);
const {clampSidebarWidth,loadSidebarWidth,saveSidebarWidth,SIDEBAR_WIDTH_KEY}=mod.exports;

test('sidebar width clamps to user limits and reserves conversation space',()=>{
  assert.equal(clampSidebarWidth(100,1280),200);
  assert.equal(clampSidebarWidth(800,1280),480);
  assert.equal(clampSidebarWidth(480,720),360);
  assert.equal(clampSidebarWidth(480,600),240);
  assert.equal(clampSidebarWidth(480,320),200);
  assert.equal(clampSidebarWidth(333.4,1280),333);
});
test('sidebar local preference restoration validates values and survives storage failures',()=>{
  const original=globalThis.window;
  try {
    let stored=null;
    globalThis.window={localStorage:{getItem:key=>{assert.equal(key,SIDEBAR_WIDTH_KEY);return stored},setItem:(key,value)=>{assert.equal(key,SIDEBAR_WIDTH_KEY);stored=value}}};
    assert.equal(loadSidebarWidth(),280);
    assert.equal(saveSidebarWidth(380),true);assert.equal(loadSidebarWidth(),380);
    for(const invalid of ['','NaN','Infinity','-20','199','481','wrong']){stored=invalid;assert.equal(loadSidebarWidth(),280);}
    globalThis.window={localStorage:{getItem(){throw Error('unavailable')},setItem(){throw Error('full')}}};
    assert.equal(loadSidebarWidth(),280);assert.equal(saveSidebarWidth(350),false);
  } finally { globalThis.window=original; }
});
