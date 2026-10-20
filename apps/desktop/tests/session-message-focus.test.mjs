import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

test('Chromium: a file search result opens its Session at the file message and highlights it', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { DesktopShellView } from './src/renderer/shell';
    document.currentScript?.remove();
    window.hermesDesktop={getRuntimeInfo:()=>({viewRole:'tab'})};
    const checks=[];
    const ensure=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
    const wait=(ms=100)=>new Promise(resolve=>setTimeout(resolve,ms));
    const message=(n,role='user',extra={})=>({id:'m'+n,refSeq:n,role,text:'Synthetic message '+n+'\\\\n\\\\n'+'Wrapped content. '.repeat(35),toolCalls:[],attachments:[],createdAt:1792000000+n,...extra});
    // ref 10 is Agent work before its final reply, so its group starts folded.
    const messages=Array.from({length:30},(_,i)=>i+1).map(n=>n===10?message(n,'assistant',{text:'Synthetic interim with the file'}):n===11?message(n,'assistant',{displayKind:'final'}):message(n));
    let snapshot={phase:'connected',tabActive:true,channels:[],threads:[{id:'t',running:false}],selectedThreadId:'t',messages,interactions:[],canLoadOlder:false,loadingMessages:false};
    const root=createRoot(document.getElementById('root'));
    const render=()=>flushSync(()=>root.render(<DesktopShellView snapshot={snapshot}/>));
    const list=()=>document.querySelector('.message-list');
    const row=ref=>document.querySelector('[data-result-ref="'+ref+'"]');
    const inView=ref=>{const box=row(ref)?.getBoundingClientRect(),view=list().getBoundingClientRect();return !!box&&box.height>0&&box.top>=view.top-1&&box.bottom<=view.bottom+1;};
    const atBottom=()=>Math.abs(list().scrollHeight-list().clientHeight-list().scrollTop)<1;
    (async()=>{try {
      render();await wait();ensure('a Session opens at its end',atBottom());
      snapshot={...snapshot,focusMessage:{refSeq:4,version:1}};render();await wait();
      ensure('the file message is in view',inView(4));ensure('the file message is highlighted',row(4).classList.contains('message-focused'));
      const reading=list().scrollTop;
      snapshot={...snapshot,messages:[...snapshot.messages,message(31,'assistant',{displayKind:'final'})]};render();await wait();
      ensure('a new message keeps the shown message',list().scrollTop===reading);
      await wait(2500);ensure('the highlight ends',!row(4).classList.contains('message-focused'));
      // History still loading: no jump until it is complete.
      snapshot={...snapshot,loadingHistory:true,focusMessage:{refSeq:10,version:2}};render();await wait();
      ensure('no jump while history loads',list().scrollTop===reading);
      snapshot={...snapshot,loadingHistory:false};render();await wait();await wait();
      ensure('a message in a folded work group unfolds and is in view',inView(10)&&!row(10).hidden&&row(10).classList.contains('message-focused'));
      const second=list().scrollTop;
      list().scrollTop=0;list().dispatchEvent(new Event('scroll',{bubbles:true}));await wait();render();await wait();
      ensure('the same request jumps only once',list().scrollTop===0&&second>0);
      snapshot={...snapshot,focusMessage:{refSeq:10,version:3}};render();await wait();
      ensure('a new request for the same message jumps again',inView(10));
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks});root.unmount();
    }catch(error){document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(error),checks});}})();
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const folder = await mkdtemp(join(tmpdir(), 'session-message-focus-'));
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
    assert.equal(result.checks.length, 9);
  } finally { socket?.close();if(chrome){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited;}await rm(folder, { recursive: true, force: true }); }
});
