import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Connection groups (docs/connection-groups.md): the main process sends the active group's lists;
 * the sidebar shows a switcher in its footer, with a dot for another group's unread result.
 * `HERMES_SIDEBAR_EVIDENCE=<folder>` also saves a screenshot.
 */
test('Chromium: sidebar group switcher names the active group, marks other groups\' unread results and opens the native menu', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sidebar-groups-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const menus=[];
      window.hermesDesktop={setContentBounds:async()=>{},newTab:async()=>{},selectThread:async()=>{},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
        showGroupMenu:async(x,y)=>{menus.push([x,y])}};
      const now=Date.now()/1000;
      const base={phase:'connected',connectionKey:'two',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'w:q',
        connections:[{id:'w',name:'work.example',server:'https://work.example',state:'online',connectionKey:'two',groupId:'g00000001'}],
        channels:[{id:'w:q',name:'Hermes App',connectionKey:'two',connectionName:'work.example'}],
        threads:[{id:'w:t',channelId:'w:q',title:'Release notes',markers:[],running:false,lastMessageAt:now-30}],
        tabs:[],messages:[],interactions:[],canLoadOlder:false};
      const groups={groups:[{id:'g00000001',name:'Work'},{id:'g00000002',name:'Home'}],members:{w:'g00000001',primary:'g00000002'},active:'g00000001'};
      const root=createRoot(document.getElementById('root'));
      const render=snapshot=>flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{}} onSearch={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false} />));
      const actions=()=>[...document.querySelectorAll('.sidebar-actions button')].map(b=>b.textContent.replace(/[\\ue000-\\uf8ff]/g,'').trim());
      (async()=>{try{
        render(base); await document.fonts.ready; await new Promise(r=>setTimeout(r,50));
        ensure('no groups: no switcher',!document.querySelector('.sidebar-group-switch')&&actions()[0]==='New chat');
        render({...base,connectionGroups:{...groups,unread:['primary']}}); await new Promise(r=>setTimeout(r,20));
        const button=document.querySelector('.sidebar-group-switch');
        const aside=document.querySelector('aside.native-sidebar'), footer=aside.querySelector('.sidebar-group-footer');
        ensure('lists keep New chat first; the switcher is not in the scrolling list',actions()[0]==='New chat'&&!aside.querySelector('.sidebar-scroll .sidebar-group-switch'));
        ensure('switcher is the sidebar footer and names the active group',footer&&footer.parentElement===aside&&aside.lastElementChild===footer&&button.textContent.replace(/[\\ue000-\\uf8ff]/g,'').trim()==='Work');
        const asideBox=aside.getBoundingClientRect(), footerBox=footer.getBoundingClientRect();
        ensure('footer sits at the bottom edge of the sidebar',Math.abs(footerBox.bottom-asideBox.bottom)<=1&&footerBox.top>aside.querySelector('.sidebar-scroll').getBoundingClientRect().bottom-1);
        ensure('dot for the unread result in Home',!!button.querySelector('.sidebar-group-unread')&&button.getAttribute('aria-label')==='Group: Work, another group has unread results');
        ensure('menu button semantics',button.getAttribute('aria-haspopup')==='menu');
        const box=button.getBoundingClientRect();
        ensure('lists come from the main process: one Project and its Session',[...document.querySelectorAll('.channel-tree .thread-title')].map(e=>e.textContent).join('|')==='Release notes');
        button.click(); await new Promise(r=>setTimeout(r,10));
        ensure('click opens the native menu at the switcher (the checked group opens over it)',menus.length===1&&Math.abs(menus[0][0]-box.left)<1&&Math.abs(menus[0][1]-box.top)<1);
        render({...base,connectionGroups:{...groups,unread:['w']}}); await new Promise(r=>setTimeout(r,20));
        ensure('no dot for an unread result in the shown group',!document.querySelector('.sidebar-group-unread'));
        render({...base,connectionGroups:{...groups,active:null,unread:['primary']}}); await new Promise(r=>setTimeout(r,20));
        ensure('All: the switcher says All and has no dot',document.querySelector('.sidebar-group-name').textContent==='All'&&!document.querySelector('.sidebar-group-unread'));
        render({...base,connectionGroups:{...groups,unread:['primary']}}); await new Promise(r=>setTimeout(r,20));
        checks.geometry={switcher:[box.left,box.top,box.right,box.bottom],sidebar:[asideBox.top,asideBox.bottom]};
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
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-groups.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
      await writeFile(join(process.env.HERMES_SIDEBAR_EVIDENCE, 'sidebar-groups.json'), JSON.stringify(result, null, 2));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
