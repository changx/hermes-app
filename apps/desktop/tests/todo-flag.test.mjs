import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production sidebar and Session page in real Chromium; IPC is a stand-in that records label saves.
async function runPage(name, contents) {
  const folder = await mkdtemp(join(tmpdir(), `${name}-`));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await copyFile(new URL('../../../assets/work-icons.ttf', import.meta.url), join(folder, 'work-icons.ttf'));
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,800', '--virtual-time-budget=6000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (process.env.HERMES_TODO_EVIDENCE) execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_TODO_EVIDENCE, `${name}.png`)}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
    return JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

const common = `
  const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const now=Date.now()/1000;
  const t=(id,title,ago,markers=[],extra={})=>({id,channelId:'p',title,markers,running:false,lastMessageAt:now-ago,...extra});
`;

test('Chromium: sidebar Todo section, flags instead of label pills, running first, context-menu toggle', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('sidebar-todo', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
    ${common}
    const saves=[], menus=[]; let choice='todo';
    window.hermesDesktop={showContextMenu:async items=>{menus.push(items);return choice},setContentBounds:async()=>{},newTab:async()=>{},selectThread:async()=>{},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
      listAutomations:async()=>({supported:false,failed:[],automations:[]}),
      saveThreadLabels:async(id,markers,time,key)=>{saves.push([id,markers,key]);return {thread_id:id,project_id:'p',markers,markers_updated_at:time};}};
    window.alert=message=>{checks.alert=message;};
    const base={phase:'connected',connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',
      channels:[{id:'p',name:'Research',connectionKey:'one'}],
      threads:[t('old-todo','Old todo',20*86400,['TODO','bug']),t('run-todo','Running todo',40*86400,['todo'],{running:true}),t('new-todo','Fresh todo',60,['todo','bug']),
        t('plain','Plain chat',30,['bug','docs']),t('busy','Busy chat',3*3600,[],{running:true})],
      tabs:[],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    const render=snapshot=>flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false} />));
    render(base);
    (async()=>{try{
      await document.fonts.ready; await wait(80);
      const scroll=document.querySelector('.sidebar-scroll');
      const titles=[...scroll.querySelectorAll('.sidebar-section-title')].map(e=>e.textContent.replace(/[\\ue000-\\uf8ff]/g,'').trim());
      ensure('Todo between the search box and Recents',titles.join('|')==='Todo|Recents|Projects');
      const rowTitles=sel=>[...scroll.querySelectorAll(sel+' .tree-thread .thread-title')].map(e=>e.textContent).join('|');
      ensure('Todo: every flagged session, any age and case, running first then newest',rowTitles('#sidebar-todo-list')==='Running todo|Fresh todo|Old todo');
      ensure('Recents: running first, then newest',rowTitles('#sidebar-recents-list')==='Busy chat|Running todo|Plain chat|Fresh todo');
      ensure('Project list: running first',rowTitles('.channel-tree').startsWith('Busy chat|Running todo|Plain chat'));
      ensure('no label pills on any row',!scroll.querySelector('.label-pills'));
      const flagged=[...scroll.querySelectorAll('.tree-thread')].filter(r=>r.querySelector('.thread-todo')).map(r=>r.querySelector('.thread-title').textContent);
      ensure('flag on every todo row and only there',flagged.join('|')==='Running todo|Fresh todo|Old todo|Running todo|Fresh todo|Running todo|Fresh todo');
      ensure('an old todo is listed only in Todo; Projects keep their recent window',!rowTitles('.channel-tree').includes('Old todo'));
      const row=[...scroll.querySelectorAll('#sidebar-recents-list .tree-thread')].find(r=>r.textContent.includes('Fresh todo')), flag=row.querySelector('.thread-todo'), title=row.querySelector('.thread-title');
      ensure('flag is accessible',flag.getAttribute('role')==='img'&&flag.getAttribute('aria-label')==='Todo');
      ensure('flag glyph from the icon font',document.fonts.check('13px HermesWorkIcons','\\ue016')&&getComputedStyle(flag.querySelector('.app-icon')).fontFamily.includes('HermesWorkIcons')&&flag.getBoundingClientRect().width>=12);
      ensure('flag on the title line, right of the title',flag.getBoundingClientRect().left>=title.getBoundingClientRect().right-1&&Math.abs((flag.getBoundingClientRect().top+flag.getBoundingClientRect().bottom)/2-(title.getBoundingClientRect().top+title.getBoundingClientRect().bottom)/2)<=3);
      const plainRow=[...scroll.querySelectorAll('#sidebar-recents-list .tree-thread')].find(r=>r.textContent.includes('Plain chat'));
      ensure('flagged and plain rows keep one row height',Math.abs(plainRow.getBoundingClientRect().height-row.getBoundingClientRect().height)<=1);
      checks.rowHeight=row.getBoundingClientRect().height;
      ensure('no frequent label row in the sidebar',!scroll.querySelector('.frequent-label'));
      plainRow.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100})); await wait(30);
      ensure('menu offers Mark as Todo after Rename',menus[0].filter(i=>i.id).map(i=>i.label).join('|')==='Rename…|Mark as Todo|Edit Labels…|Copy Link|Archive…');
      ensure('mark saves labels with the flag added on the right connection',JSON.stringify(saves)==='[["plain",["bug","docs","todo"],"one"]]'&&!document.querySelector('[role="menu"]'));
      const oldRow=[...scroll.querySelectorAll('#sidebar-todo-list .tree-thread')].find(r=>r.textContent.includes('Old todo'));
      oldRow.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100})); await wait(30);
      ensure('a flagged row offers Remove Todo',menus[1].some(i=>i.id==='todo'&&i.label==='Remove Todo'));
      ensure('remove clears every case of the flag and keeps other labels',JSON.stringify(saves[1])==='["old-todo",["bug"],"one"]');
      const toggle=scroll.querySelector('#sidebar-todo-title'); toggle.click(); await wait(20);
      ensure('Todo collapses and remembers it',!scroll.querySelector('#sidebar-todo-list')&&localStorage.getItem('hermes.sidebar.todo-collapsed')==='1');
      toggle.click(); await wait(20);
      render({...base,threads:base.threads.map(x=>({...x,markers:x.markers.filter(l=>!/todo/i.test(l))}))}); await wait(30);
      ensure('Todo hidden when nothing is flagged',!scroll.querySelector('.sidebar-todo')&&!scroll.querySelector('.thread-todo'));
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: Session toolbar flag marks and clears todo; the label row leaves out todo; failures keep the state', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('toolbar-todo', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DesktopShellView} from './apps/desktop/src/renderer/shell';
    ${common}
    const saves=[]; let mode='ok', todoSignal=null;
    window.hermesDesktop={loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},getRuntimeInfo:()=>({platform:'linux',versions:{}}),
      onToggleTodo:listener=>{todoSignal=listener;return()=>{if(todoSignal===listener)todoSignal=null;};},
      saveThreadLabels:async(id,markers,time,key)=>{saves.push([id,markers,key]);if(mode==='fail')throw Error('HTTP 503');return {thread_id:id,project_id:'p',markers:mode==='stale'?['bug','todo']:markers,markers_updated_at:time};}};
    const snap=markers=>({phase:'connected',connectionKey:'one',connectionState:'online',draftIdentity:'one',supportsSessionLabels:true,tabId:'tab',tabKind:'session',tabActive:true,
      selectedThreadId:'s1',channels:[{id:'p',name:'Research'}],threads:[t('s1','Plan',60,markers)],messages:[],interactions:[],canLoadOlder:false});
    const root=createRoot(document.getElementById('root'));
    const render=snapshot=>flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
    render(snap(['bug']));
    (async()=>{try{
      await wait(80);
      const flag=()=>document.querySelector('.status-actions .todo-toggle');
      const first=document.querySelector('.status-actions button');
      ensure('flag is the first status bar button',first===flag()&&flag().getAttribute('aria-label')==='Mark as todo'&&flag().getAttribute('aria-pressed')==='false'&&flag().dataset.tooltip==='Mark as todo (Ctrl+Shift+L)');
      ensure('outline when off',getComputedStyle(flag().querySelectorAll('path')[1]).fill==='none');
      flag().click(); await wait(30);
      ensure('mark saves the flag through the label API',JSON.stringify(saves)==='[["s1",["bug","todo"],"one"]]');
      render(snap(['bug','todo'])); await wait(20);
      ensure('pressed and filled when on',flag().getAttribute('aria-pressed')==='true'&&flag().getAttribute('aria-label')==='Remove todo'&&getComputedStyle(flag().querySelectorAll('path')[1]).fill!=='none');
      ensure('label row shows the other labels only',[...document.querySelectorAll('.status-labels .status-label')].map(b=>b.textContent).join('|')==='bug');
      mode='fail'; flag().click(); await wait(30);
      ensure('failure shows a plain message',document.querySelector('.error-banner')?.textContent==='Could not update the todo flag. Check the connection and try again.'&&!/HTTP/.test(document.body.textContent));
      mode='stale'; flag().click(); await wait(30);
      ensure('a stale read-back is reported',document.querySelector('.error-banner')?.textContent.includes('another device'));
      ensure('remove sends the labels without the flag',JSON.stringify(saves.at(-1))==='["s1",["bug"],"one"]');
      render(snap(Array.from({length:10},(_,i)=>'l'+i))); await wait(20); const before=saves.length; mode='ok'; flag().click(); await wait(30);
      ensure('ten labels: no save, a clear next step',saves.length===before&&document.querySelector('.error-banner')?.textContent.includes('up to 10 labels'));
      render({...snap(['bug']),connectionState:'retrying'}); await wait(20);
      ensure('disabled while offline',flag().disabled);
      render({...snap(['todo']),supportsSessionLabels:false}); await wait(20);
      ensure('hidden without label support',!flag());
      // Shortcut: the main process sends desktop:toggle-todo to the active Session page.
      mode='ok'; let count=saves.length;
      render(snap(['bug'])); await wait(20); todoSignal(); await wait(30);
      ensure('shortcut marks todo like the button',saves.length===count+1&&JSON.stringify(saves.at(-1))==='["s1",["bug","todo"],"one"]');
      render(snap(['bug','todo'])); await wait(20);
      ensure('tooltip names the shortcut',flag().dataset.tooltip==='Remove todo (Ctrl+Shift+L)');
      todoSignal(); await wait(30);
      ensure('shortcut removes todo',JSON.stringify(saves.at(-1))==='["s1",["bug"],"one"]');
      count=saves.length;
      render({...snap(['bug']),connectionState:'retrying'}); await wait(20); todoSignal(); await wait(30);
      render({...snap(['bug']),tabActive:false}); await wait(20); todoSignal(); await wait(30);
      render({...snap(['bug']),supportsSessionLabels:false}); await wait(20); todoSignal(); await wait(30);
      render(snap(['bug'])); await wait(20); const dialog=document.createElement('dialog'); document.body.append(dialog); dialog.show(); todoSignal(); await wait(30); dialog.remove();
      ensure('shortcut does nothing offline, in a hidden tab, without label support, or with a dialog open',saves.length===count);
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});
