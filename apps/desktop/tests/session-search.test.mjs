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

// Production NativeWorkspace + DesktopShellView (Cmd+K) in real Chromium.
test('Chromium: a Session label request searches the sidebar (AND, chips, keyword); Cmd+K searches the same way', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'session-search-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms));
      let labelListener, selected=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),setContentBounds:async()=>{},newTab:async()=>{},selectThread:async id=>{selected.push(id)},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
        loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},onSearchLabel:listener=>{labelListener=listener;return()=>{labelListener=undefined}}};
      const now=Date.now()/1000, t=(id,title,markers,ago=8*86400,channelId='p')=>({id,channelId,title,markers,running:false,lastMessageAt:now-ago});
      const snapshot={phase:'connected',connectionKey:'one',connectionState:'online',supportsSessionLabels:true,selectedChannelId:'p',
        channels:[{id:'p',name:'Research'},{id:'q',name:'Mobile'}],
        threads:[t('a','Login crash',['bug','iOS'],60),t('b','Slow sync',['bug']),t('c','Release notes',['docs','iOS'],120,'q'),t('d','Urgent fix plan',[]),t('e','Payment flow',['urgent','bug'])],
        tabs:[],messages:[],interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="workspace" />));
      const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
      const titles=sel=>qa(sel+' .thread-title').map(e=>e.textContent);
      const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      const key=(el,k,extra={})=>el.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra}));
      (async()=>{try{
        await tick(60);
        ensure('workspace subscribed to label requests',typeof labelListener==='function');
        // Frequent labels under the search box: top labels by session count, then most recent use.
        const frequent=()=>qa('.sidebar-frequent-labels button');
        ensure('frequent labels in order',frequent().map(b=>b.textContent).join('|')==='bug|iOS|docs|urgent');
        { const row=q('.sidebar-frequent-labels').getBoundingClientRect(), search=q('.sidebar-search').getBoundingClientRect(), side=q('aside.native-sidebar').getBoundingClientRect(), recents=q('.sidebar-recents').getBoundingClientRect();
          checks.frequentBox={row:[row.top,row.bottom,row.left,row.right],search:[search.bottom,search.left],recents:recents.top};
          ensure('frequent labels sit between the search box and Recents',row.top>=search.bottom&&row.bottom<=recents.top&&row.left>=side.left&&row.right<=side.right+0.5&&row.height>0); }
        frequent()[1].click(); await tick();
        ensure('a frequent label click searches that label',qa('.session-query-chip > span').map(e=>e.textContent).join('|')==='iOS'&&titles('.search-result-list').join('|')==='Login crash|Release notes');
        ensure('selected frequent label is pressed and stays visible',frequent()[1].getAttribute('aria-pressed')==='true'&&frequent().length===4);
        frequent()[1].click(); await tick();
        ensure('second click removes it and restores the tree',!q('.session-query-chip')&&!!q('.channel-tree'));
        q('.sidebar-edge-toggle').click(); await tick(); ensure('sidebar collapsed',!q('aside.native-sidebar'));
        labelListener('bug'); await tick();
        ensure('label request opens the sidebar',!!q('aside.native-sidebar'));
        ensure('label chip in the search box',qa('.session-query-chip > span').map(e=>e.textContent).join('|')==='bug');
        ensure('results replace Recents and Projects',!q('.channel-tree')&&!q('#sidebar-recents-list'));
        ensure('only sessions with the label, sidebar order',titles('.search-result-list').join('|')==='Login crash|Payment flow|Slow sync');
        ensure('result row names its project',q('.search-result-list .tree-thread').title==='Research');
        labelListener('iOS'); labelListener('bug'); await tick();
        ensure('second label narrows (AND), no duplicate chip',qa('.session-query-chip > span').map(e=>e.textContent).join('|')==='bug|iOS'&&titles('.search-result-list').join('|')==='Login crash');
        const input=q('.sidebar-search input[aria-label="Search sessions"]');
        input.focus(); await tick();
        { const accent=getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim(), rgb=c=>{const d=document.createElement('i');d.style.color=c;document.body.append(d);const v=getComputedStyle(d).color;d.remove();return v;};
          const box=getComputedStyle(q('.sidebar-search')), field=getComputedStyle(input), blue=rgb(accent);
          ensure('focused sidebar search: no outline on the input',field.outlineStyle==='none'||field.outlineWidth==='0px');
          ensure('focused sidebar search: no accent border',box.borderTopColor!==blue&&!box.boxShadow.includes(blue)&&box.boxShadow!=='none'); checks.sidebarFocus={border:box.borderTopColor,shadow:box.boxShadow}; }
        key(input,'Backspace'); await tick();
        ensure('Backspace in an empty box removes the last label',qa('.session-query-chip > span').map(e=>e.textContent).join('|')==='bug');
        setValue(input,'sync'); await tick();
        ensure('keyword plus label',titles('.search-result-list').join('|')==='Slow sync');
        q('[aria-label="Remove label bug from search"]').click(); await tick(); setValue(input,'urg'); await tick();
        ensure('keyword matches title and label text',titles('.search-result-list').sort().join('|')==='Payment flow|Urgent fix plan');
        ensure('matching label offered',qa('.sidebar-search-labels button').map(b=>b.textContent).join('|')==='urgent');
        q('.sidebar-search-labels [aria-label="Search label urgent"]').click(); await tick();
        ensure('suggestion becomes a chip',input.value===''&&titles('.search-result-list').join('|')==='Payment flow');
        q('.search-result-list .tree-thread').click(); await tick(); ensure('result opens its session',selected.at(-1)==='e');
        setValue(input,'zzz'); await tick(); ensure('no match message',q('.search-result-list').textContent.includes('No matching sessions'));
        key(input,'Escape'); await tick();
        ensure('Escape clears the search and restores the tree',input.value===''&&!q('.session-query-chip')&&!!q('.channel-tree')&&!!q('#sidebar-recents-list'));
        // Cmd+K: same search.
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true})); await tick();
        const box=q('.palette input[aria-label="Find a session"]'); ensure('Cmd+K opens the picker',!!box&&document.activeElement===box);
        { const f=getComputedStyle(box), wrap=getComputedStyle(q('.palette .palette-query'));
          ensure('Cmd+K input: no outline or border',(f.outlineStyle==='none'||f.outlineWidth==='0px')&&f.borderTopWidth==='0px'&&f.borderLeftWidth==='0px');
          ensure('Cmd+K query: only a bottom divider',wrap.borderTopWidth==='0px'&&wrap.borderLeftWidth==='0px'&&wrap.borderBottomWidth==='1px'); }
        setValue(box,'ur'); await tick();
        const opts=()=>qa('.palette-results [role="option"]');
        ensure('label option first, then sessions by title or label',opts()[0].classList.contains('palette-label-option')&&opts()[0].textContent==='Labelurgent'&&opts().slice(1).map(o=>o.firstChild.textContent).sort().join('|')==='Payment flow|Urgent fix plan');
        key(box,'Enter'); await tick();
        ensure('Enter on a label adds a chip',box.value===''&&qa('.palette .session-query-chip > span').map(e=>e.textContent).join('|')==='urgent'&&opts().map(o=>o.firstChild.textContent).join('|')==='Payment flow');
        setValue(box,'iOS'); await tick();
        ensure('label option for the keyword',opts()[0].textContent==='LabeliOS');
        key(box,'Enter'); await tick();
        ensure('two labels in Cmd+K narrow to none',!opts().length&&q('.palette').textContent.includes('No sessions found'));
        key(box,'Backspace'); await tick(); key(box,'Backspace'); await tick();
        ensure('Backspace removes both labels',!q('.palette .session-query-chip'));
        setValue(box,'crash'); await tick(); key(box,'Enter'); await tick();
        ensure('Enter opens the session',selected.at(-1)==='a');
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
