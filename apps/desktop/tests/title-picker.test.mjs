import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: title alphabet search, keyboard selection, IME and New topic creation', {skip: !process.env.HERMES_TEST_CHROME}, async () => {
  const bundle = await build({stdin: {resolveDir: new URL('..', import.meta.url).pathname, loader:'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {SessionPicker} from './src/renderer/session-picker'; import {NewSessionPage} from './src/renderer/new-session-page';
    import {sessionSearchScore} from '../../packages/client/src/sessionSearch';
    import {parseCatalogue} from '../../packages/client/src/liveProtocol';
    const checks=[], actions=[];let closed=0;
    const ensure=(n,v)=>{if(!v)throw Error(n);checks.push(n)};
    const snapshot={phase:'connected',channels:[{id:'p',name:'Project'}],threads:Array.from({length:30},(_,i)=>({id:'t'+i,channelId:'p',title:i===0?'恢复自动标题':'会话'+i,title_alphabet:i===0?'hui fu zi dong biao ti':'hui hua '+i,running:false,lastMessageAt:30-i}))};
    window.hermesDesktop={selectThread:async id=>actions.push(id),createThread:async data=>{ensure('placeholder restored',data.title==='New topic');return data.clientThreadId},startThread:async data=>{ensure('placeholder restored',data.title==='New topic');return data.clientThreadId},sendMessage:async()=>{},completeNewTab:async()=>{}};
    const root=createRoot(document.getElementById('root'));const render=()=>flushSync(()=>root.render(<SessionPicker snapshot={snapshot} close={()=>closed++}/>));
    const input=()=>document.querySelector('input'), options=()=>[...document.querySelectorAll('[role=option]')];
    const key=(name,extra={})=>flushSync(()=>input().dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,...extra})));
    const query=value=>flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}));});
    (async()=>{try{render();ensure('input focused',document.activeElement===input());ensure('initial first selected',options()[0].getAttribute('aria-selected')==='true');
      key('ArrowDown');ensure('next selected',options()[1].getAttribute('aria-selected')==='true');key('ArrowUp');ensure('previous selected',options()[0].getAttribute('aria-selected')==='true');key('ArrowUp');ensure('top clamped',options()[0].getAttribute('aria-selected')==='true');
      key('ArrowDown',{isComposing:true});key('Enter',{isComposing:true});key('Escape',{isComposing:true});ensure('IME untouched',options()[0].getAttribute('aria-selected')==='true'&&!actions.length&&!closed);
      key('ArrowDown');key('Enter');await Promise.resolve();ensure('Enter exact selected',actions[0]==='t1');ensure('close after open',closed===1);
      for(const value of ['自动标题','zi dong biao ti','zidongbiaoti','zdbt','HUIFU']){query(value);ensure('search '+value,options().length===1&&options()[0].textContent.includes('恢复自动标题'));ensure('search resets selected',options()[0].getAttribute('aria-selected')==='true');}
      query('no-match');key('Enter');ensure('empty no action',actions.length===1&&!options().length);key('Escape');ensure('Escape closes',closed===2);
      ensure('non-Chinese transliteration',Number.isFinite(sessionSearchScore({title:'Привет мир',title_alphabet:'privet mir'},'pm')));
      ensure('accent folding',Number.isFinite(sessionSearchScore({title:'Café'},'cafe')));
      const parsed=parseCatalogue({items:[{kind:'session',value:{id:'t',project_id:'p',title:'标题',title_alphabet:'biao ti',archived:false,running:false}}],next_after:null});ensure('metadata protocol',parsed.items[0].value.title_alphabet==='biao ti');
      let rejected=false;try{parseCatalogue({items:[{kind:'session',value:{id:'t',project_id:'p',title:'标题',title_alphabet:9,archived:false,running:false}}],next_after:null})}catch{rejected=true}ensure('bad metadata rejected',rejected);
      flushSync(()=>root.render(<NewSessionPage snapshot={snapshot}/>));const area=document.querySelector('textarea');flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'中文第一行');area.dispatchEvent(new Event('input',{bubbles:true}))});document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();
      ensure('creation exercised',checks.includes('placeholder restored'));
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks:checks.length});
    }catch(e){document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(e)})}})();
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const folder=await mkdtemp(join(tmpdir(),'title-picker-'));
  try {
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
    const file=join(folder,'check.html');
    await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--virtual-time-budget=1000','--dump-dom',`--user-data-dir=${join(folder,'profile')}`,pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:5000000,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');
    assert.equal(result?.ok,true,result?.error??'No result');assert.ok(result.checks>=24);
  }finally{await rm(folder,{recursive:true,force:true})}
});
