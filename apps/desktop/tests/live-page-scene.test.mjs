import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: independent session renderers retain DOM and reading position while host switches tabs', {skip:!process.env.HERMES_TEST_CHROME},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'desktop-live-pages-'));
  try {
    const bundle=await build({stdin:{resolveDir:new URL('../../../',import.meta.url).pathname,loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}})};
      const root=createRoot(document.getElementById('root'));
      const messages=Array.from({length:80},(_,i)=>({id:'a'+i,role:'assistant',text:'Synthetic row '+i,toolCalls:[],attachments:[]}));
      const a={id:'a',selectedThreadTitle:'A',messages,interactions:[],canLoadOlder:true},b={id:'b',selectedThreadTitle:'B',messages:[{...messages[0],id:'b1'}],interactions:[],canLoadOlder:false};
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[{id:'a',channelId:'p',title:'A',running:false},{id:'b',channelId:'p',title:'B',running:false}],selectedChannelId:'p',interactions:[],canLoadOlder:true};
      const render=(id,pages)=>flushSync(()=>root.render(<><button aria-label="Close B" onClick={()=>window.hermesDesktop.closeTab('b')}>Close B</button>{pages.map(page=><div key={page.id} data-session-page={page.id} hidden={page.id!==id}><DesktopShellView viewRole="tab" snapshot={{...base,...page,selectedThreadId:page.id,tabActive:page.id===id}}/></div>)}</>));
      const closed=[];window.hermesDesktop.closeTab=async id=>{closed.push(id);render('a',[a]);};
      render('a',[a]);const original=document.querySelector('[data-session-page="a"]'),list=original.querySelector('.message-list');
      list.scrollTop=220;list.dispatchEvent(new Event('scroll'));setTimeout(()=>{
        const offset=list.scrollTop;render('b',[a,b]);const covered=document.querySelector('[data-session-page="a"]')===original;
        document.querySelector('button[aria-label="Close B"]').click();document.getElementById('results').textContent=JSON.stringify({closed,covered,same:document.querySelector('[data-session-page="a"]')===original,offset,after:list.scrollTop,bRemoved:!document.querySelector('[data-session-page="b"]')});
      },20);
    `},bundle:true,minify:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8'),file=join(folder,'check.html');
    await writeFile(join(folder,'bundle.js'),bundle.outputFiles[0].text);
    await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=1280,900','--virtual-time-budget=1000',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:4_000_000,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');
    assert.ok(result);assert.deepEqual(result.closed,['b']);assert.equal(result.covered,true);assert.equal(result.same,true);assert.equal(result.bRemoved,true);assert.ok(result.offset>0);assert.equal(result.after,result.offset);
  }finally{await rm(folder,{recursive:true,force:true});}
});
