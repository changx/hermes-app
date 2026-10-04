import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test('Chromium: loading animation, reduced motion and full-history prepend retain the reading anchor', {skip:!process.env.HERMES_TEST_CHROME}, async()=>{
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {DesktopShellView} from './src/renderer/shell';
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{chrome:'test',electron:'test'}}),loadOlder:async()=>{}};
    const root=createRoot(document.getElementById('root')),checks=[];
    const base={revision:1,phase:'connected',connectionState:'online',channels:[],threads:[],selectedThreadId:'t',interactions:[],canLoadOlder:true};
    const message=i=>({id:'m'+i,refSeq:i,role:'assistant',text:'Message '+i+' '+('long text '.repeat(80)),toolCalls:[],attachments:[]});
    const recent=Array.from({length:30},(_,i)=>message(i+221));
    const render=extra=>flushSync(()=>root.render(<DesktopShellView snapshot={{...base,messages:recent,...extra}}/>));
    const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name)};
    try{
      render({loadingMessages:true,messages:[]});
      const spinner=document.querySelector('.conversation-loading-spinner');
      check('initial status',document.querySelector('[aria-busy="true"]').textContent.includes('Loading messages'));
      check('animation real computed CSS',getComputedStyle(spinner).animationName===(matchMedia('(prefers-reduced-motion: reduce)').matches?'none':'conversation-loading-spin'));
      render({});const list=document.querySelector('.message-list');list.scrollTop=800;flushSync(()=>list.dispatchEvent(new Event('scroll',{bubbles:true})));
      const anchor=document.querySelector('[data-result-ref="225"]');
      const y=anchor.getBoundingClientRect().top;
      render({loadingHistory:true});check('history status and readable content',document.querySelector('.history-loading-status')&&document.querySelectorAll('.message').length===30);
      check('loading does not move anchor',Math.abs(anchor.getBoundingClientRect().top-y)<1);
      const all=Array.from({length:250},(_,i)=>message(i+1));
      render({messages:all,canLoadOlder:false,loadingHistory:false});
      check('all rows loaded',document.querySelectorAll('.message').length===250);
      check('prepend keeps original row position',Math.abs(document.querySelector('[data-result-ref="225"]').getBoundingClientRect().top-y)<1);
      check('status and older action removed',!document.querySelector('.conversation-loading-spinner')&&!document.querySelector('.load-older'));
    }catch(error){checks.push({name:String(error),ok:false})}
    document.getElementById('results').textContent=JSON.stringify(checks);document.querySelectorAll('script').forEach(s=>s.remove());
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const dir=await mkdtemp(join(tmpdir(),'full-history-browser-'));
  try{
    const file=join(dir,'test.html');await writeFile(file,`<html><head><style>${css}</style></head><body><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script></body></html>`);
    for(const reduced of [false,true]){
      const output=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=1280,900',...(reduced?['--force-prefers-reduced-motion']:[]),`--user-data-dir=${join(dir,reduced?'reduced':'normal')}`,'--virtual-time-budget=1000','--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:4e6,stdio:['ignore','pipe','pipe']});
      const checks=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(output)[1]);assert.ok(checks.length>=7,JSON.stringify(checks));assert.ok(checks.every(c=>c.ok),JSON.stringify(checks));
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});
