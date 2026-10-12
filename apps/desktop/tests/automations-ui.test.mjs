import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production NativeWorkspace sidebar and Automation tab page in real Chromium; IPC is a stand-in.
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
    if (process.env.HERMES_AUTOMATION_EVIDENCE) execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_AUTOMATION_EVIDENCE, `${name}.png`)}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
    return JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

const common = `
  const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const now=Date.now()/1000;
  const job=(id,extra={})=>({id,name:id,schedule:'every 60m',state:'scheduled',enabled:true,running:false,failed:false,targets:[{channelId:'p',mode:'new'}],threadCount:1,unreadCount:0,controls:[],...extra});
`;

test('Chromium: sidebar Automations sits above Recents, lists jobs and opens one in a tab', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('sidebar-automations', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
    ${common}
    let opened=[], lists=0, supported=true;
    window.hermesDesktop={setContentBounds:async()=>{},newTab:async()=>{},selectThread:async()=>{},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
      openAutomation:async(id,title)=>{opened.push([id,title])},
      listAutomations:async()=>{lists++;return supported?{supported:true,failed:[],automations:[
        job('w:digest',{name:'Morning digest',running:true,unreadCount:3,connectionName:'work.example'}),
        job('backup',{name:'Nightly backup',enabled:false,connectionName:'personal.example'}),
        job('report',{name:'Weekly report',failed:true,lastStatus:'error',connectionName:'personal.example'})]}:{supported:false,failed:[],automations:[]};}};
    const base={phase:'connected',connectionKey:'one',connectionState:'online',selectedChannelId:'p',
      connections:[{id:'primary',name:'personal.example',server:'https://personal.example',state:'online',connectionKey:'one'},{id:'w',name:'work.example',server:'https://work.example',state:'online',connectionKey:'two'}],
      channels:[{id:'p',name:'Research',connectionKey:'one',connectionName:'personal.example'}],
      threads:[{id:'mine',channelId:'p',title:'My chat',markers:[],running:false,lastMessageAt:now-60},
        {id:'run',channelId:'p',title:'Digest run',markers:[],running:false,lastMessageAt:now-30,origin:'automation'}],
      tabs:[],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    const render=snapshot=>flushSync(()=>root.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false} />));
    render(base);
    (async()=>{try{
      await document.fonts.ready; await wait(80);
      const scroll=document.querySelector('.sidebar-scroll');
      const titles=[...scroll.querySelectorAll('.sidebar-section-title')].map(e=>e.textContent.replace(/[\\ue000-\\uf8ff]/g,'').trim());
      ensure('sections in order',titles.join('|')==='Automations|Recents|Projects');
      const search=scroll.querySelector('.sidebar-search').getBoundingClientRect(), automations=scroll.querySelector('#sidebar-automations-title').getBoundingClientRect(), recents=scroll.querySelector('#sidebar-recents-title').getBoundingClientRect();
      ensure('Automations between the search box and Recents',search.bottom<=automations.top&&automations.bottom<=recents.top);
      const rows=[...scroll.querySelectorAll('#sidebar-automations-list .automation-row')];
      ensure('every job listed in server order',rows.map(r=>r.querySelector('.thread-title').textContent).join('|')==='Morning digest|Nightly backup|Weekly report');
      ensure('statuses that need attention',rows.map(r=>r.querySelector('.automation-row-status')?.textContent??'').join('|')==='Running|Paused|Last run failed');
      ensure('unread count badge',rows[0].querySelector('.project-unread-count').textContent==='3'&&!rows[1].querySelector('.project-unread-count'));
      ensure('connection name with several connections',rows[0].querySelector('.thread-connection-name').textContent==='work.example');
      ensure('tooltip has status and schedule',rows[1].title.startsWith('Paused · Every hour'));
      const recentRow=scroll.querySelector('#sidebar-recents-list .tree-thread'), autoRow=rows[0];
      ensure('job rows keep the Recents row height and indent',Math.abs(recentRow.getBoundingClientRect().height-autoRow.getBoundingClientRect().height)<=1&&Math.abs(recentRow.querySelector('.thread-title').getBoundingClientRect().left-autoRow.querySelector('.thread-title').getBoundingClientRect().left)<=1);
      ensure('automation runs stay out of Recents',[...scroll.querySelectorAll('#sidebar-recents-list .thread-title')].map(e=>e.textContent).join('|')==='My chat');
      rows[0].click(); await wait(10);
      ensure('row opens the job tab',JSON.stringify(opened)==='[["w:digest","Morning digest"]]');
      render({...base,tabs:[{id:'tab-1',kind:'automation',automationId:'w:digest',title:'Morning digest'}],activeTabId:'tab-1'}); await wait(20);
      const active=scroll.querySelector('#sidebar-automations-list .automation-row.selected');
      ensure('job of the active tab is selected',active&&active.getAttribute('aria-current')==='page'&&active.textContent.includes('Morning digest'));
      const toggle=scroll.querySelector('#sidebar-automations-title');
      toggle.click(); await wait(20);
      ensure('section collapses and remembers it',!scroll.querySelector('#sidebar-automations-list')&&localStorage.getItem('hermes.sidebar.automations-collapsed')==='1');
      toggle.click(); await wait(20);
      const before=lists; render({...base,threads:[...base.threads]}); await wait(1700);
      ensure('a directory change refreshes the list once',lists===before+1);
      supported=false; render({...base,connections:base.connections.slice(0,1)}); await wait(60);
      ensure('section hidden when no connection offers Automations',!scroll.querySelector('.sidebar-automations')&&[...scroll.querySelectorAll('.sidebar-section-title')][0].textContent.includes('Recents'));
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: an Automation tab shows the job and its conversations; a conversation opens its session', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('automation-page', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DesktopShellView} from './apps/desktop/src/renderer/shell';
    ${common}
    let selected=[], requests=[], state='ok';
    const thread=(id,title,extra={})=>({id,channelId:'p',title,runs:1,completedUnread:false,resultVersion:1,resultRef:1,...extra});
    window.hermesDesktop={loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},selectThread:async id=>{selected.push(id)},
      getAutomation:async before=>{requests.push(before??null);
        if(state==='missing')return {state:'missing'};
        if(before===7)return {state:'ok',automation:job('digest'),threads:[thread('t-old','Older run')],nextBefore:null};
        return {state:'ok',nextBefore:7,automation:job('digest',{name:'Morning digest',schedule:'every 1440m',nextRunAt:'2030-01-02T08:00:00Z',prompt:'Summarize the news.',targets:[{channelId:'p',mode:'new'}]}),
          threads:[thread('t-new','Digest Oct 11',{runs:2}),thread('t-gone','Removed run')]};}};
    const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',draftIdentity:'one',tabId:'tab-1',tabKind:'automation',automationId:'digest',tabActive:true,
      channels:[{id:'p',name:'Research'}],threads:[{id:'t-new',channelId:'p',title:'Digest Oct 11',markers:[],running:false,completedUnread:true},{id:'t-old',channelId:'p',title:'Older run',markers:[],running:false}],
      messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
    (async()=>{try{
      await wait(80);
      const page=document.querySelector('main.automation-page');
      ensure('automation tab renders the Automation page',page&&!document.querySelector('.composer'));
      ensure('reads its own job once',JSON.stringify(requests)==='[null]');
      ensure('name',page.querySelector('h1').textContent==='Morning digest');
      ensure('status and schedule',page.querySelector('.automation-status').textContent==='Scheduled'&&page.querySelector('.automation-line').textContent.startsWith('Every day · Next'));
      ensure('delivery target names the project',[...page.querySelectorAll('.automation-line')].some(e=>e.textContent==='New conversation each run in Research'));
      ensure('instructions hidden until asked',!page.querySelector('.automation-prompt'));
      page.querySelector('.automation-link').click(); await wait(20);
      ensure('instructions shown',page.querySelector('.automation-prompt').textContent==='Summarize the news.');
      const rows=[...page.querySelectorAll('.automation-thread')];
      ensure('conversations newest first',rows.map(r=>r.querySelector('.automation-thread-title').textContent).join('|')==='Digest Oct 11|Removed run');
      ensure('result count and project',rows[0].querySelector('.automation-thread-details').textContent==='Research · 2 results');
      ensure('live unread dot',!!rows[0].querySelector('.thread-result-unread'));
      ensure('conversation no longer listed is disabled',rows[1].disabled&&rows[1].textContent.includes('No longer available'));
      rows[0].click(); await wait(10);
      ensure('conversation opens its session',JSON.stringify(selected)==='["t-new"]');
      [...page.querySelectorAll('.automation-link')].find(b=>b.textContent==='Show more').click(); await wait(40);
      ensure('show more reads the next page',JSON.stringify(requests)==='[null,7]'&&[...page.querySelectorAll('.automation-thread-title')].map(e=>e.textContent).join('|')==='Digest Oct 11|Removed run|Older run');
      ensure('no more pages',![...page.querySelectorAll('.automation-link')].some(b=>b.textContent==='Show more'));
      state='missing';
      flushSync(()=>root.render(<DesktopShellView snapshot={{...snapshot,tabActive:false}} viewRole="tab" />));
      flushSync(()=>root.render(<DesktopShellView snapshot={{...snapshot,tabActive:true}} viewRole="tab" />)); await wait(40);
      ensure('returning to the tab reloads it; a removed job says so',document.querySelector('.automation-notice')?.textContent==='This automation no longer exists.');
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: sidebar offers New automation and Show all; the Automations tab pages and opens jobs', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('automation-list', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
    import {AutomationListPage} from './apps/desktop/src/renderer/automations';
    ${common}
    let opened=[], tabs=[], lists=[], lists2=[], listOpened=0;
    const many=Array.from({length:10},(_,i)=>job('j'+i,{name:'Job '+i,lastRunAt:'2026-10-11T0'+(9-i)+':00:00Z'}));
    window.hermesDesktop={setContentBounds:async()=>{},selectThread:async()=>{},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
      newTab:async(channel,automation)=>{tabs.push([channel??null,automation===true])},
      openAutomation:async(id,title)=>{opened.push([id,title])}, openAutomationList:async()=>{listOpened++},
      listAutomations:async cursors=>{lists.push(cursors??null);
        if(!cursors)return {supported:true,failed:[],canCreate:true,automations:many.slice(0,8),cursors:{primary:'c1'}};
        return {supported:true,failed:[],canCreate:true,automations:many.slice(8),cursors:{}};}};
    const base={phase:'connected',connectionKey:'one',connectionState:'online',selectedChannelId:'p',
      connections:[{id:'primary',name:'personal.example',server:'https://personal.example',state:'online',connectionKey:'one'}],
      channels:[{id:'p',name:'Research',connectionKey:'one'}],threads:[],tabs:[],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    flushSync(()=>root.render(<NativeWorkspace snapshot={base} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false} />));
    (async()=>{try{
      await wait(80);
      const scroll=document.querySelector('.sidebar-scroll');
      ensure('sidebar shows the first eight jobs',scroll.querySelectorAll('#sidebar-automations-list .automation-row').length===8);
      const all=scroll.querySelector('.automation-show-all');
      ensure('Show all when more jobs exist',all&&all.textContent==='Show all');
      all.click(); await wait(10); ensure('Show all opens the Automations tab',listOpened===1);
      const plus=scroll.querySelector('.sidebar-section-action[aria-label="New automation"]');
      ensure('New automation button in the header',!!plus);
      plus.click(); await wait(10); ensure('+ opens a New automation tab',JSON.stringify(tabs)==='[[null,true]]');
      flushSync(()=>root.render(<AutomationListPage snapshot={{...base,tabId:'t',tabKind:'automations',tabActive:true}} />)); await wait(80);
      const page=document.querySelector('main.automation-page[aria-label="Automations"]');
      ensure('list tab renders the first page',page&&page.querySelectorAll('.automation-thread').length===8);
      const more=[...page.querySelectorAll('.automation-more')].find(b=>b.textContent==='Show more');
      if(more){more.click();} await wait(80);
      ensure('next page uses the cursors',lists.some(c=>c&&c.primary==='c1'));
      ensure('all ten jobs listed in order',[...page.querySelectorAll('.automation-thread-title')].map(e=>e.textContent).join('|')===many.map(j=>j.name).join('|'));
      ensure('no more pages',!page.querySelector('.automation-more'));
      page.querySelectorAll('.automation-thread')[9].click(); await wait(10);
      ensure('a row opens the job tab',JSON.stringify(opened)==='[["j9","Job 9"]]');
      page.querySelector('.automation-primary').click(); await wait(10);
      ensure('list tab New automation',tabs.length===2&&tabs[1][1]===true);
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: Automation tab controls pause, resume, run, schedule and the settings conversation', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('automation-controls', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DesktopShellView} from './apps/desktop/src/renderer/shell';
    ${common}
    let current=job('digest',{name:'Morning digest',controls:['pause','run','schedule'],editorChannelId:'p'}), calls=[], selected=[], fail=false;
    window.hermesDesktop={loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},selectThread:async id=>{selected.push(id)},
      getAutomation:async()=>({state:'ok',automation:current,threads:[],nextBefore:null}),
      openAutomationEditor:async()=>{calls.push(['editor']);return 'th_edit'},
      controlAutomation:async(name,value)=>{calls.push([name,value??null]);if(fail)throw Error('bad');
        if(name==='pause')current={...current,enabled:false,state:'paused',controls:['resume','schedule']};
        if(name==='resume')current={...current,enabled:true,state:'scheduled',controls:['pause','run','schedule']};
        if(name==='schedule')current={...current,schedule:value};
        return current;}};
    const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',draftIdentity:'one',tabId:'tab-1',tabKind:'automation',automationId:'digest',tabActive:true,
      channels:[{id:'p',name:'Research'}],threads:[],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
    const buttons=()=>[...document.querySelectorAll('.automation-actions .automation-action')].map(b=>b.textContent);
    const press=async label=>{[...document.querySelectorAll('.automation-action')].find(b=>b.textContent===label).click();await wait(40);};
    (async()=>{try{
      await wait(80);
      ensure('controls of a running job',buttons().join('|')==='Pause|Run now|Change schedule|Edit in conversation');
      await press('Pause');
      ensure('pause shows Resume only',buttons().join('|')==='Resume|Change schedule|Edit in conversation'&&document.querySelector('.automation-status').textContent==='Paused');
      await press('Resume');
      await press('Run now');
      ensure('run shows Starting',document.querySelector('.automation-status').textContent==='Starting…');
      await press('Change schedule');
      const input=document.querySelector('.automation-schedule input');
      ensure('schedule form starts with the current schedule',input&&input.value==='every 60m');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,'every day at 9am'); input.dispatchEvent(new Event('input',{bubbles:true})); await wait(20);
      document.querySelector('.automation-schedule button[type="submit"]').click(); await wait(40);
      ensure('schedule saved and form closed',!document.querySelector('.automation-schedule'));
      fail=true; await press('Change schedule');
      document.querySelector('.automation-schedule button[type="submit"]').click(); await wait(40);
      ensure('a rejected schedule keeps the form and explains',!!document.querySelector('.automation-schedule')&&document.querySelector('.automation-error').textContent.startsWith('This schedule was not understood'));
      fail=false; await press('Cancel');
      await press('Edit in conversation');
      ensure('settings conversation opens its session',JSON.stringify(selected)==='["th_edit"]');
      ensure('calls in order',JSON.stringify(calls)===JSON.stringify([['pause',null],['resume',null],['run',null],['schedule','every day at 9am'],['schedule','every day at 9am'],['editor']]));
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});
