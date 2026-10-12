import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/renderer/thread-navigation.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { recentWindow, THREAD_BATCH } = mod.exports;

const now = 2_000_000_000_000, seconds = now / 1000;
const row = (id, lastMessageAt, extra = {}) => ({ id, channelId: 'p', title: id, markers: [], running: false, lastMessageAt, ...extra });

test('Recents keeps only the last 24 hours plus running sessions; running first, then newest', () => {
  const threads = [row('old', seconds - 25 * 3600), row('hour', seconds - 3600), row('minute', seconds - 60), row('running-old', seconds - 90 * 3600, { running: true }), row('never', undefined)];
  assert.deepEqual(recentWindow(threads, now).rows.map(t => t.id), ['running-old', 'minute', 'hour']);
});

test('Recents leaves out automation Threads until the user replies in them', () => {
  const threads = [row('mine', seconds - 60), row('run', seconds - 30, { origin: 'automation' }),
    row('replied', seconds - 90, { origin: 'automation', participated: true }), row('old-server', seconds - 120, {})];
  assert.deepEqual(recentWindow(threads, now).rows.map(t => t.id), ['mine', 'replied', 'old-server']);
});

test('Recents shows one batch, then more on request', () => {
  const threads = Array.from({ length: THREAD_BATCH + 3 }, (_, i) => row('t' + String(i).padStart(2, '0'), seconds - i));
  const first = recentWindow(threads, now);
  assert.equal(first.rows.length, THREAD_BATCH); assert.equal(first.hasMore, true);
  const second = recentWindow(threads, now, 1);
  assert.equal(second.rows.length, threads.length); assert.equal(second.hasMore, false);
});

