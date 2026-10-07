import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/renderer/thread-navigation.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { threadWindow, THREAD_BATCH } = mod.exports;

const now = 2_000_000_000_000, recent = now / 1000 - 60, old = 1;
const row = (id, extra = {}) => ({ id, channelId: 'p', title: id, markers: [], running: false, lastMessageAt: old, ...extra });

test('old sessions with an unread result stay in the default tree window', () => {
  const threads = [row('fresh', { lastMessageAt: recent }), row('old-unread', { completedUnread: true }), ...Array.from({ length: 30 }, (_, i) => row('old' + i))];
  const page = threadWindow(threads, 'p', now);
  assert.deepEqual(page.rows.map(t => t.id), ['fresh', 'old-unread']);
  assert.equal(page.hasMore, true);
});

test('pinned unread and running rows do not consume or duplicate older batches', () => {
  const threads = [row('run', { running: true }), row('unread', { completedUnread: true }), ...Array.from({ length: THREAD_BATCH + 2 }, (_, i) => row('old' + String(i).padStart(2, '0'), { lastMessageAt: old + i }))];
  const first = threadWindow(threads, 'p', now, 1);
  assert.equal(first.rows.length, 2 + THREAD_BATCH);
  assert.equal(new Set(first.rows.map(t => t.id)).size, first.rows.length);
  assert.equal(first.hasMore, true);
  const second = threadWindow(threads, 'p', now, 2);
  assert.equal(second.rows.length, threads.length);
  assert.equal(second.hasMore, false);
});

test('Chromium: flat Project tree shows counts, source and offline hint across two connections', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'project-unread-desktop-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NavigationPanel} from './apps/desktop/src/renderer/navigation-panel';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
      window.hermesDesktop={selectThread:async()=>{}};
      const root=createRoot(document.getElementById('nav'));
      const old=1, recent=Date.now()/1000-60;
      // Equal raw Project/Thread IDs on two servers are qualified by slot.
      const channels=[{id:'p',name:'Research',connectionName:'personal.example',connectionKey:'one'},{id:'w:p',name:'Research',connectionName:'work.example',connectionKey:'two'},{id:'w:q',name:'Alpha',connectionName:'work.example',connectionKey:'two'}];
      const thread=(id,channelId,extra={})=>({id,channelId,title:id,markers:[],running:false,lastMessageAt:old,...extra});
      let snapshot={connectionKey:'one',connectionState:'online',channels,connections:[{id:'primary',name:'personal.example',server:'https://personal.example',state:'online',connectionKey:'one'},{id:'w',name:'work.example',server:'https://work.example',state:'online',connectionKey:'two'}],threads:[
        thread('t','p',{completedUnread:true}),thread('t2','p',{completedUnread:true,lastMessageAt:recent}),thread('t3','p',{lastMessageAt:recent}),
        thread('w:t','w:p',{completedUnread:true}),thread('w:archived-free','w:p'),thread('w:a','w:q')]};
      const render=()=>flushSync(()=>root.render(<NavigationPanel snapshot={snapshot} onNewSession={()=>{}}/>));
      const branches=()=>[...document.querySelectorAll('.channel-branch')];
      const label=b=>b.querySelector('.channel-toggle').getAttribute('aria-label');
      (async()=>{try{
        render();await tick();
        ensure('flat unified order',branches().map(b=>b.querySelector('strong').textContent+'@'+b.querySelector('.channel-connection-name').textContent).join()==='Alpha@work.example,Research@personal.example,Research@work.example');
        const [alpha,personal,work]=branches();
        ensure('personal count',personal.querySelector('.project-unread-count').textContent==='2');
        ensure('work count is per server',work.querySelector('.project-unread-count').textContent==='1');
        ensure('no zero badge',!alpha.querySelector('.project-unread-count'));
        ensure('accessible count',label(personal)==='Research, personal.example, 2 sessions with unread results');
        ensure('old unread rows visible',personal.querySelectorAll('.channel-tree .thread-result-unread').length===2&&work.querySelectorAll('.channel-tree .thread-result-unread').length===1);
        ensure('count matches visible dots',[...document.querySelectorAll('.project-unread-count')].reduce((n,b)=>n+Number(b.textContent),0)===document.querySelectorAll('.channel-tree .thread-result-unread').length);
        ensure('readable badge',getComputedStyle(personal.querySelector('.project-unread-count')).backgroundColor==='rgb(26, 102, 201)');
        // Another device reads one result; the count follows the directory.
        snapshot={...snapshot,threads:snapshot.threads.map(t=>t.id==='t'?{...t,completedUnread:false}:t)};render();await tick();
        ensure('count decreases by one',branches()[1].querySelector('.project-unread-count').textContent==='1');
        // The work server goes offline: last known count stays, hint appears only there.
        snapshot={...snapshot,connections:snapshot.connections.map(c=>c.connectionKey==='two'?{...c,state:'retrying'}:c)};render();await tick();
        const [alpha2,personal2,work2]=branches();
        ensure('offline hint on affected Projects',work2.querySelector('.channel-connection-name').textContent==='work.example · Reconnecting'&&alpha2.querySelector('.channel-connection-issue'));
        ensure('peer unaffected',!personal2.querySelector('.channel-connection-issue'));
        ensure('last known count kept',work2.querySelector('.project-unread-count').textContent==='1');
        ensure('hint accessible',label(work2)==='Research, work.example, Reconnecting, 1 session with an unread result');
        // A single connection hides source text but still reports trouble.
        snapshot={...snapshot,channels:channels.slice(0,1),threads:snapshot.threads.filter(t=>t.channelId==='p'),connections:[{...snapshot.connections[0],state:'blocked'}]};render();await tick();
        ensure('single connection source hidden',branches()[0].querySelector('.channel-connection-name').textContent==='Needs attention');
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="nav" style="width:280px"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=4000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
    assert.ok(Object.keys(result).length >= 14); assert.ok(Object.values(result).every(Boolean));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
