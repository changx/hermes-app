import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production DesktopShellView Session page in real Chromium.
test('Chromium: Session page has no title bar; tools float at the top right with all labels wrapped below; a label click searches the sidebar', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'session-toolbar-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const calls=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),copySessionLink:async()=>{calls.push('copy')},openSettings:async()=>{calls.push('settings')},archiveThread:async()=>{calls.push('archive')},renameThread:async()=>{},markResultRead:async()=>{},loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},saveThreadLabels:async()=>{throw Error('offline')},searchLabel:async label=>{calls.push('search:'+label)}};
      window.confirm=()=>true;
      const messages=Array.from({length:30},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'Message '+i,toolCalls:[],attachments:i===29?[{id:'a1',name:'REPORT.md',mime:'text/markdown',size:12000,state:'available',publicUrl:'https://example.test/r'}]:[]}));
      const snapshot={phase:'connected',connectionState:'online',connectionKey:'one',supportsSessionLabels:true,tabActive:true,tabKind:'session',
        channels:[{id:'p',name:'Project Alpha'}],threads:[{id:'t',channelId:'p',title:'Session Title Beta',markers:['urgent','review needed','design','backend','follow up next week','iOS','long label text here 1234'],running:false}],
        selectedChannelId:'p',selectedThreadId:'t',selectedThreadTitle:'Session Title Beta',messages,interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
      (async()=>{try{
        await new Promise(r=>setTimeout(r,80));
        const page=document.querySelector('.session-tab-page'), bar=page.querySelector('.session-toolbar'), list=page.querySelector('.message-list');
        ensure('no header',!page.querySelector('header'));
        const outside=[...page.childNodes].filter(n=>!n.contains(list)).map(n=>n.textContent).join(' ')+bar.textContent;
        ensure('no title or project text',!outside.includes('Session Title Beta')&&!outside.includes('Project Alpha'));
        const actions=bar.querySelector('.conversation-actions'), labels=bar.querySelector('.toolbar-labels');
        const names=[...actions.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'));
        ensure('tools present, no Settings (it lives in the tab bar)',names.join('|')==='Mark as todo|Copy link|Edit labels|Rename|Archive'&&!bar.querySelector('[aria-label="Settings"]'));
        ensure('icon buttons have in-app tooltips, not native titles',[...actions.querySelectorAll('button')].every(b=>b.dataset.tooltip&&!b.title&&b.querySelector('svg')&&!b.textContent.trim()));
        const hover=async(el)=>{el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await new Promise(r=>setTimeout(r,600));return document.querySelector('.app-tooltip');};
        const away=async()=>{list.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await new Promise(r=>setTimeout(r,30));};
        const vw=document.documentElement.clientWidth;
        for(const name of ['Copy link','Archive']){const b=bar.querySelector('[aria-label="'+name+'"]'),tip=await hover(b);ensure('tooltip shows: '+name,tip&&tip.textContent===b.dataset.tooltip);const t=tip.getBoundingClientRect(),bb=b.getBoundingClientRect();ensure('tooltip below and inside the window: '+name,t.top>=bb.bottom&&t.left>=0&&t.right<=vw);checks['tip '+name]=[t.left,t.top,t.width];await away();ensure('tooltip hides: '+name,!document.querySelector('.app-tooltip'));}
        { const b=bar.querySelector('[aria-label="Rename"]'); await hover(b); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); await new Promise(r=>setTimeout(r,20)); ensure('press hides tooltip',!document.querySelector('.app-tooltip')); b.querySelector('svg').dispatchEvent(new PointerEvent('pointerover',{bubbles:true})); await new Promise(r=>setTimeout(r,600)); ensure('tooltip stays hidden after press',!document.querySelector('.app-tooltip')); await away(); }
        const card=page.querySelector('.attachment-card'); card.scrollIntoView(); await new Promise(r=>{let quiet;const done=()=>{document.removeEventListener('scroll',reset,true);r();};const reset=()=>{clearTimeout(quiet);quiet=setTimeout(done,250);};document.addEventListener('scroll',reset,true);reset();}); // a scroll hides tooltips; wait until the timeline stops scrolling
        const name=card.querySelector('.attachment-name'), acts=[...card.querySelectorAll('.attachment-actions > *')];
        ensure('attachment actions',acts.map(a=>a.textContent).join('|')==='Preview|Open externally|Save|View file');
        ensure('file name on one line',name.getClientRects().length===1&&name.getBoundingClientRect().height<30);
        const mid=a=>{const r=a.getBoundingClientRect();return r.top+r.height/2;};ensure('actions on one row below the name',acts.every(a=>Math.abs(mid(a)-mid(acts[0]))<=2)&&acts[0].getBoundingClientRect().top>=name.getBoundingClientRect().bottom);
        ensure('attachment actions have tooltips',acts.every(a=>a.dataset.tooltip&&!a.title));
        { const tip=await hover(acts[1]); ensure('attachment tooltip shows',tip&&tip.textContent==='Open in the default app'); { let box=acts[1].parentElement; while(box&&!(box.scrollHeight>box.clientHeight&&/(auto|scroll)/.test(getComputedStyle(box).overflowY)))box=box.parentElement; box.scrollTop=Math.max(0,box.scrollTop-120); box.dispatchEvent(new Event('scroll')); /* headless virtual time does not render frames, so it does not fire scroll events itself */ await new Promise(r=>setTimeout(r,30)); } ensure('scroll that moves the control hides the tooltip',!document.querySelector('.app-tooltip')); checks.attachment={name:name.getBoundingClientRect().toJSON(),actions:acts.map(a=>Math.round(mid(a)))}; await away(); }
        const tops=new Set([...actions.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().top)));
        ensure('one row',tops.size===1);
        const box=bar.getBoundingClientRect(), pageBox=page.getBoundingClientRect(), listBox=list.getBoundingClientRect();
        ensure('floats top right',box.top-pageBox.top<=12&&pageBox.right-box.right<=16);
        const pills=[...labels.querySelectorAll('button')], actBox=actions.getBoundingClientRect(), labelsBox=labels.getBoundingClientRect();
        ensure('every label shown, none collapsed to +N',pills.map(p=>p.textContent).join('|')==='urgent|review needed|design|backend|follow up next week|iOS|long label text here 1234'&&!bar.querySelector('.label-overflow'));
        ensure('labels below the buttons',labelsBox.top>=actBox.bottom);
        const rows=new Set(pills.map(p=>Math.round(p.getBoundingClientRect().top)));
        ensure('labels wrap onto several rows',rows.size>=2);
        ensure('labels stay inside the toolbar',pills.every(p=>{const r=p.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right&&r.bottom<=box.bottom;}));
        ensure('toolbar height follows the labels',box.height>labelsBox.bottom-actBox.top&&box.height>60&&box.width<=420);
        ensure('floats over the timeline, which starts at the top',Math.abs(listBox.top-pageBox.top)<=1&&getComputedStyle(bar).position==='absolute');
        ensure('labels group named',labels.getAttribute('aria-label')?.startsWith('Labels: urgent, review needed'));
        ensure('labels are buttons with tooltips',pills.every(p=>p.tagName==='BUTTON'&&p.dataset.tooltip==='Find sessions with this label'&&p.getAttribute('aria-label')==='Find sessions labeled '+p.textContent));
        labels.querySelector('[aria-label="Find sessions labeled design"]').click(); labels.querySelector('[aria-label="Find sessions labeled iOS"]').click(); await new Promise(r=>setTimeout(r,20));
        ensure('label clicks ask the sidebar to search, in order',calls.join('|')==='search:design|search:iOS'); calls.length=0;
        ensure('label click opens no editor',!document.querySelector('dialog.labels-editor'));
        checks.labelRows=rows.size;
        bar.querySelector('[aria-label="Copy link"]').click(); bar.querySelector('[aria-label="Archive"]').click();
        await new Promise(r=>setTimeout(r,20));
        ensure('buttons act',calls.join('|')==='copy|archive');
        bar.querySelector('[aria-label="Rename"]').click(); await new Promise(r=>setTimeout(r,20));
        const renameDialog=document.querySelector('[role="dialog"][aria-label="Rename session"]');
        ensure('rename dialog opens with the current title',!!renameDialog&&renameDialog.querySelector('input').value===snapshot.threads.find(t=>t.id===snapshot.selectedThreadId).title);
        checks.geometry={bar:[box.top-pageBox.top,pageBox.right-box.right,box.width,box.height],listTop:listBox.top-pageBox.top};
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.ttf': 'empty', '.woff2': 'empty', '.woff': 'empty' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1100,700', '--virtual-time-budget=10000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
    if (process.env.HERMES_TOOLBAR_EVIDENCE) {
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_TOOLBAR_EVIDENCE, 'session-toolbar.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
      await writeFile(join(process.env.HERMES_TOOLBAR_EVIDENCE, 'session-toolbar.json'), JSON.stringify(result, null, 2));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
