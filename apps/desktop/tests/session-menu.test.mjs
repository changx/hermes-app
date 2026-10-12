import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const load = async file => {
  const out = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const { contextMenuItems, menuPosition } = await load('../src/main/context-menu.ts');
const { sessionMenuItems, isSessionMenuAction } = await load('../src/renderer/session-menu.ts');

test('session menu: order, title case, dialog ellipses, separators', () => {
  const items = sessionMenuItems({ todo: false, labels: true, online: true });
  assert.deepEqual(items, [
    { id: 'rename', label: 'Rename…', enabled: true },
    { id: 'todo', label: 'Mark as Todo', enabled: true },
    { id: 'labels', label: 'Edit Labels…', enabled: true },
    { separator: true },
    { id: 'copy-link', label: 'Copy Link' },
    { separator: true },
    { id: 'archive', label: 'Archive…', enabled: true },
  ]);
  assert.equal(sessionMenuItems({ todo: true, labels: true, online: true })[1].label, 'Remove Todo');
});

test('session menu: offline disables server actions only; no label support hides todo and labels', () => {
  const offline = sessionMenuItems({ todo: false, labels: true, online: false }).filter(i => i.id);
  assert.deepEqual(offline.map(i => [i.id, i.enabled !== false]), [['rename', false], ['todo', false], ['labels', false], ['copy-link', true], ['archive', false]]);
  assert.deepEqual(sessionMenuItems({ todo: true, labels: false, online: true }).filter(i => i.id).map(i => i.id), ['rename', 'copy-link', 'archive']);
  assert.equal(isSessionMenuAction('archive'), true);
  assert.equal(isSessionMenuAction(null), false);
  assert.equal(isSessionMenuAction('close'), false);
});

test('main process accepts only plain items and separators', () => {
  const items = sessionMenuItems({ todo: false, labels: true, online: false });
  assert.deepEqual(contextMenuItems(items), items.map(i => 'separator' in i ? i : { ...i, enabled: i.enabled !== false }));
  for (const bad of [[], 'x', [null], [{ id: 'Bad Id', label: 'x' }], [{ id: 'a', label: '' }], [{ id: 'a', label: 'x'.repeat(81) }],
    [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }], [{ id: 'a', label: 'x', enabled: 'yes' }], Array.from({ length: 17 }, (_, n) => ({ id: `a${n}`, label: 'x' }))])
    assert.throws(() => contextMenuItems(bad), /Invalid desktop request/);
  // Extra fields (roles, accelerators, submenus) are dropped, not passed to Electron.
  assert.deepEqual(contextMenuItems([{ id: 'a', label: 'x', role: 'quit', submenu: [] }]), [{ id: 'a', label: 'x', enabled: true }]);
  assert.deepEqual(menuPosition(10.4, -3), { x: 10, y: 0 });
  assert.deepEqual(menuPosition(Number.NaN, 4), {});
});

