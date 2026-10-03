import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
test('Chromium production React: Working, manual toggle, final auto collapse, reopen, history and next run', {skip:!process.env.HERMES_TEST_CHROME},async()=>{
 const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
 const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {DesktopShellView} from './src/renderer/shell';
 window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{chrome:'test',electron:'test'}})};
 const root=createRoot(document.getElementById('root')),checks=[];
 const msg=(id,text,extra={})=>({id,role:'assistant',text,createdAt:100,refSeq:1,toolCalls:[],attachments:[],...extra});
 const base={revision:1,phase:'connected',connectionState:'online',channels:[],threads:[{id:'t',channelId:'c',title:'Test',running:true}],selectedThreadId:'t',interactions:[],canLoadOlder:false};
 const process=[msg('a','Public progress'),msg('tool','',{refSeq:2,createdAt:110,toolCalls:[{id:'cmd',name:'terminal',label:'Run command',detail:'git status --short'}]})];
 const render=(messages,extra={})=>flushSync(()=>root.render(<DesktopShellView snapshot={{...base,messages,...extra}}/>));
 const button=()=>document.querySelector('.work-toggle');const visible=()=>[...document.querySelectorAll('.message:not([hidden])')].map(n=>n.textContent.trim());
 const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name)};
 try{
 render(process);check('active expanded Working',button().textContent.includes('Working')&&button().getAttribute('aria-expanded')==='true'&&visible().length===2);
 flushSync(()=>button().click());check('manual collapse',visible().length===0&&button().getAttribute('aria-expanded')==='false');
 flushSync(()=>button().click());check('manual expand',visible().length===2);
 const messages=[...process,msg('f','Final answer',{displayKind:'final',createdAt:120,refSeq:3})];
 render(messages);check('final immediately collapses despite active override',button().textContent.includes('Worked for 20s')&&button().getAttribute('aria-expanded')==='false'&&visible().length===1);
 check('final remains visible',visible()[0].includes('Final answer'));
 const hidden=document.querySelector('.message[hidden]');check('collapsed has zero height',hidden.getBoundingClientRect().height===0);
 check('divider',getComputedStyle(document.querySelector('.work-heading')).borderBottomWidth==='1px');
 button().focus();flushSync(()=>button().click());check('reopen exact commentary and command',visible().length===3&&visible()[0].includes('Public progress')&&visible()[1].includes('git status --short'));
 render(messages);check('same-final update keeps reopened',button().getAttribute('aria-expanded')==='true');
 render([...messages,msg('next','New run',{createdAt:130,refSeq:4})]);check('new run independent Working',document.querySelectorAll('.work-toggle')[1].textContent.includes('Working'));
 render(messages,{selectedThreadId:'other',threads:[]});check('cold page defaults collapsed',button().getAttribute('aria-expanded')==='false');
 check('no assistant times',document.querySelectorAll('.message-time').length===0);
 }catch(error){checks.push({name:String(error),ok:false});}
 document.getElementById('results').textContent=JSON.stringify(checks);
 document.currentScript?.remove();
 `},bundle:true,platform:'browser',format:'iife',write:false});
 const folder=await mkdtemp(join(tmpdir(),'hermes-work-'));
 try{
  const file=join(folder,'test.html');await writeFile(file,`<html><head><style>${css}</style></head><body><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'profile')}`,'--virtual-time-budget=1000','--dump-dom',pathToFileURL(file).href],{encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','pipe']});
  const checks=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)[1]);assert.ok(checks.length>=12,JSON.stringify(checks));assert.ok(checks.every(c=>c.ok),JSON.stringify(checks));
 }finally{await rm(folder,{recursive:true,force:true});}
});
