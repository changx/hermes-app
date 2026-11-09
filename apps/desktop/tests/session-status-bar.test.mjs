import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production DesktopShellView Session page in real Chromium; IPC is a stand-in.
async function runPage(name, contents, size = '1100,700') {
  const folder = await mkdtemp(join(tmpdir(), `${name}-`));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.ttf': 'empty', '.woff2': 'empty', '.woff': 'empty' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', `--window-size=${size}`, '--virtual-time-budget=15000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (process.env.HERMES_STATUS_BAR_EVIDENCE) execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_STATUS_BAR_EVIDENCE, `${name}.png`)}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
    return JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

const page = (body, { labels, state = 'online', exportable = true, connections = true } = {}) => `
  import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
  import {DesktopShellView} from './apps/desktop/src/renderer/shell';
  const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
  const wait=ms=>new Promise(r=>setTimeout(r,ms)); const calls=[], menus=[]; let answer;
  window.hermesDesktop={getRuntimeInfo:()=>({platform:'darwin',versions:{}}),copySessionLink:async()=>{calls.push('copy')},openSettings:async id=>{calls.push('settings:'+id)},
    revealProject:async id=>{calls.push('reveal:'+id)},archiveThread:async id=>{calls.push('archive:'+id)},renameThread:async()=>{},markResultRead:async()=>{},
    exportConversation:async()=>{calls.push('export');return {ok:true}},loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},
    saveThreadLabels:async(id,markers)=>{calls.push('labels:'+markers.join(','));return {markers}},searchLabel:async label=>{calls.push('search:'+label)},
    showContextMenu:(items,x,y)=>{menus.push({items,x,y});return new Promise(r=>answer=r)}};
  window.confirm=()=>true;
  const messages=Array.from({length:30},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'Message '+i,toolCalls:[],attachments:i===29?[{id:'a1',name:'REPORT.md',mime:'text/markdown',size:12000,state:'available',publicUrl:'https://example.test/r'}]:[]}));
  const snapshot={phase:'connected',connectionState:${JSON.stringify(state)},connectionKey:'one',supportsSessionLabels:true,supportsThreadExport:${exportable},tabActive:true,tabKind:'session',
    ${connections ? `connections:[{id:'c1',name:'Jamie Mac',server:'https://a.test',connectionKey:'one',state:${JSON.stringify(state)}},{id:'c2',name:'Other',server:'https://b.test',connectionKey:'two',state:'online'}],` : ''}
    channels:[{id:'p',name:'Project Alpha',connectionKey:'one',connectionName:'Jamie Mac'}],threads:[{id:'t',channelId:'p',title:'Session Title Beta',markers:${JSON.stringify(labels)},running:false}],
    selectedChannelId:'p',selectedThreadId:'t',selectedThreadTitle:'Session Title Beta',messages,interactions:[],canLoadOlder:false};
  const root=createRoot(document.getElementById('root'));
  flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
  const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)], rect=el=>el.getBoundingClientRect();
  (async()=>{try{ await wait(120); ${body} }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
`;

const MANY = ['urgent', 'review needed', 'design system', 'backend', 'follow up next week', 'iOS keyboard', 'long label text here 1234', 'release 0.1.98', 'networking and retries', 'one more label'];

test('Chromium: no top toolbar; the status bar under the composer shows connection › Project, every tool, then labels', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('session-status-bar', page(`
    const pageBox=rect(q('.session-tab-page')), bar=q('.session-status-bar'), list=q('.message-list'), composer=q('.composer');
    ensure('no header and no top toolbar',!q('.session-tab-page header')&&!q('.session-toolbar')&&!q('.conversation-actions'));
    ensure('timeline starts at the top',Math.abs(rect(list).top-pageBox.top)<=1);
    const b=rect(bar); checks.bar=[b.top,b.height,b.width,pageBox.bottom];
    ensure('bar is the last row, under the composer, full width',b.top>=rect(composer).bottom-1&&Math.abs(b.bottom-pageBox.bottom)<=1&&Math.abs(b.width-pageBox.width)<=1);
    ensure('bar is one thin line',b.height<=32);
    const loc=q('.status-location'), acts=q('.status-actions'), labels=q('.status-labels');
    ensure('order: location, actions, labels',rect(loc).right<=rect(acts).left+1&&rect(acts).right<=rect(labels).left+1);
    ensure('labels take the rest of the row',Math.abs(rect(labels).right-(b.right-10))<=2&&rect(labels).width>b.width*0.5);
    const conn=q('.status-connection'), proj=q('.status-project');
    ensure('connection name, state and Project',conn.textContent==='Jamie Mac'&&conn.getAttribute('aria-label')==='Connection Jamie Mac, Online'&&q('.status-dot').classList.contains('status-dot-online')&&proj.textContent==='Project Alpha');
    ensure('location is a named nav',loc.tagName==='NAV'&&loc.getAttribute('aria-label')==='Session location');
    ensure('location controls have tooltips',conn.dataset.tooltip==='Connection settings'&&proj.dataset.tooltip==='Show in sidebar');
    conn.click(); proj.click(); await wait(20);
    ensure('connection opens its Settings page; Project shows in the sidebar',calls.join('|')==='settings:c1|reveal:p'); calls.length=0;
    const names=[...acts.querySelectorAll('button')].map(x=>x.getAttribute('aria-label'));
    ensure('every tool is its own button, in the former toolbar order; no More menu',names.join('|')==='Mark as todo|Copy link|Export conversation|Edit labels|Rename|Archive'&&!q('.status-more'));
    ensure('tools are a named toolbar',acts.getAttribute('role')==='toolbar'&&acts.getAttribute('aria-label')==='Session tools');
    ensure('tool buttons are icons with in-app tooltips',[...acts.querySelectorAll('button')].every(x=>x.dataset.tooltip&&!x.title&&x.querySelector('svg')&&!x.textContent.trim()));
    ensure('tools on one line, fully inside the bar',[...acts.querySelectorAll('button')].every(x=>{const r=rect(x);return r.width>=24&&r.top>=b.top&&r.bottom<=b.bottom&&Math.abs(r.top-rect(acts).top)<=1;}));
    ensure('todo tooltip names the shortcut',q('.todo-toggle').dataset.tooltip==='Mark as todo (⇧⌘L)');
    // Tooltips sit above controls at the bottom edge and inside the window.
    const hover=async el=>{el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await wait(600);return q('.app-tooltip');};
    const away=async()=>{list.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await wait(30);};
    for(const el of [conn,q('[aria-label="Archive"]')]){const tip=await hover(el),t=rect(tip),e=rect(el);ensure('tooltip above and inside: '+el.className,tip.textContent===el.dataset.tooltip&&t.bottom<=e.top+1&&t.left>=0&&t.right<=document.documentElement.clientWidth);await away();ensure('tooltip hides: '+el.className,!q('.app-tooltip'));}
    // Each tool acts like the former toolbar button.
    const tool=async name=>{q('.status-actions [aria-label="'+name+'"]').click();await wait(40);};
    await tool('Copy link'); ensure('Copy link',calls.pop()==='copy');
    await tool('Export conversation'); ensure('Export',calls.pop()==='export');
    await tool('Mark as todo'); ensure('Mark as todo saves the flag',calls.pop()==='labels:urgent,review needed,todo');
    await tool('Archive'); ensure('Archive after confirm',calls.pop()==='archive:t');
    await tool('Rename'); ensure('Rename dialog with the title',q('[role="dialog"][aria-label="Rename session"] input')?.value==='Session Title Beta');
    q('[role="dialog"][aria-label="Rename session"] button[type="button"]')?.click(); await wait(30);
    await tool('Edit labels'); ensure('Edit labels opens the editor',!!q('dialog.labels-editor'));
    ensure('no menu was opened',menus.length===0&&calls.length===0);
    // Labels: two labels fit; both are buttons that search.
    const pills=qa('.status-label');
    ensure('labels shown, no +N',pills.map(p=>p.textContent).join('|')==='urgent|review needed'&&q('.status-label-more').classList.contains('status-label-hidden'));
    ensure('labels group named',labels.getAttribute('aria-label')==='Labels: urgent, review needed');
    ensure('labels are buttons with tooltips',pills.every(p=>p.tagName==='BUTTON'&&p.dataset.tooltip==='Find sessions with this label'&&p.getAttribute('aria-label')==='Find sessions labeled '+p.textContent));
    ensure('labels on the bar line',pills.every(p=>Math.abs((rect(p).top+rect(p).height/2)-(b.top+b.height/2))<=2));
    pills[1].click(); await wait(20); ensure('label click searches',calls.pop()==='search:review needed');
    // The attachment card keeps its layout and tooltips.
    const card=q('.attachment-card'); card.scrollIntoView(); await new Promise(r=>{let quiet;const done=()=>{document.removeEventListener('scroll',reset,true);r();};const reset=()=>{clearTimeout(quiet);quiet=setTimeout(done,250);};document.addEventListener('scroll',reset,true);reset();});
    const name=card.querySelector('.attachment-name'), acts2=[...card.querySelectorAll('.attachment-actions > *')];
    ensure('attachment actions',acts2.map(a=>a.textContent).join('|')==='Preview|Open externally|Save|View file');
    ensure('file name on one line',name.getClientRects().length===1&&rect(name).height<30);
    const mid=a=>{const r=rect(a);return r.top+r.height/2;}; ensure('actions on one row below the name',acts2.every(a=>Math.abs(mid(a)-mid(acts2[0]))<=2)&&rect(acts2[0]).top>=rect(name).bottom);
    ensure('attachment actions have tooltips',acts2.every(a=>a.dataset.tooltip&&!a.title));
  `, { labels: ['urgent', 'review needed'] }));
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

test('Chromium: labels that do not fit move into +N; its menu searches a hidden label; a narrow window keeps the dot and every tool', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  for (const [size, name] of [['1100,700', 'status-bar-many-labels'], ['640,700', 'status-bar-narrow']]) {
    const result = await runPage(name, page(`
      const bar=q('.session-status-bar'), b=rect(bar), labels=q('.status-labels'), more=q('.status-label-more');
      const visible=qa('.status-label:not(.status-label-hidden)'), hidden=qa('.status-label.status-label-hidden');
      checks.visible=visible.length; checks.width=b.width; checks.labels=[rect(labels).left,rect(labels).width]; checks.location=rect(q('.status-location')).width;
      ensure('some labels shown, rest hidden',visible.length>=1&&hidden.length>=1&&visible.length+hidden.length===${MANY.length});
      ensure('shown labels are the first ones, in order',visible.map(p=>p.textContent).join('|')===${JSON.stringify(MANY)}.slice(0,visible.length).join('|'));
      ensure('hidden labels are inert and hidden',hidden.every(p=>p.inert&&p.getAttribute('aria-hidden')==='true'&&getComputedStyle(p).visibility==='hidden'));
      ensure('+N counts the hidden labels',!more.classList.contains('status-label-hidden')&&more.textContent==='+'+hidden.length&&more.getAttribute('aria-label')===hidden.length+' more labels');
      ensure('everything stays inside the bar on one line',[...visible,more].every(p=>rect(p).right<=rect(labels).right+0.5&&rect(p).left>=rect(labels).left-0.5&&Math.abs(rect(p).top-rect(visible[0]).top)<=1));
      ensure('dot and every tool stay visible',rect(q('.status-dot')).width>0&&qa('.status-actions button').length===6&&qa('.status-actions button').every(x=>rect(x).width>=24&&rect(x).right<=rect(labels).left+1));
      ensure('location stays within its share',rect(q('.status-location')).width<=b.width*0.46);
      more.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:600,clientY:690}));await wait(20);
      ensure('+N menu lists the hidden labels',menus[0].items.map(i=>i.label).join('|')===hidden.map(p=>p.textContent).join('|'));
      answer('label-0');await wait(30);
      ensure('a chosen hidden label searches',calls.pop()==='search:'+hidden[0].textContent);
    `, { labels: MANY }), size);
    assert.ok(result); assert.equal(result.failure, undefined, `${size}: ${JSON.stringify(result)}`);
  }
});

test('Chromium: offline shows the state, disables server actions, and a missing connection row still opens Settings', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const result = await runPage('status-bar-offline', page(`
    const conn=q('.status-connection');
    ensure('offline hint and dot',conn.textContent==='Jamie MacOffline'&&conn.getAttribute('aria-label')==='Connection Jamie Mac, Offline'&&q('.status-dot').classList.contains('status-dot-suspended'));
    ensure('todo disabled offline',q('.todo-toggle').disabled);
    ensure('offline: tools stay, Copy link works, no Export without server support',qa('.status-actions button').map(x=>x.getAttribute('aria-label')).join('|')==='Mark as todo|Copy link|Edit labels|Rename|Archive'&&!q('[aria-label="Copy link"]').disabled);
    conn.click();await wait(20); ensure('Settings without a page when the row is unknown',calls.pop()==='settings:undefined');
  `, { labels: [], state: 'suspended', exportable: false, connections: false }));
  assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
});

