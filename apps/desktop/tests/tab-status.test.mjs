import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: session tab dots coexist, update and stay visible with narrow long titles', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { NativeWorkspace } from './src/renderer/native-workspace';
    window.hermesDesktop={setContentBounds:async()=>{},activateTab:async id=>actions.push(['activate',id]),closeTab:async id=>actions.push(['close',id])};
    const actions=[],checks=[];
    const ensure=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
    const title='A very long session title '.repeat(30);
    const threads=Array.from({length:8},(_,i)=>({id:'thread'+i,channelId:'p',title:title+i,running:!!(i&1),completedUnread:!!(i&4)}));
    const tabs=threads.map((t,i)=>({id:'tab'+i,threadId:t.id,title:t.title,kind:'session'}));
    tabs.push({id:'new',threadId:'thread7',title:'New chat',kind:'new'});
    let snapshot={phase:'connected',channels:[],threads,tabs,activeTabId:'tab7'};
    let drafts=new Set(threads.filter((_,i)=>i&2).map(t=>t.id));
    const root=createRoot(document.getElementById('root'));
    const render=()=>flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={drafts} onEditLabels={()=>{}} onCreateProject={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false}/>));
    const tab=i=>document.querySelectorAll('[role="tab"]')[i];
    try {
      render();
      for(let i=0;i<8;i++) {
        for(const [bit,name,label] of [[1,'running','Running'],[2,'draft','Draft'],[4,'unread','Completed, unread']]) {
          ensure('state '+i+' '+name,!!tab(i).querySelector('.desktop-tab-dot-'+name)===!!(i&bit));
          ensure('accessible '+i+' '+name,tab(i).getAttribute('aria-label').includes(label)===!!(i&bit));
        }
        ensure('selected '+i,tab(i).getAttribute('aria-selected')===String(i===7));
      }
      ensure('new tab has no session dots',!tab(8).querySelector('.desktop-tab-dot'));
      for(const width of [720,1280,1800]) for(const size of [12,16,24]) {
        document.getElementById('root').style.width=width+'px';
        document.documentElement.style.setProperty('--app-font-size',size+'px');
        for(const dot of document.querySelectorAll('.desktop-tab-dot')) {
          const box=dot.getBoundingClientRect(),button=dot.closest('button').getBoundingClientRect();
          const text=dot.closest('button').querySelector('.desktop-tab-title').getBoundingClientRect();
          ensure('7px '+width+' '+size,box.width===7&&box.height===7);
          ensure('contained '+width+' '+size,box.left>=button.left&&box.right<=button.right&&box.top>=button.top&&box.bottom<=button.bottom);
          ensure('no overlap '+width+' '+size,text.right<=box.left);
          const color=getComputedStyle(dot).backgroundColor;
          ensure('color '+dot.className,color===(dot.classList.contains('desktop-tab-dot-running')?'rgb(22, 163, 74)':dot.classList.contains('desktop-tab-dot-draft')?'rgb(220, 38, 38)':'rgb(77, 163, 255)'));
        }
      }
      const original=tab(7);
      snapshot={...snapshot,activeTabId:'tab0',threads:threads.map(t=>({...t,running:false,completedUnread:false}))};drafts=new Set();render();
      ensure('cleared without replacing tab',tab(7)===original&&!document.querySelector('.desktop-tab-dot'));
      ensure('status removed from accessible name',tab(7).getAttribute('aria-label')===tabs[7].title);
      tab(7).click();document.querySelectorAll('.desktop-tab-close')[7].click();
      ensure('exact tab actions',JSON.stringify(actions)===JSON.stringify([['activate','tab7'],['close','tab7']]));
      snapshot={...snapshot,threads:[{...threads[7],running:true,completedUnread:true}]};drafts=new Set(['thread7']);render();
      ensure('restored on inactive tab',tab(7).querySelectorAll('.desktop-tab-dot').length===3&&tab(7).getAttribute('aria-selected')==='false');
      ensure('other thread not contaminated',!tab(0).querySelector('.desktop-tab-dot'));
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks:checks.length});
    } catch(error) {document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(error)});}
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const folder = await mkdtemp(join(tmpdir(), 'tab-status-'));
  try {
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1000', '--window-size=2000,1000', '--dump-dom', `--user-data-dir=${join(folder, 'profile')}`, pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 5_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.equal(result?.ok, true, result?.error ?? 'Missing browser results');
    assert.ok(result.checks > 100);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
