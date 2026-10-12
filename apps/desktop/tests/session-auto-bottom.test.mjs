import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

test('Chromium: exact tail survives delayed layout; send resumes follow without stealing reading position', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { DesktopShellView } from './src/renderer/shell';
    document.currentScript?.remove();
    let fail=false;
    window.hermesDesktop={sendMessage:async()=>{if(fail)throw Error('synthetic failure');},getRuntimeInfo:()=>({viewRole:'tab'})};
    const checks=[];
    const ensure=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
    const wait=()=>new Promise(resolve=>setTimeout(resolve,100));
    const message=(id,role='user')=>({id,role,text:'Synthetic message '+id+'\\n\\n'+'Wrapped content. '.repeat(35),toolCalls:[],attachments:[]});
    let snapshot={phase:'connected',tabActive:true,channels:[],threads:[{id:'t',running:false}],selectedThreadId:'t',messages:[],interactions:[],canLoadOlder:false,loadingMessages:true};
    const root=createRoot(document.getElementById('root'));
    const render=()=>flushSync(()=>root.render(<DesktopShellView snapshot={snapshot}/>));
    const list=()=>document.querySelector('.message-list');
    const gap=()=>list().scrollHeight-list().clientHeight-list().scrollTop;
    const bottom=name=>ensure(name,Math.abs(gap())<1);
    const scrollUp=()=>flushSync(()=>{list().scrollTop=100;list().dispatchEvent(new Event('scroll',{bubbles:true}));});
    const grow=()=>{const row=document.querySelector('.timeline-entry');row.style.paddingBottom=(parseInt(row.style.paddingBottom||'0')+300)+'px';};
    const fill=()=>flushSync(()=>{const input=document.querySelector('.composer-box textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'New synthetic input');input.dispatchEvent(new Event('input',{bubbles:true}));});
    const send=()=>flushSync(()=>document.querySelector('.send-button').click());
    (async()=>{try {
      render();await wait();snapshot={...snapshot,loadingMessages:false,messages:Array.from({length:20},(_,i)=>message('m'+i))};render();await wait();bottom('first loaded history at bottom');
      grow();await wait();bottom('delayed rich-content growth at bottom');
      document.querySelector('.session-tab-page').style.height='650px';await wait();bottom('viewport shrink at bottom');
      scrollUp();const reading=list().scrollTop;grow();await wait();ensure('growth preserves reading',list().scrollTop===reading);
      snapshot={...snapshot,messages:[...snapshot.messages,message('reply','assistant')]};render();await wait();ensure('Agent reply preserves reading',list().scrollTop===reading);
      fill();send();await wait();bottom('accepted local send resumes follow');ensure('sent draft cleared',document.querySelector('.composer-box textarea').value==='');
      snapshot={...snapshot,messages:[...snapshot.messages,message('local')]};render();grow();await wait();bottom('later optimistic commit and rich layout at bottom');
      scrollUp();const failedPosition=list().scrollTop;fail=true;fill();send();await wait();ensure('failed save preserves reading',list().scrollTop===failedPosition);ensure('failed save retains draft',document.querySelector('.composer-box textarea').value==='New synthetic input');
      snapshot={...snapshot,tabActive:false};render();grow();await wait();ensure('inactive page does not follow',list().scrollTop===failedPosition);
      snapshot={...snapshot,tabActive:true};render();await wait();ensure('retained reading position survives return',list().scrollTop===failedPosition);
      const scrollTo=y=>flushSync(()=>{list().scrollTop=y;list().dispatchEvent(new Event('scroll',{bubbles:true}));});
      scrollTo(list().scrollHeight-list().clientHeight-30);const near=list().scrollTop;await wait();ensure('near-end scroll does not snap',list().scrollTop===near);
      grow();await wait();ensure('near-end growth preserves reading',list().scrollTop===near);
      scrollTo(list().scrollHeight);await wait();grow();await wait();bottom('reaching the end resumes follow');
      // Typing in a multi-line composer re-measures the textarea; the timeline must stay at its end.
      const type=value=>flushSync(()=>{const input=document.querySelector('.composer-box textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
      type('Line one\\nLine two\\nLine three\\nLine four');await wait();bottom('multi-line composer growth at bottom');
      type('Line one\\nLine two\\nLine three\\nLine four and');await wait();bottom('typing in a multi-line composer keeps bottom');
      type('Line one\\nLine two\\nLine three\\nLine four and more');await wait();bottom('repeated multi-line typing keeps bottom');
      grow();await wait();bottom('follow survives multi-line typing');
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks});root.unmount();
    }catch(error){document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(error),checks});}})();
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const folder = await mkdtemp(join(tmpdir(), 'session-auto-bottom-'));
  let chrome, socket;
  try {
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    chrome = spawn(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1000,900', `--user-data-dir=${join(folder, 'profile')}`, 'about:blank'], {stdio:['ignore','ignore','pipe']});
    const endpoint = await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Chrome readiness timeout')),10000);
      chrome.stderr.on('data',chunk=>{output+=chunk;const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});
      chrome.on('error',reject);
    });
    const targets=await (await fetch(new URL('/json/list',endpoint.replace('ws:','http:')))).json();
    socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    let id=0;const pending=new Map();
    socket.on('message',bytes=>{const reply=JSON.parse(String(bytes));const waiter=pending.get(reply.id);if(waiter){pending.delete(reply.id);reply.error?waiter.reject(reply.error):waiter.resolve(reply.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
    await call('Page.enable');
    const loaded=new Promise(resolve=>{const listener=bytes=>{if(JSON.parse(String(bytes)).method==='Page.loadEventFired'){socket.off('message',listener);resolve();}};socket.on('message',listener);});
    await call('Page.navigate',{url:pathToFileURL(file).href});await loaded;
    const evaluation=await call('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const check=()=>{const text=document.getElementById('results')?.textContent;if(text)resolve(JSON.parse(text));else if(Date.now()>deadline)reject(Error('Browser checks timed out'));else setTimeout(check,50);};check();})`,awaitPromise:true,returnByValue:true});
    const result=evaluation.result?.value;
    assert.equal(result?.ok, true, JSON.stringify(result));
    assert.equal(result.checks.length, 19);
  } finally { socket?.close();if(chrome){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited;}await rm(folder, { recursive: true, force: true }); }
});