// Token usage at the right end of the bar: read for this Session, again when a turn ends, kept on narrow windows.
const usagePage = (size, reply) => page(`
  const asked=[]; let replies=${reply};
  window.hermesDesktop.threadUsage=async id=>{asked.push(id);return replies.shift()??null};
  const render=extra=>flushSync(()=>root.render(<DesktopShellView snapshot={{...snapshot,threads:[{...snapshot.threads[0],...extra}]}} viewRole="tab" />));
  render({lastMessageAt:100}); await wait(120);
  const bar=q('.session-status-bar'), usage=()=>q('.status-usage'), b=rect(bar);
  checks.asked=asked.slice(); checks.text=usage()?.textContent;
  ensure('one read for this Session',asked.join('|')==='t');
  ensure('usage is the last item, at the right end, inside the bar, one line',usage()&&bar.lastElementChild===usage()&&Math.abs(rect(usage()).right-(b.right-10))<=2&&rect(usage()).top>=b.top&&rect(usage()).bottom<=b.bottom&&rect(usage()).height<=b.height);
  ensure('labels end before the usage',!q('.status-labels')||rect(q('.status-labels')).right<=rect(usage()).left+1);
  ensure('location and every tool stay visible',[...qa('.status-actions button'),q('.status-dot')].every(x=>rect(x).width>0&&rect(x).right<=rect(usage()).left+1));
  checks.first=usage().textContent; checks.tip=usage().dataset.tooltip; checks.label=usage().getAttribute('aria-label'); checks.focusable=usage().tabIndex===0;
  render({lastMessageAt:100,running:true}); await wait(60);
  ensure('the old reading stays while the turn runs',usage()?.textContent===checks.first);
  render({lastMessageAt:200,running:false}); await wait(120);
  checks.asked=asked.slice(); checks.after=usage()?.textContent;
`, { labels: MANY }, );

