import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/renderer/browser-width.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports);
const {automaticBrowserWidth,browserMaximum,clampBrowserWidth,loadBrowserWidth,saveBrowserWidth,BROWSER_WIDTH_KEY}=mod.exports;

test('preview width keeps the automatic default and reserves conversation space',()=>{
  assert.equal(automaticBrowserWidth(1280),538);
  assert.equal(automaticBrowserWidth(2000),560);
  assert.equal(automaticBrowserWidth(500),280);
  // available = workspace minus visible left sidebar; 360px stays for the conversation.
  assert.equal(browserMaximum(1080),720);
  assert.equal(browserMaximum(500),280);
  assert.equal(clampBrowserWidth(100,1080),280);
  assert.equal(clampBrowserWidth(900,1080),720);
  assert.equal(clampBrowserWidth(612.6,1080),613);
  assert.equal(clampBrowserWidth(5000,4000),1600);
});
test('preview width preference validates stored values, resets to automatic and survives storage failures',()=>{
  const original=globalThis.window;
  try {
    let stored=null;
    globalThis.window={localStorage:{getItem:key=>{assert.equal(key,BROWSER_WIDTH_KEY);return stored},setItem:(key,value)=>{assert.equal(key,BROWSER_WIDTH_KEY);stored=value},removeItem:key=>{assert.equal(key,BROWSER_WIDTH_KEY);stored=null}}};
    assert.equal(loadBrowserWidth(),null);
    assert.equal(saveBrowserWidth(640),true);assert.equal(stored,'640');assert.equal(loadBrowserWidth(),640);
    assert.equal(saveBrowserWidth(null),true);assert.equal(stored,null);assert.equal(loadBrowserWidth(),null);
    for(const invalid of ['','  ','NaN','Infinity','-20','279','1601','wrong']){stored=invalid;assert.equal(loadBrowserWidth(),null,invalid);}
    globalThis.window={localStorage:{getItem(){throw Error('unavailable')},setItem(){throw Error('full')},removeItem(){throw Error('denied')}}};
    assert.equal(loadBrowserWidth(),null);assert.equal(saveBrowserWidth(600),false);assert.equal(saveBrowserWidth(null),false);
  } finally { globalThis.window=original; }
});
