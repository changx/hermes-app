import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

// Drive real pointer input: dispatching a DOM mouse event does not activate :hover.
test('Chromium: native sidebar tree indentation, pointer hover, selection and collapse', { skip: !process.env.HERMES_TEST_CHROME, timeout: 30000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sidebar-tree-'));
  let chrome, socket;
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NavigationPanel} from './apps/desktop/src/renderer/navigation-panel';
      window.selected=[]; window.hermesDesktop={selectThread:async id=>window.selected.push(id)};
      const snapshot={connectionKey:'fixture',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',selectedThreadId:'one',channels:[{id:'p',name:'Example Channel'},{id:'q',name:'Empty Channel'}],threads:[
        {id:'one',channelId:'p',title:'Selected session',markers:['Design'],lastMessageAt:Date.now()/1000},
        {id:'two',channelId:'p',title:'A long session title that must truncate without hiding status',markers:['Review'],running:true,completedUnread:true,lastMessageAt:Date.now()/1000}
      ]};
      flushSync(()=>createRoot(document.getElementById('nav')).render(<NavigationPanel snapshot={snapshot} draftThreads={new Set(['two'])} onNewSession={()=>{}} onChannelOptions={()=>{}}/>));
    ` }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><aside class="native-sidebar" style="width:280px;height:900px"><div id="nav"></div></aside><script src="bundle.js"></script>`);
    chrome = spawn(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(folder, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(Error('DevTools startup timeout')), 10000);
      chrome.once('error', reject);
      chrome.stderr.on('data', chunk => { stderr += chunk; const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let id = 0;
    const pending = new Map();
    socket.on('message', data => { const result = JSON.parse(data); if (pending.has(result.id)) { const {resolve,reject} = pending.get(result.id); pending.delete(result.id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); } });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, {resolve,reject}); socket.send(JSON.stringify({id:key,method,params,...(sessionId ? {sessionId} : {})})); });
    const { targetInfos } = await send('Target.getTargets');
    const { sessionId } = await send('Target.attachToTarget', {targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true});
    const call = (method,params) => send(method,params,sessionId);
    const evaluate = async expression => { const result = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails)); return result.result.value; };
    await call('Page.navigate',{url:pathToFileURL(file).href});
    await evaluate(`new Promise(resolve=>{const wait=()=>document.querySelector('.tree-thread')?resolve(true):setTimeout(wait,10);wait()})`);
    const hover = async selector => {
      const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    };
    const background = selector => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
    const evidence = [];
    for (const width of [230,280]) {
      await evaluate(`document.querySelector('aside').style.width='${width}px'`);
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:600,y:600});
      const geometry = await evaluate(`(()=>{const title=document.querySelector('.channel-toggle strong').getBoundingClientRect(),row=document.querySelector('.thread-title').getBoundingClientRect(),children=getComputedStyle(document.querySelector('.thread-children'));return {indent:row.left-title.left,guide:children.borderLeftWidth,overflow:document.querySelector('aside').scrollWidth>${width}}})()`);
      assert.ok(geometry.indent >= 16, `visible child indentation: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.guide,'1px'); assert.equal(geometry.overflow,false);
      const idle = await background('.tree-thread:not(.selected)');
      await hover('.tree-thread:not(.selected)');
      const active = await background('.tree-thread:not(.selected)');
      const sidebar = await background('.native-sidebar');
      assert.notEqual(active,idle); assert.notEqual(active,sidebar);
      const selected = await background('.tree-thread.selected');
      await hover('.tree-thread.selected'); assert.equal(await background('.tree-thread.selected'),selected); assert.notEqual(selected,active);
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:600,y:600});
      const channelIdle = await background('.channel-toolbar');
      await hover('.channel-toggle'); const channelHover = await background('.channel-toolbar');
      assert.notEqual(channelIdle,channelHover); assert.notEqual(channelHover,sidebar);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.channel-options')).opacity`),'1');
      assert.equal(await evaluate(`document.querySelectorAll('.thread-draft,.thread-status,.thread-result-unread').length`),3);
      evidence.push({width,geometry,idle,active,sidebar,selected,channelIdle,channelHover});
    }
    await evaluate(`document.querySelector('.tree-thread:not(.selected)').click()`);
    assert.deepEqual(await evaluate('window.selected'),['two']);
    await evaluate(`document.querySelector('.channel-toggle').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.tree-thread').length`),0);
    assert.equal(await evaluate(`document.querySelector('.channel-toggle').getAttribute('aria-expanded')`),'false');
    await evaluate(`document.querySelector('.channel-toggle').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.tree-thread').length`),2);
    if (process.env.HERMES_SIDEBAR_EVIDENCE) {
      await mkdir(process.env.HERMES_SIDEBAR_EVIDENCE,{recursive:true});
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE,'computed-styles.json'),JSON.stringify(evidence,null,2)+'\n');
      await hover('.tree-thread:not(.selected)');
      const {data} = await call('Page.captureScreenshot',{format:'png'});
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE,'sidebar.png'),Buffer.from(data,'base64'));
    }
    console.log(JSON.stringify(evidence));
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) { const exited = new Promise(resolve=>chrome.once('exit',resolve)); chrome.kill(); await exited; }
    await rm(folder,{recursive:true,force:true});
  }
});