test('Chromium: the status bar shows context and total tokens at the right end and reads them again when a turn ends', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  for (const size of ['1100,700', '640,700']) {
    const result = await runPage(`session-status-usage-${size.split(',')[0]}`, usagePage(size, `[{contextTokens:28202,totalTokens:206250929,cache:{readTokens:239459,promptTokens:240051}},{contextTokens:31000,totalTokens:206300000,cache:null},{contextTokens:12000,totalTokens:206400000,cache:null}]`), size);
    assert.equal(result.failure, undefined, JSON.stringify(result));
    assert.equal(result.first, 'Context 28.2K · Cache 99% · Total 206M');
    assert.equal(result.tip, "Context: 28,202 tokens in the latest request. Cache: 99% of the input of the latest turn's first request came from the prompt cache (239,459 of 240,051 tokens). Total: 206,250,929 tokens used by this session.");
    assert.equal(result.label, result.tip);
    assert.equal(result.focusable, true);
    assert.deepEqual(result.asked, ['t', 't'], 'no read while the turn runs; one read when it ends');
    assert.equal(result.after, 'Context 31K · Total 206M');
  }
});

test('Chromium: without a current context the bar shows only the total; without usage it shows nothing', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const only = await runPage('session-status-usage-total', page(`
    window.hermesDesktop.threadUsage=async()=>({contextTokens:null,totalTokens:950});
    flushSync(()=>root.render(<DesktopShellView snapshot={{...snapshot,threads:[{...snapshot.threads[0],lastMessageAt:5}]}} viewRole="tab" />)); await wait(120);
    checks.text=q('.status-usage')?.textContent; checks.tip=q('.status-usage')?.dataset.tooltip;
  `, { labels: ['bug'] }));
  assert.equal(only.failure, undefined, JSON.stringify(only));
  assert.equal(only.text, 'Total 950');
  assert.equal(only.tip, 'Total: 950 tokens used by this session.');
  for (const reply of ['async()=>null', 'async()=>{throw Error("offline")}']) {
    const none = await runPage('session-status-usage-none', page(`
      window.hermesDesktop.threadUsage=${reply};
      flushSync(()=>root.render(<DesktopShellView snapshot={{...snapshot,threads:[{...snapshot.threads[0],lastMessageAt:6}]}} viewRole="tab" />)); await wait(120);
      ensure('no usage element',!q('.status-usage'));
      const b=rect(q('.session-status-bar')); ensure('labels still take the rest of the row',Math.abs(rect(q('.status-labels')).right-(b.right-10))<=2);
    `, { labels: ['bug'] }));
    assert.equal(none.failure, undefined, JSON.stringify(none));
  }
});
