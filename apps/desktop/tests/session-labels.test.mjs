import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const bundle = await build({ entryPoints: [new URL('../src/renderer/thread-navigation.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { threadWindow } = mod.exports;
test('label filter precedes batching, includes all-time matches, and retains 24 per batch', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), channelId: 'p', title: String(i), lastMessageAt: 1, markers: i % 2 ? ['Foo'] : ['Other'], running: false }));
  const filter = { labels: ['Foo'], noLabels: false };
  const first = threadWindow(rows, 'p', Date.now(), 0, filter), second = threadWindow(rows, 'p', Date.now(), 1, filter);
  assert.equal(first.rows.length, 24); assert.equal(second.rows.length, 48);
  assert.ok(first.rows.every(row => row.markers.includes('Foo'))); assert.equal(first.hasMore, true);
  assert.equal(threadWindow(rows, 'p', Date.now(), 2, filter).rows.length, 50);
  assert.equal(threadWindow(rows, 'p', Date.now()).rows.length, 0);
  assert.equal(threadWindow(rows, 'p', Date.now(), 0, { labels: ['foo'], noLabels: false }).rows.length, 0);
  assert.equal(threadWindow([...rows, { id: 'empty', channelId: 'p', title: 'Empty', running: false }], 'p', Date.now(), 0, { labels: ['Foo'], noLabels: true }).rows.length, 24);
});

