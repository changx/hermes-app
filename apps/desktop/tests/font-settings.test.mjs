import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

async function preference() {
  const bundle = await build({entryPoints:[new URL('../src/renderer/font-preference.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
  const mod={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports);return mod.exports;
}
function environment(storage) {
  const applied=[];globalThis.window={localStorage:storage};globalThis.document={documentElement:{style:{setProperty:(...args)=>applied.push(args)}}};return applied;
}
test('font preference defaults to 16, saves only one local key and restores across new modules',async()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const applied=environment(storage),p=await preference();p.initializeFontSize();assert.equal(p.getFontSize(),16);
  assert.equal(p.setFontSize(20),true);assert.deepEqual([...data],[[p.FONT_SIZE_KEY,'20']]);
  const cold=await preference();cold.initializeFontSize();assert.equal(cold.getFontSize(),20);assert.deepEqual(applied.at(-1),['--app-font-size','20px']);
});
test('invalid, fractional and out-of-range font values cannot reach CSS or storage',async()=>{
  let stored='garbage',writes=0;environment({getItem:()=>stored,setItem:()=>writes++});const p=await preference();
  for(const value of ['garbage','', '11','25','18.4','Infinity']) {stored=value;p.initializeFontSize();assert.equal(p.getFontSize(),16);}
  for(const value of [NaN,Infinity,11,25,18.4]) assert.equal(p.setFontSize(value),false);
  assert.equal(writes,0);assert.deepEqual(p.FONT_SIZES,[12,13,14,15,16,17,18,19,20,21,22,23,24]);
});
test('storage failures retain a live usable font and report load/save failure without clearing data',async()=>{
  environment({getItem(){throw Error('private error');},setItem(){throw Error('private error');}});
  const p=await preference();p.initializeFontSize();assert.equal(p.getFontSize(),16);assert.equal(p.fontLoadFailed(),true);
  assert.equal(p.setFontSize(24),false);assert.equal(p.getFontSize(),24);
});
test('storage changes from another WebContentsView update text size once without feedback writes',async()=>{
  let listen,writes=0;const applied=environment({getItem:()=>null,setItem:()=>writes++});
  window.addEventListener=(name,listener)=>{assert.equal(name,'storage');listen=listener;};
  const p=await preference();p.initializeFontSize();listen({key:p.FONT_SIZE_KEY,newValue:'18'});
  assert.equal(p.getFontSize(),18);assert.deepEqual(applied.at(-1),['--app-font-size','18px']);assert.equal(writes,0);
  listen({key:p.FONT_SIZE_KEY,newValue:'999'});assert.equal(p.getFontSize(),18);
});

test('Chromium: real settings change text only, reset, retain pages, persist to cold browser and show storage errors', {skip:!process.env.HERMES_TEST_CHROME},async()=>{
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {DesktopShellView} from './src/renderer/shell';import {initializeFontSize,FONT_SIZE_KEY} from './src/renderer/font-preference';
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{chrome:'test',electron:'test'}})};
    const stage=new URL(location.href).searchParams.get('stage'),checks=[];
    const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name)};
    const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
    const root=createRoot(document.getElementById('root'));
    const snapshot={revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'Example'}],threads:[{id:'t',channelId:'p',title:'Font preview',markers:['Label'],running:false,lastMessageAt:Date.now()/1000}],selectedChannelId:'p',selectedThreadId:'t',supportsSessionLabels:true,interactions:[],canLoadOlder:false,messages:[{id:'a',role:'assistant',displayKind:'direct',text:'Paragraph and inline \\u0060code\\u0060.\\n\\n| Name | Value |\\n| --- | --- |\\n| Row | Text |\\n\\n\\u0060\\u0060\\u0060text\\nFenced code\\n\\u0060\\u0060\\u0060',toolCalls:[{id:'cmd',name:'terminal',label:'Run command',detail:'git status'}],attachments:[]}]};
    const render=(value=snapshot)=>flushSync(()=>root.render(<DesktopShellView snapshot={value}/>));
    const open=()=>{document.querySelector('[aria-label="Settings"]').focus();flushSync(()=>document.querySelector('[aria-label="Settings"]').click());};
    const change=value=>{const select=document.querySelector('[aria-label="Text size"]');select.value=String(value);flushSync(()=>select.dispatchEvent(new Event('change',{bubbles:true})));};
    const geometry=()=>{const page=getComputedStyle(document.querySelector('.session-tab-page')),text=getComputedStyle(document.querySelector('.composer textarea')),icon=getComputedStyle(document.querySelector('.attach-button'));return [page.width,text.padding,icon.width,icon.height].join('|');};
    const textSize=size=>['.conversation-header h2','.message p','.message code','.message td','.tool-record','.tool-command','.composer textarea','.font-settings select'].every(selector=>getComputedStyle(document.querySelector(selector)).fontSize===size+'px');
    void(async()=>{try{
      if(stage==='first')localStorage.removeItem(FONT_SIZE_KEY);
      initializeFontSize();check('font initialized before mount',getComputedStyle(document.documentElement).fontSize===(stage==='first'?'16px':'20px'));
      render();open();check('native modal open and focused',document.querySelector('dialog').matches(':modal')&&document.activeElement.getAttribute('aria-label')==='Text size');
      if(stage==='first'){
        const original=document.querySelector('.message'),before=geometry();
        for(const size of [12,16,18,24]){change(size);check('UI/content/code/tool size '+size,textSize(size));check('spacing/icons unchanged '+size,geometry()===before);check('message identity retained '+size,document.querySelector('.message')===original);check('persisted '+size,localStorage.getItem(FONT_SIZE_KEY)===String(size));
          for(const pill of document.querySelectorAll('.label-pills-visible .label-pill')){const child=pill.getBoundingClientRect(),parent=pill.parentElement.getBoundingClientRect();check('label not clipped '+size,child.top>=parent.top-1&&child.bottom<=parent.bottom+1);}
        }
        flushSync(()=>[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Reset to 16').click());check('reset saves default',textSize(16)&&localStorage.getItem(FONT_SIZE_KEY)==='16');
        change(20);document.querySelector('dialog').close();await tick();check('Done closes and restores focus',!document.querySelector('dialog')&&document.activeElement.getAttribute('aria-label')==='Settings');
        render({...snapshot,phase:'unpaired'});open();check('settings available before pairing',document.querySelector('dialog').matches(':modal'));document.querySelector('dialog').close();await tick();
      }else{
        check('cold browser restored setting',textSize(20)&&document.querySelector('select').value==='20');
        const nativeWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('private storage detail')};change(24);
        check('save failure remains live and honest',textSize(24)&&document.querySelector('[role="alert"]').textContent.includes('could not be saved')&&localStorage.getItem(FONT_SIZE_KEY)==='20');
        Storage.prototype.setItem=nativeWrite;change(18);check('save retry clears warning',!document.querySelector('[role="alert"]')&&localStorage.getItem(FONT_SIZE_KEY)==='18');
        document.querySelector('dialog').close();await tick();const nativeRead=Storage.prototype.getItem;Storage.prototype.getItem=function(){throw Error('private storage detail')};initializeFontSize();open();
        check('read failure has usable default and warning',textSize(16)&&document.querySelector('[role="alert"]').textContent.includes('could not be loaded'));
        Storage.prototype.getItem=nativeRead;change(16);check('recovery clears read failure',!document.querySelector('[role="alert"]'));
      }
    }catch(error){checks.push({name:String(error),ok:false});}
    document.getElementById('results').textContent=JSON.stringify(checks);document.querySelectorAll('script').forEach(script=>script.remove());})();
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const folder=await mkdtemp(join(tmpdir(),'desktop-font-settings-'));
  try{
    const file=join(folder,'check.html');await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    for(const stage of ['first','cold']){
      const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'profile')}`,'--virtual-time-budget=1500','--dump-dom',pathToFileURL(file).href+'?stage='+stage],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
      const checks=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');assert.ok(checks?.length>=6,JSON.stringify(checks));assert.ok(checks.every(row=>row.ok),JSON.stringify(checks));
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});
