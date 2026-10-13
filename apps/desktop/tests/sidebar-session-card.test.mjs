import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const LONG = 'A very long Session title that the sidebar row must truncate, and the hover card must show in full without cutting any words';

// Real pointer input through DevTools: synthetic DOM events do not exercise hover.
test('Chromium: sidebar Session card shows the full title fast, stays in the sidebar, and closes', { skip: !process.env.HERMES_TEST_CHROME, timeout: 30000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sidebar-card-'));
  let chrome, socket;
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NavigationPanel} from './apps/desktop/src/renderer/navigation-panel';
      window.selected=[]; window.hermesDesktop={selectThread:async id=>window.selected.push(id)};
      const now=Date.now()/1000;
      const threads=[{id:'long',channelId:'p',title:${JSON.stringify(LONG)},markers:['Design','todo'],running:true,completedUnread:true,lastMessageAt:now-60},
        {id:'short',channelId:'p',title:'Short one',markers:[],running:false,lastMessageAt:now-120}];
      for(let i=0;i<30;i++) threads.push({id:'f'+i,channelId:'q',title:'Filler session '+i,markers:[],running:false,lastMessageAt:now-200-i});
      const snapshot={connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',selectedThreadId:'short',
        connections:[{id:'a',name:'Home',server:'https://a.example',state:'online',connectionKey:'one'},{id:'b',name:'Work',server:'https://b.example',state:'online',connectionKey:'two'}],
        channels:[{id:'p',name:'Example Project',connectionKey:'one',connectionName:'Home'},{id:'q',name:'Other Project',connectionKey:'one',connectionName:'Home'}],threads};
      flushSync(()=>createRoot(document.getElementById('nav')).render(<NavigationPanel snapshot={snapshot} draftThreads={new Set(['long'])} onNewSession={()=>{}}/>));
    ` }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    // The sidebar is the left column; the page to its right stands in for the native Session view.
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} body{margin:0}</style><aside class="native-sidebar" style="width:260px;height:700px"><div id="nav" style="display:contents"></div></aside><script src="bundle.js"></script></html>`);
    chrome = spawn(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1000,700', '--remote-debugging-port=0', `--user-data-dir=${join(folder, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    socket.on('message', data => { const result = JSON.parse(data); if (pending.has(result.id)) { const { resolve, reject } = pending.get(result.id); pending.delete(result.id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); } });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const { targetInfos } = await send('Target.getTargets');
    const { sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find(t => t.type === 'page').targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value; };
    await call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: pathToFileURL(file).href });
    await evaluate(`new Promise(resolve=>{const wait=()=>document.querySelector('[data-thread-id="long"]')?resolve(true):setTimeout(wait,10);wait()})`);
    const center = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const move = point => call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    const card = () => evaluate(`(()=>{const c=document.querySelector('.session-hover-card');if(!c)return null;const r=c.getBoundingClientRect(),s=getComputedStyle(c);return {title:c.querySelector('.session-hover-title').textContent,text:c.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom,visible:s.visibility,font:parseFloat(getComputedStyle(c.querySelector('.session-hover-title')).fontSize),labels:[...c.querySelectorAll('.label-pill')].map(e=>e.textContent)}})()`);
    const waitCard = async (want, limit = 1000) => { const start = Date.now(); for (;;) { const value = await card(); if (want(value)) return { value, ms: Date.now() - start }; if (Date.now() - start > limit) return { value, ms: -1 }; await new Promise(r => setTimeout(r, 15)); } };
    const sidebar = await evaluate(`(()=>{const r=document.querySelector('aside').getBoundingClientRect();return {left:r.left,right:r.right}})()`);
    const row = selector => `#sidebar-recents-list [data-thread-id="${selector}"]`;
    const evidence = {};

    assert.equal(await evaluate(`document.querySelectorAll('.tree-thread[data-thread-id][title]').length`), 0, 'no native title tooltip on Session rows');
    const truncated = await evaluate(`(()=>{const t=document.querySelector('${row('long')} .thread-title');return t.scrollWidth>t.clientWidth})()`);
    assert.ok(truncated, 'the row truncates the long title');

    await move({ x: 700, y: 650 });
    const hoverAt = Date.now();
    await move(await center(row('long')));
    const first = await waitCard(v => v && v.visible === 'visible');
    evidence.firstShowMs = Date.now() - hoverAt;
    assert.ok(first.ms >= 0 && evidence.firstShowMs < 700, `card shows fast: ${evidence.firstShowMs}ms`);
    const shown = first.value;
    evidence.card = shown;
    assert.equal(shown.title, LONG, 'full title');
    assert.ok(shown.font >= 16, `title at the sidebar text size: ${shown.font}px`);
    assert.ok(shown.left >= sidebar.left && shown.right <= sidebar.right, `card stays in the sidebar: ${JSON.stringify(shown)}`);
    assert.ok(shown.bottom - shown.top > 60, 'long title wraps onto several lines');
    const anchor = await evaluate(`document.querySelector('${row('long')}').getBoundingClientRect().bottom`);
    assert.ok(shown.top >= anchor, 'card under its row, not over it');
    assert.match(shown.text, /Example Project · Home/);
    assert.match(shown.text, /Running · Draft · Completed, unread · Todo/);
    assert.deepEqual(shown.labels, ['Design'], 'labels without the todo flag');
    assert.match(shown.text, /Last message /);
    assert.equal(await evaluate(`document.querySelector('${row('long')}').getAttribute('aria-describedby')`), 'sidebar-session-card');

    // Moving to the next row switches the card at once.
    await move(await center(row('short')));
    const next = await waitCard(v => v && v.title === 'Short one', 200);
    assert.ok(next.ms >= 0 && next.ms < 120, `warm switch: ${next.ms}ms`);
    assert.doesNotMatch(next.value.text, /Running|Draft|Todo/);

    // Leaving the list closes it.
    await move({ x: 700, y: 650 });
    assert.equal((await waitCard(v => v === null, 300)).value, null, 'pointer leaves: card closes');

    // A click closes it; it stays closed while the pointer stays on that row.
    await new Promise(r => setTimeout(r, 600));
    const point = await center(row('long'));
    await move(point);
    await waitCard(v => v && v.visible === 'visible');
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await move({ x: point.x + 3, y: point.y });
    await new Promise(r => setTimeout(r, 500));
    assert.equal(await card(), null, 'click closes the card');
    assert.deepEqual(await evaluate('window.selected'), ['long']);

    // Scrolling the sidebar closes it.
    await move({ x: 700, y: 650 }); await new Promise(r => setTimeout(r, 600));
    await move(await center(row('short')));
    await waitCard(v => v && v.visible === 'visible');
    await evaluate(`document.querySelector('.sidebar-scroll').scrollTop=40`);
    assert.equal((await waitCard(v => v === null, 300)).value, null, 'scroll closes the card');

    // Near the bottom edge the card opens above its row.
    await evaluate(`document.querySelector('.sidebar-scroll').scrollTop=0`);
    const lastRow = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.tree-thread[data-thread-id]')].filter(r=>{const b=r.getBoundingClientRect();return b.bottom<=700&&b.top>=0});const r=rows.at(-1);r.id='bottom-row';return {id:r.dataset.threadId,top:r.getBoundingClientRect().top}})()`);
    await move({ x: 700, y: 650 }); await new Promise(r => setTimeout(r, 600));
    await move(await center('#bottom-row'));
    const above = await waitCard(v => v && v.visible === 'visible');
    assert.ok(above.value.bottom <= lastRow.top + 1, `card above the last visible row: ${JSON.stringify({ lastRow, card: above.value })}`);

    // Keyboard focus shows the card at once; Escape closes it.
    await move({ x: 700, y: 650 }); await new Promise(r => setTimeout(r, 600));
    await evaluate(`document.querySelector('.sidebar-search input').focus()`);
    let focused = null;
    for (let i = 0; i < 40 && focused !== 'long'; i++) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); focused = await evaluate('document.activeElement?.dataset?.threadId ?? null'); }
    assert.equal(focused, 'long');
    assert.equal((await waitCard(v => v && v.title === LONG, 100)).value?.title, LONG, 'focus shows the card');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal((await waitCard(v => v === null, 200)).value, null, 'Escape closes the card');

    if (process.env.HERMES_SIDEBAR_EVIDENCE) {
      await mkdir(process.env.HERMES_SIDEBAR_EVIDENCE, { recursive: true });
      await move({ x: 700, y: 650 }); await new Promise(r => setTimeout(r, 600));
      await move(await center(row('long'))); await waitCard(v => v && v.visible === 'visible');
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE, 'session-card.png'), Buffer.from(data, 'base64'));
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE, 'session-card.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
    console.log(JSON.stringify(evidence));
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await exited; }
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