test('production desktop service refuses a stale connection target and a late confirmation', async () => {
  const source = await build({ entryPoints: [new URL('../src/main/connection-service.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });
  const module = { exports: {} }; new Function('require', 'module', 'exports', source.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const service = new module.exports.DesktopConnectionService(() => {});
  service.phase = 'connected'; service.connectionState = 'online'; service.connection = { id: 'old', baseUrl: 'https://synthetic.test' };
  let calls = 0, release;
  service.client = { async saveThreadLabels() { calls++; return new Promise(resolve => release = resolve); } };
  await assert.rejects(service.saveThreadLabels('A', ['Draft'], 1, 'other'), /connection changed/i); assert.equal(calls, 0);
  const pending = service.saveThreadLabels('A', ['Draft'], 1, 'old');
  service.connection = { id: 'new' }; release({ markers: ['Draft'], markers_updated_at: 1 });
  await assert.rejects(pending, /not confirmed/);
});

test('Chromium: actual measured pills, filter/tree interactions, connection reset and accessible editor failure retention', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'session-labels-desktop-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NavigationPanel} from './apps/desktop/src/renderer/navigation-panel'; import {LabelsEditor} from './apps/desktop/src/renderer/session-labels';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
      const root=createRoot(document.getElementById('nav')),editorRoot=createRoot(document.getElementById('editor'));
      let snapshot={connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',selectedThreadId:'current',channels:[{id:'p',name:'P'},{id:'q',name:'Empty channel'}],threads:[
        {id:'current',channelId:'p',title:'Current stays open',markers:[],running:false,lastMessageAt:Date.now()/1000},
        ...Array.from({length:55},(_,i)=>({id:'row'+i,channelId:'p',title:'Old '+i,markers:['Foo','Other','👩🏽‍💻'.repeat(15)],running:i===0,completedUnread:i===0,lastMessageAt:1}))]};
      let selected=0,closes=0,saves=[],gate,mode='pending',target;
      window.hermesDesktop={selectThread:async()=>{selected++},saveThreadLabels:async(...args)=>{saves.push(args);if(mode==='pending')return new Promise((resolve,reject)=>gate={resolve,reject});if(mode==='stale')return {markers:['Remote']};return {markers:args[1]}}};
      const close=()=>{closes++;flushSync(()=>editorRoot.render(null));};
      const edit=thread=>{target=thread;flushSync(()=>editorRoot.render(<LabelsEditor thread={thread} snapshot={snapshot} close={close}/>));};
      const render=()=>flushSync(()=>root.render(<NavigationPanel snapshot={snapshot} onNewSession={()=>{}} onEditLabels={edit}/>));
      const button=(container,text)=>[...container.querySelectorAll('button')].find(n=>n.textContent===text);
      const inputValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      (async()=>{try{
        render();await tick();ensure('running survives recent cutoff',document.querySelectorAll('.tree-thread').length===2);
        document.querySelector('[aria-label="Filter sessions"]').click();await tick();document.querySelector('input[aria-label="Label: Foo"]').click();await tick();
        ensure('running plus 24 batch',document.querySelectorAll('.tree-thread').length===25);ensure('hide empty channels',document.querySelectorAll('.channel-branch').length===1);
        ensure('matching branch expanded',document.querySelector('.channel-toggle').getAttribute('aria-expanded')==='true');
        ensure('current session unchanged',selected===0&&snapshot.selectedThreadId==='current');
        button(document,'Show more').click();await tick();ensure('running plus 48 batch',document.querySelectorAll('.tree-thread').length===49);
        ensure('running dot intact',document.querySelectorAll('.thread-status').length===1&&document.querySelectorAll('.thread-result-unread').length===1);
        const pillRow=document.querySelector('.tree-thread .label-pills');const full=()=>[...pillRow.querySelectorAll('.label-pills-visible .label-pill')];
        const widths=[];for(const width of [180,260,420]){document.getElementById('nav').style.width=width+'px';window.dispatchEvent(new Event('resize'));await tick();const box=pillRow.getBoundingClientRect();const pills=full();widths.push(pills.filter(n=>!n.classList.contains('label-overflow')).length);ensure('contained '+width,pills.every(n=>n.getBoundingClientRect().right<=box.right+.5));ensure('one line '+width,new Set(pills.map(n=>n.getBoundingClientRect().top)).size===1);}
        ensure('overflow measured',widths[0]<widths.at(-1)&&full().some(n=>n.scrollWidth>n.clientWidth));
        document.querySelector('.tree-thread .label-pill').click();await tick();ensure('chips route row click',selected===1);
        document.querySelector('.tree-thread').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100}));await tick();
        document.querySelector('[role="menuitem"]').click();await tick();
        const dialog=document.querySelector('dialog');ensure('accessible modal',dialog.open&&dialog.getAttribute('aria-labelledby')==='labels-editor-title');ensure('input focused on opening',document.activeElement===dialog.querySelector('[aria-label="Label text"]'));
        button(dialog,'Clear labels').click();await tick();inputValue(dialog.querySelector('[aria-label="Label text"]'),' Foo ');await tick();button(dialog,'Add').click();await tick();
        inputValue(dialog.querySelector('[aria-label="Label text"]'),' Foo ');await tick();button(dialog,'Add').click();await tick();ensure('exact duplicate rejection',dialog.textContent.includes('already in this list'));
        inputValue(dialog.querySelector('[aria-label="Label text"]'),'');await tick();
        dialog.querySelector('[aria-label="Edit label  Foo "]').click();await tick();inputValue(dialog.querySelector('[aria-label="Label text"]'),'foo');await tick();button(dialog,'Update').click();await tick();
        button(dialog,'Foo').click();await tick();dialog.querySelector('[aria-label="Remove label foo"]').click();await tick();
        ensure('edit remove reuse',dialog.querySelector('.labels-draft').textContent==='FooEditRemove');
        inputValue(dialog.querySelector('[aria-label="Label text"]'),'Unsubmitted');await tick();button(dialog,'Save').click();await tick();ensure('unsubmitted edit blocked',saves.length===0&&dialog.textContent.includes('before saving'));
        inputValue(dialog.querySelector('[aria-label="Label text"]'),'');await tick();
        const saveButton=button(dialog,'Save');saveButton.click();saveButton.click();await tick();ensure('duplicate submit stopped',saves.length===1&&saves[0][3]==='one');
        gate.reject(Error('Synthetic failure'));await tick();ensure('failed save draft retained',closes===0&&dialog.querySelector('.labels-draft').textContent==='FooEditRemove'&&dialog.textContent.includes('Could not confirm'));
        mode='stale';button(dialog,'Save').click();await tick();ensure('stale save draft retained',closes===0&&dialog.textContent.includes('changed on another device'));
        mode='success';button(dialog,'Save').click();await tick();ensure('confirmed save closes',closes===1);
        snapshot={...snapshot,connectionKey:'two'};render();await tick();ensure('connection reset',document.querySelectorAll('.tree-thread').length===2&&document.querySelector('input[aria-label="Label: Foo"]').checked===false);
        snapshot={...snapshot,supportsSessionLabels:false};render();await tick();ensure('capability gated',!document.querySelector('.labels-filter'));
        window.hermesDesktop.getRuntimeInfo=()=>({platform:'linux',versions:{}});
        const messages=Array.from({length:40},(_,i)=>({id:'synthetic'+i,role:'assistant',text:'Synthetic shell row '+i,toolCalls:[],attachments:[]}));
        const shell={...snapshot,phase:'connected',connectionKey:'shell-one',supportsSessionLabels:true,selectedThreadId:'row0',selectedThreadTitle:'Old 0',messages,interactions:[],sessionPages:[{id:'row0',messages,interactions:[],canLoadOlder:true}]};
        const shellRender=value=>flushSync(()=>root.render(<DesktopShellView snapshot={value}/>));
        shellRender(shell);await tick();
        const page=document.querySelector('.session-tab-page'),list=page.querySelector('.message-list'),composer=page.querySelector('[aria-label="Message"]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,'Keep this draft');composer.dispatchEvent(new Event('input',{bubbles:true}));await tick();
        list.scrollTop=120;list.dispatchEvent(new Event('scroll'));await tick();const offset=list.scrollTop;
        button(document.querySelector('.conversation-actions'),'Edit labels').click();await tick();
        ensure('header editor entry',document.querySelector('dialog').open);
        button(document.querySelector('dialog'),'Cancel').click();await tick();
        const updated={...shell,threads:shell.threads.map(t=>t.id==='row0'?{...t,markers:['Updated header']}:t)};shellRender(updated);await tick();
        ensure('authoritative header labels',document.querySelector('.conversation-header .label-pills').getAttribute('aria-label')==='Labels: Updated header');
        ensure('composer and page retained',page===document.querySelector('.session-tab-page')&&composer===page.querySelector('[aria-label="Message"]')&&composer.value==='Keep this draft'&&list.scrollTop===offset);
        button(document.querySelector('.conversation-actions'),'Edit labels').click();await tick();shellRender({...updated,connectionKey:'shell-two'});
        ensure('no old dialog on new connection',!document.querySelector('dialog'));
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="nav" style="width:260px"></div><div id="editor"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=6000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
    assert.ok(Object.keys(result).length >= 17); assert.ok(Object.values(result).every(Boolean));
    console.log('Production DOM checks:', Object.keys(result).length);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
