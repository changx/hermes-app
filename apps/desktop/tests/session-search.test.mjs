import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../../../packages/client/src/sessionSearch.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { sessionQueryScore, sessionLabelSuggestions, addQueryLabel, removeQueryLabel, sessionQueryActive, frequentSessionLabels } = mod.exports;

const s = (title, markers = []) => ({ title, markers });

test('session query: every selected label is required; the keyword matches title or label text', () => {
  const both = s('Login crash', ['bug', 'iOS']), bug = s('Slow sync', ['bug']), none = s('Bug report draft');
  assert.equal(sessionQueryScore(both, { text: '', labels: ['bug', 'iOS'] }), 0);
  assert.equal(sessionQueryScore(bug, { text: '', labels: ['bug', 'iOS'] }), Infinity, 'AND, not OR');
  assert.equal(sessionQueryScore(bug, { text: '', labels: ['Bug'] }), Infinity, 'selected labels match exactly');
  assert.ok(Number.isFinite(sessionQueryScore(bug, { text: 'BUG', labels: [] })), 'keyword matches label text, case-insensitively');
  assert.ok(Number.isFinite(sessionQueryScore(none, { text: 'bug', labels: [] })), 'keyword matches the title');
  assert.equal(sessionQueryScore(none, { text: 'bug', labels: ['bug'] }), Infinity, 'keyword and label both apply');
  assert.ok(sessionQueryScore(s('ios'), { text: 'ios', labels: [] }) < sessionQueryScore(s('Other', ['ios']), { text: 'ios', labels: [] }), 'exact title before exact label');
  assert.ok(sessionQueryScore(s('Other', ['ios']), { text: 'ios', labels: [] }) < sessionQueryScore(s('About iOS'), { text: 'ios', labels: [] }), 'exact label before a title substring');
  assert.equal(sessionQueryScore(s('Plan', [], ), { text: 'research', labels: [] }, 'Research'), 7, 'project name still matches, last');
});

test('label suggestions: folded substring, best first, selected labels excluded; query helpers', () => {
  const rows = [s('a', ['Café', 'cafeteria', 'Ops']), s('b', ['décor', 'Cafe'])];
  assert.deepEqual(sessionLabelSuggestions(rows, { text: 'cafe', labels: [] }), ['Cafe', 'Café', 'cafeteria']);
  assert.deepEqual(sessionLabelSuggestions(rows, { text: 'cafe', labels: ['Cafe'] }), ['Café', 'cafeteria']);
  assert.deepEqual(sessionLabelSuggestions(rows, { text: '  ', labels: [] }), []);
  const q = addQueryLabel(addQueryLabel({ text: 'x', labels: [] }, 'bug'), 'bug');
  assert.deepEqual(q.labels, ['bug']);
  assert.deepEqual(removeQueryLabel(q, 'bug').labels, []);
  assert.equal(sessionQueryActive({ text: ' ', labels: [] }), false);
  assert.equal(sessionQueryActive({ text: '', labels: ['bug'] }), true);
});

test('frequent labels: most sessions first, then most recent use, then name; at most five', () => {
  const r = (markers, lastMessageAt) => ({ title: 'x', markers, lastMessageAt });
  const rows = [r(['a', 'b', 'c'], 10), r(['a', 'b'], 20), r(['a', 'd', 'd'], 30), r(['e', 'f', 'g'], 5), r(['h'], 40), r([], 50), r(undefined, 60)];
  assert.deepEqual(frequentSessionLabels(rows), ['a', 'b', 'h', 'd', 'c'], 'count, then newest use; a duplicate label counts once per session');
  assert.deepEqual(frequentSessionLabels([r(['z'], undefined), r(['y'], undefined)]), ['y', 'z'], 'no activity time: name order');
  assert.deepEqual(frequentSessionLabels([]), []);
  assert.equal(frequentSessionLabels(rows, 2).length, 2);
});

