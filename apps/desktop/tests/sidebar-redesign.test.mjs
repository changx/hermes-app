import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production NativeWorkspace sidebar with two connections in real Chromium.
test('Chromium: multi-connection sidebar has no server footer, icon-font controls and reference typography', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sidebar-redesign-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      let settings=0, projects=0, tabs=[];
      window.hermesDesktop={setContentBounds:async()=>{},newTab:async id=>{tabs.push(id)},selectThread:async()=>{},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{}};
      const now=Date.now()/1000;
      const snapshot={phase:'connected',connectionKey:'one',connectionName:'personal.example',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',
        connections:[{id:'primary',name:'personal.example',server:'https://personal.example',state:'online',connectionKey:'one'},{id:'w',name:'work.example',server:'https://work.example',state:'retrying',connectionKey:'two'}],
        channels:[{id:'p',name:'Research',connectionName:'personal.example',connectionKey:'one'},{id:'w:q',name:'Hermes App',connectionName:'work.example',connectionKey:'two'}],
        threads:[{id:'t1',channelId:'p',title:'Weekly notes',markers:[],running:false,completedUnread:true,lastMessageAt:now},{id:'w:t2',channelId:'w:q',title:'Sidebar redesign',markers:[],running:true,lastMessageAt:now}],
        tabs:[],messages:[],interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{projects++}} onProjectOptions={()=>{}} onSettings={()=>{settings++}} overlayOpen={false} />));
      (async()=>{try{
        await document.fonts.ready; await new Promise(r=>setTimeout(r,50));
        const aside=document.querySelector('aside.native-sidebar'), footer=aside.querySelector('.native-sidebar-footer');
        ensure('footer shows no single server name',!footer.textContent.includes('personal.example')&&!footer.textContent.includes('work.example'));
        ensure('footer is one Settings action',footer.querySelectorAll('button').length===1&&footer.querySelector('button span:not(.app-icon)').textContent==='Settings');
        const gear=footer.querySelector('.app-icon');
        ensure('settings icon uses icon font',getComputedStyle(gear).fontFamily.includes('HermesWorkIcons')&&gear.textContent==='\\ue010'&&gear.getAttribute('aria-hidden')==='true');
        ensure('icon font loaded',document.fonts.check('17px HermesWorkIcons','\\ue010'));
        ensure('no emoji or text glyph icons in sidebar',!/[⚙✎＋▸▾‹›]/.test(aside.textContent));
        footer.querySelector('button').click(); ensure('settings opens',settings===1);
        const actions=[...aside.querySelectorAll('.sidebar-actions button span:not(.app-icon)')].map(b=>b.textContent);
        ensure('top actions',actions.join('|')==='New chat|New project');
        aside.querySelectorAll('.sidebar-actions button')[1].click(); ensure('new project opens',projects===1);
        const title=aside.querySelector('.sidebar-section-title'), row=aside.querySelector('.tree-thread'), project=aside.querySelector('.channel-toggle strong');
        const cs=e=>getComputedStyle(e);
        ensure('section title matches row size',cs(title).fontSize===cs(row).fontSize&&cs(title).fontSize==='16px');
        ensure('section title muted, not uppercase or bold',cs(title).textTransform==='none'&&Number(cs(title).fontWeight)<=400&&cs(title).color!==cs(row).color);
        ensure('project name regular weight',Number(cs(project).fontWeight)<=400);
        ensure('compact rows',Math.round(row.getBoundingClientRect().height)<=40);
        ensure('connection shown under Project',[...aside.querySelectorAll('.channel-connection-name')].map(e=>e.textContent).join('|')==='work.example · Reconnecting|personal.example');
        ensure('chevrons use icon font',[...aside.querySelectorAll('.channel-chevron')].every(e=>cs(e).fontFamily.includes('HermesWorkIcons')));
        ensure('filter beside Projects title',!!aside.querySelector('.sidebar-section-header [aria-label="Filter sessions"] .app-icon'));
        document.documentElement.style.setProperty('--app-font-size','20px'); await new Promise(r=>setTimeout(r,20));
        ensure('sidebar follows text size',cs(row).fontSize==='20px'&&cs(title).fontSize==='20px');
        document.documentElement.style.setProperty('--app-font-size','16px');
        const box=aside.getBoundingClientRect();
        checks.geometry={width:box.width,actionRow:aside.querySelector('.sidebar-action').getBoundingClientRect().height,row:row.getBoundingClientRect().height,footerTop:footer.getBoundingClientRect().top};
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
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-redesign.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-redesign.json'), JSON.stringify(result, null, 2));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