// Production NativeWorkspace sidebar in real Chromium.
test('Chromium: sidebar starts with New chat, then the search box, Recents, then Projects with plus', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sidebar-recents-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      let projects=0, selected=[];
      window.hermesDesktop={setContentBounds:async()=>{},newTab:async()=>{},selectThread:async id=>{selected.push(id)},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{}};
      const now=Date.now()/1000;
      const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',
        connections:[{id:'primary',name:'personal.example',server:'https://personal.example',state:'online',connectionKey:'one'},{id:'w',name:'work.example',server:'https://work.example',state:'online',connectionKey:'two'}],
        channels:[{id:'p',name:'Research',connectionKey:'one',connectionName:'personal.example'},{id:'w:q',name:'Hermes App',connectionKey:'two',connectionName:'Work'}],
        threads:[{id:'t-old',channelId:'p',title:'Last week',markers:[],running:false,lastMessageAt:now-8*86400},
          {id:'t-hour',channelId:'p',title:'An hour ago',markers:[],running:false,lastMessageAt:now-3600},
          {id:'w:t-now',channelId:'w:q',title:'Just now',markers:[],running:false,lastMessageAt:now-30}],
        tabs:[],messages:[],interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{projects++}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false} />));
      (async()=>{try{
        await document.fonts.ready; await new Promise(r=>setTimeout(r,50));
        const aside=document.querySelector('aside.native-sidebar'), scroll=aside.querySelector('.sidebar-scroll');
        const first=scroll.querySelector('.sidebar-action');
        ensure('first item is New chat',first.textContent==='\\ue011New chat'||first.querySelector('span:not(.app-icon)').textContent==='New chat');
        ensure('only New chat in top actions',scroll.querySelectorAll('.sidebar-actions button').length===1);
        const gap=first.getBoundingClientRect().top-aside.getBoundingClientRect().top;
        ensure('no blank band above New chat',gap<=12);
        const toggle=document.querySelector('.sidebar-edge-toggle').getBoundingClientRect(), action=first.getBoundingClientRect();
        ensure('collapse button beside, not over, New chat',toggle.left>=action.right-1&&Math.abs((toggle.top+toggle.bottom)/2-(action.top+action.bottom)/2)<=2);
        const titles=[...scroll.querySelectorAll('.sidebar-section-title')].map(e=>e.textContent.replace(/[\\ue000-\\uf8ff]/g,'').trim());
        ensure('sections in order',titles.join('|')==='Recents|Projects');
        const recents=[...scroll.querySelectorAll('#sidebar-recents-list .tree-thread .thread-title')].map(e=>e.textContent);
        ensure('recents: last 24 hours across connections, newest first',recents.join('|')==='Just now|An hour ago');
        ensure('recent row names its project and connection',scroll.querySelector('#sidebar-recents-list .tree-thread').title==='Hermes App · Work');
        const sources=[...scroll.querySelectorAll('#sidebar-recents-list .tree-thread')].map(e=>e.querySelector('.thread-connection-name')?.textContent);
        ensure('each recent row shows its connection name',sources.join('|')==='Work|personal.example');
        const recentRowEl=scroll.querySelector('#sidebar-recents-list .tree-thread'), source=recentRowEl.querySelector('.thread-connection-name').getBoundingClientRect(), title=recentRowEl.querySelector('.thread-title').getBoundingClientRect();
        ensure('connection name on the title line, right of the title',source.left>=title.right-1&&source.top<title.bottom&&source.bottom>title.top);
        const projectRowEl=scroll.querySelector('.channel-tree .tree-thread');
        checks.rowHeights={recent:recentRowEl.getBoundingClientRect().height,project:projectRowEl.getBoundingClientRect().height};
        ensure('recent row keeps the one-line row height',Math.abs(recentRowEl.getBoundingClientRect().height-projectRowEl.getBoundingClientRect().height)<=1);
        ensure('Project tree rows do not repeat the connection name',!scroll.querySelector('.channel-tree .thread-connection-name'));
        const panelIcon=document.querySelector('.desktop-browser-toggle .app-icon');
        ensure('right panel glyph loads from the icon font',document.fonts.check('17px HermesWorkIcons','\\ue015')&&getComputedStyle(panelIcon).fontFamily.includes('HermesWorkIcons')&&panelIcon.getBoundingClientRect().width>=16);
        const recentTitle=scroll.querySelector('#sidebar-recents-list .thread-title').getBoundingClientRect().left, recentsLabel=scroll.querySelector('#sidebar-recents-title').getBoundingClientRect().left;
        const projectStep=scroll.querySelector('.channel-tree .thread-title').getBoundingClientRect().left-scroll.querySelector('.channel-toggle strong').getBoundingClientRect().left, list=getComputedStyle(scroll.querySelector('#sidebar-recents-list'));
        checks.indent={recents:recentTitle-recentsLabel,project:projectStep};
        ensure('recents rows indented exactly one level, the Project step',Math.abs((recentTitle-recentsLabel)-projectStep)<=1&&list.borderLeftWidth==='1px');
        const header=[...scroll.querySelectorAll('.sidebar-section-header')].find(e=>e.textContent.includes('Projects'));
        const plus=header.querySelector('[aria-label="New project"]'), search=scroll.querySelector('.sidebar-search');
        ensure('no label filter icon in Projects header',!header.querySelector('[aria-label="Filter sessions"]'));
        ensure('plus at the right of the Projects header',plus&&header.getBoundingClientRect().right-plus.getBoundingClientRect().right<=8);
        ensure('search box below New chat and above Recents',search&&search.getBoundingClientRect().top>=first.getBoundingClientRect().bottom&&search.getBoundingClientRect().bottom<=scroll.querySelector('#sidebar-recents-title').getBoundingClientRect().top&&search.querySelector('input[aria-label="Search sessions"]'));
        ensure('plus uses icon font',plus.querySelector('.app-icon').textContent==='\\ue012');
        plus.click(); ensure('plus opens New project',projects===1);
        scroll.querySelector('#sidebar-recents-list .tree-thread').click(); await new Promise(r=>setTimeout(r,10));
        ensure('recent row opens its session',selected[0]==='w:t-now');
        const toggleRecents=scroll.querySelector('#sidebar-recents-title');
        toggleRecents.click(); await new Promise(r=>setTimeout(r,20));
        ensure('recents collapse',!scroll.querySelector('#sidebar-recents-list')&&toggleRecents.getAttribute('aria-expanded')==='false');
        ensure('collapse remembered',localStorage.getItem('hermes.sidebar.recents-collapsed')==='1');
        toggleRecents.click(); await new Promise(r=>setTimeout(r,20));
        checks.geometry={gap,action:[action.top,action.bottom,action.right],toggle:[toggle.top,toggle.bottom,toggle.left]};
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await copyFile(new URL('../../../assets/work-icons.ttf', import.meta.url), join(folder, 'work-icons.ttf'));
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,800', '--virtual-time-budget=4000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
    if (process.env.HERMES_SIDEBAR_EVIDENCE) {
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-recents.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-recents.json'), JSON.stringify(result, null, 2));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