// Production NativeWorkspace + DesktopShellView (one search dialog) in real Chromium.
test('Chromium: one search dialog for Sessions, files and labels; label requests, Cmd+K, Shift+Cmd+F and the sidebar Search button open it', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'session-search-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms));
      let labelListener, selected=[], searches=[], opened=[], shown=[];
      const hit=(id,name,threadId,title,extra={})=>({id,threadId,name,mime:'image/png',size:2048,state:'available',list:'delivered',createdAt:1792000000,threadTitle:title,channelId:'p',channelName:'Research',...extra});
      const files={'':[hit('att_1','crash-chart.png','a','Login crash',{refSeq:7}),hit('att_2','notes.md','b','Slow sync',{list:'uploaded',mime:'text/markdown'})]};
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),setContentBounds:async()=>{},newTab:async()=>{},selectThread:async id=>{selected.push(id)},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
        loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},onSearchLabel:listener=>{labelListener=listener;return()=>{labelListener=undefined}},
        searchFiles:async(query,labels)=>{searches.push([query,[...labels]]);const all=files[''];return {supported:true,failed:[],cursors:{},items:all.filter(f=>(!query||(f.name+f.threadTitle).toLowerCase().includes(query.toLowerCase()))&&(!labels.length||labels.includes('bug')&&f.threadId==='a'))};},
        openSessionFile:async(threadId,id,action)=>{opened.push([threadId,id,action])},openMessage:async(threadId,ref)=>{shown.push([threadId,ref])}};
      const now=Date.now()/1000, t=(id,title,markers,ago=8*86400,channelId='p')=>({id,channelId,title,markers,running:false,lastMessageAt:now-ago});
      const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',supportsSessionLabels:true,supportsFileSearch:true,selectedChannelId:'p',
        channels:[{id:'p',name:'Research'},{id:'q',name:'Mobile'}],
        threads:[t('a','Login crash',['bug','iOS'],60),t('b','Slow sync',['bug']),t('c','Release notes',['docs','iOS'],120,'q'),t('d','Urgent fix plan',[]),t('e','Payment flow',['urgent','bug'])],
        tabs:[],messages:[],interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="workspace" />));
      const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
      const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      const key=(el,k,extra={})=>el.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra}));
      const opts=()=>qa('.palette-results [role="option"]');
      const optionText=o=>o.firstChild.textContent;
      const box=()=>q('.palette input[aria-label="Search"]');
      const wait=async test=>{for(let i=0;i<40&&!test();i++)await tick(30);return test();};
      (async()=>{try{
        await tick(60);
        ensure('no search box or frequent labels in the sidebar',!q('.sidebar-scroll input')&&!q('.frequent-label'));
        ensure('workspace subscribed to label requests',typeof labelListener==='function');
        // A Session page's label click opens the dialog with that label.
        labelListener('bug'); await tick();
        ensure('label request opens the search with a chip',!!box()&&qa('.palette .session-query-chip > span').map(e=>e.textContent).join('|')==='bug');
        ensure('label search lists the sessions with the label',opts().filter(o=>!o.classList.contains('palette-file-option')).map(optionText).join('|')==='Login crash|Payment flow|Slow sync');
        ensure('label search also searches files with that label',await wait(()=>qa('.palette-file-option').length===1)&&searches.at(-1)[1].join()==='bug'&&searches.at(-1)[0]==='');
        ensure('section headings',qa('.palette-section').map(e=>e.textContent).join('|')==='Sessions|Files');
        key(box(),'Escape'); await tick(); ensure('Escape closes the dialog',!q('.palette'));
        // The sidebar Search button opens an empty dialog.
        q('.sidebar-search-action').click(); await tick();
        ensure('Search button opens the search',!!box()&&document.activeElement===box()&&!q('.palette .session-query-chip'));
        { const f=getComputedStyle(box()), wrap=getComputedStyle(q('.palette .palette-query'));
          ensure('search input: no outline or border',(f.outlineStyle==='none'||f.outlineWidth==='0px')&&f.borderTopWidth==='0px'&&f.borderLeftWidth==='0px');
          ensure('search query: only a bottom divider',wrap.borderTopWidth==='0px'&&wrap.borderLeftWidth==='0px'&&wrap.borderBottomWidth==='1px'); }
        setValue(box(),'ur'); await tick();
        ensure('label option first, then sessions by title or label',opts()[0].classList.contains('palette-label-option')&&opts()[0].textContent==='Labelurgent'&&opts().slice(1).filter(o=>!o.classList.contains('palette-file-option')).map(optionText).sort().join('|')==='Payment flow|Urgent fix plan');
        key(box(),'Enter'); await tick();
        ensure('Enter on a label adds a chip',box().value===''&&qa('.palette .session-query-chip > span').map(e=>e.textContent).join('|')==='urgent');
        key(box(),'Backspace'); await tick(); ensure('Backspace removes the label',!q('.palette .session-query-chip'));
        // Files: Enter shows the file in its session, Cmd+Enter opens the file, Option+Enter saves it.
        setValue(box(),'crash'); await tick();
        ensure('a keyword finds the session and the file',await wait(()=>qa('.palette-file-option').length===1)&&opts().map(optionText).join('|')==='Login crash|crash-chart.png');
        ensure('file row names its session, project and source',q('.palette-file-option small').textContent.startsWith('Login crash · Research · From Hermes · 2.0 KB'));
        ensure('hint for file keys',q('.palette-hint').textContent.includes('Enter shows the file in its session · ⌘Enter opens the file'));
        key(box(),'ArrowDown'); await tick(); key(box(),'Enter',{altKey:true}); await tick();
        ensure('Option+Enter saves the file and keeps the dialog',opened.at(-1).join()==='a,att_1,save'&&!!q('.palette'));
        key(box(),'Enter',{metaKey:true}); await tick();
        ensure('Cmd+Enter opens the file and closes the dialog',opened.at(-1).join()==='a,att_1,open'&&!q('.palette'));
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true})); await tick();
        setValue(box(),'crash'); await wait(()=>qa('.palette-file-option').length===1);
        key(box(),'ArrowDown'); await tick(); key(box(),'Enter'); await tick();
        ensure('Enter opens the session at the file message and closes the dialog',shown.at(-1).join()==='a,7'&&opened.length===2&&!q('.palette'));
        // A file without a known message opens its session.
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true})); await tick();
        setValue(box(),'notes'); await wait(()=>qa('.palette-file-option').length===1);
        key(box(),'ArrowDown'); await tick(); key(box(),'Enter'); await tick();
        ensure('Enter on a file without its message opens the session',selected.at(-1)==='b'&&shown.length===1&&!q('.palette'));
        // Shift+Cmd+F: files only.
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'F',shiftKey:true,metaKey:true,bubbles:true,cancelable:true})); await tick();
        ensure('Shift+Cmd+F opens the search for files',q('.palette-scope [aria-checked="true"]')?.textContent==='Files'&&box().placeholder.startsWith('Search files'));
        setValue(box(),'s'); await wait(()=>qa('.palette-file-option').length===2);
        ensure('files scope hides sessions',opts().every(o=>o.classList.contains('palette-file-option')||o.classList.contains('palette-label-option')));
        setValue(box(),'zzz'); await wait(()=>q('.palette').textContent.includes('No files found'));
        ensure('no match message',q('.palette').textContent.includes('No files found.'));
        q('.palette-scope [role="radio"]').click(); await tick();
        ensure('scope back to Sessions and files',q('.palette-scope [aria-checked="true"]').textContent==='Sessions and files');
        setValue(box(),'crash'); await tick(); key(box(),'Enter'); await tick();
        ensure('Enter opens the session',selected.at(-1)==='a'&&!q('.palette'));
        checks.ok=true;
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.ttf': 'empty', '.woff2': 'empty', '.woff': 'empty' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await copyFile(new URL('../../../assets/work-icons.ttf', import.meta.url), join(folder, 'work-icons.ttf'));
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,800', '--virtual-time-budget=8000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result)); assert.equal(result.ok, true);
    if (process.env.HERMES_SEARCH_EVIDENCE) {
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_SEARCH_EVIDENCE, 'session-search.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