test('the context-menu IPC is main-window only and the sidebar no longer draws an HTML menu', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/renderer/navigation-panel.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  assert.match(main, /handle\('desktop:context-menu', \(event, items: unknown, x: unknown, y: unknown\) => \{\s*shellSender\(event\); const entries = contextMenuItems\(items\)/);
  assert.match(main, /shellSender\(event\); clipboard\.writeText\(service\.sessionLink\(text\(id, 200\)\)\)/);
  assert.doesNotMatch(panel, /role="menu"|session-context-menu/);
  assert.doesNotMatch(css, /session-context-menu/);
});

// Production sidebar and rename dialog in real Chromium; IPC is a stand-in.
async function runPage(name, contents) {
  const folder = await mkdtemp(join(tmpdir(), `${name}-`));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.ttf': 'empty', '.woff2': 'empty', '.woff': 'empty' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,800', '--virtual-time-budget=6000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (process.env.HERMES_MENU_EVIDENCE) execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_MENU_EVIDENCE, `${name}.png`)}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
    return JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

test('Chromium: every row opens the native menu; the row stays marked; each choice acts on that row', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('session-menu', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {NavigationPanel} from './apps/desktop/src/renderer/navigation-panel';
    const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
    const wait=ms=>new Promise(r=>setTimeout(r,ms)); const now=Date.now()/1000;
    const t=(id,title,channelId,markers=[])=>({id,channelId,title,markers,running:false,lastMessageAt:now-60});
    const menus=[], calls=[]; let answer, confirmReply=true;
    window.hermesDesktop={selectThread:async()=>{},listAutomations:async()=>({supported:false,failed:[],automations:[]}),
      showContextMenu:(items,x,y)=>{menus.push({items,x,y});return new Promise(r=>answer=r)},
      copySessionLink:async id=>{calls.push('copy:'+id)},archiveThread:async id=>{calls.push('archive:'+id)},
      saveThreadLabels:async(id,markers,time,key)=>{calls.push('labels:'+id+':'+markers.join(',')+':'+key);return {markers}}};
    window.confirm=message=>{calls.push('confirm:'+message);return confirmReply};
    const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',
      connections:[{connectionKey:'one',state:'online'},{connectionKey:'two',state:'suspended'}],
      channels:[{id:'p',name:'Research',connectionKey:'one',connectionName:'dev'},{id:'q',name:'Offline project',connectionKey:'two',connectionName:'home'}],
      threads:[t('a','Alpha','p',['bug']),t('b','Beta','q'),{...t('c','Gamma','p'),supportsSessionLabels:false}],tabs:[],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    flushSync(()=>root.render(<div className="native-sidebar"><NavigationPanel snapshot={snapshot} onNewSession={()=>{}} onEditLabels={th=>calls.push('edit:'+th.id)} onRename={th=>calls.push('rename:'+th.id)} /></div>));
    const rowOf=title=>[...document.querySelectorAll('.channel-tree .tree-thread')].find(r=>r.querySelector('.thread-title').textContent===title);
    const open=async(title,choice)=>{rowOf(title).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:140}));await wait(20);const marked=rowOf(title).classList.contains('menu-open');answer(choice);await wait(30);return marked;};
    (async()=>{try{
      await wait(60);
      ensure('rows announce a menu',rowOf('Alpha').getAttribute('aria-haspopup')==='menu');
      rowOf('Alpha').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:140}));await wait(20);
      ensure('menu at the pointer',menus[0].x===120&&menus[0].y===140);
      ensure('full menu for a labelled online session',menus[0].items.map(i=>i.id??'-').join('|')==='rename|todo|labels|-|copy-link|-|archive'&&menus[0].items.every(i=>!i.id||i.enabled!==false));
      const row=rowOf('Alpha'), style=getComputedStyle(row);
      ensure('the row is marked while its menu shows',row.classList.contains('menu-open')&&style.boxShadow.includes('inset'));
      ensure('no HTML menu is drawn',!document.querySelector('[role="menu"],[role="menuitem"]'));
      rowOf('Beta').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1,clientY:1}));await wait(20);
      ensure('a second right-click waits for the open menu',menus.length===1);
      answer(null);await wait(30);
      ensure('dismiss clears the mark and does nothing',!document.querySelector('.menu-open')&&calls.length===0);
      ensure('rename opens the dialog for that row',(await open('Alpha','rename'))&&calls.pop()==='rename:a');
      await open('Alpha','labels');ensure('edit labels for that row',calls.pop()==='edit:a');
      await open('Alpha','todo');ensure('todo saves on the row connection',calls.pop()==='labels:a:bug,todo:one');
      await open('Alpha','copy-link');ensure('copy link names the row',calls.pop()==='copy:a');
      confirmReply=false;await open('Alpha','archive');ensure('archive asks first; cancel keeps it',calls.join('|')==='confirm:Archive "Alpha"?');calls.length=0;
      confirmReply=true;await open('Alpha','archive');ensure('archive after confirm',calls.join('|')==='confirm:Archive "Alpha"?|archive:a');calls.length=0;
      await open('Beta',null);
      ensure('offline connection: copy link only',menus.at(-1).items.filter(i=>i.id).map(i=>i.id+'='+(i.enabled!==false)).join('|')==='rename=false|todo=false|labels=false|copy-link=true|archive=false');
      await open('Gamma',null);
      ensure('no label support: no todo or labels',menus.at(-1).items.filter(i=>i.id).map(i=>i.id).join('|')==='rename|copy-link|archive');
      const box=rowOf('Alpha').getBoundingClientRect();
      rowOf('Alpha').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));await wait(20);
      ensure('Shift+F10 opens the menu under the row',Math.round(menus.at(-1).x)===Math.round(box.left)&&Math.round(menus.at(-1).y)===Math.round(box.bottom));answer(null);await wait(20);
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: rename dialog starts with the title selected, saves a new title, and closes without a request when unchanged', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('rename-dialog', `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DesktopShellView} from './apps/desktop/src/renderer/shell';
    const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
    const wait=ms=>new Promise(r=>setTimeout(r,ms)); const renames=[]; let fail=false;
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},markResultRead:async()=>{},
      renameThread:async(id,title)=>{renames.push(id+':'+title);if(fail)throw Error('HTTP 503')}};
    const snapshot={phase:'connected',connectionState:'online',connectionKey:'one',tabActive:true,tabKind:'session',selectedThreadId:'t',selectedChannelId:'p',
      channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'Old title',markers:[],running:false}],messages:[],interactions:[],canLoadOlder:false};
    const root=createRoot(document.getElementById('root'));
    flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
    const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
    const dialog=()=>document.querySelector('[role="dialog"][aria-label="Rename session"]');
    (async()=>{try{
      await wait(50);
      document.querySelector('[aria-label="Rename"]').click();await wait(30);
      const input=dialog().querySelector('input');
      ensure('starts with the title, selected',input.value==='Old title'&&document.activeElement===input&&input.selectionStart===0&&input.selectionEnd===9);
      dialog().querySelector('button[type="submit"]').click();await wait(30);
      ensure('unchanged title closes without a request',!dialog()&&renames.length===0);
      document.querySelector('[aria-label="Rename"]').click();await wait(30);
      setValue(dialog().querySelector('input'),'   ');await wait(10);
      ensure('blank title cannot be saved',dialog().querySelector('button[type="submit"]').disabled);
      fail=true;setValue(dialog().querySelector('input'),' New title ');await wait(10);dialog().querySelector('button[type="submit"]').click();await wait(30);
      ensure('a failed save keeps the dialog open',!!dialog()&&renames.join('|')==='t:New title'&&!dialog().querySelector('button[type="submit"]').disabled);
      fail=false;dialog().querySelector('button[type="submit"]').click();await wait(30);
      ensure('a confirmed save closes it',!dialog()&&renames.join('|')==='t:New title|t:New title');
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  `);
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});
