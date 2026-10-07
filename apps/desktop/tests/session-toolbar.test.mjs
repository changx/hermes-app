import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production DesktopShellView Session page in real Chromium.
test('Chromium: Session page has no title bar; tools are one floating row at the top right', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'session-toolbar-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const calls=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),copySessionLink:async()=>{calls.push('copy')},openSettings:async()=>{calls.push('settings')},archiveThread:async()=>{calls.push('archive')},renameThread:async()=>{},markResultRead:async()=>{},loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{}};
      window.confirm=()=>true;
      const messages=Array.from({length:30},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'Message '+i,toolCalls:[],attachments:[]}));
      const snapshot={phase:'connected',connectionState:'online',connectionKey:'one',supportsSessionLabels:true,tabActive:true,tabKind:'session',
        channels:[{id:'p',name:'Project Alpha'}],threads:[{id:'t',channelId:'p',title:'Session Title Beta',markers:['urgent'],running:false}],
        selectedChannelId:'p',selectedThreadId:'t',selectedThreadTitle:'Session Title Beta',messages,interactions:[],canLoadOlder:false};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<DesktopShellView snapshot={snapshot} viewRole="tab" />));
      (async()=>{try{
        await new Promise(r=>setTimeout(r,80));
        const page=document.querySelector('.session-tab-page'), bar=page.querySelector('.session-toolbar'), list=page.querySelector('.message-list');
        ensure('no header',!page.querySelector('header'));
        const outside=[...page.childNodes].filter(n=>!n.contains(list)).map(n=>n.textContent).join(' ')+bar.textContent;
        ensure('no title or project text',!outside.includes('Session Title Beta')&&!outside.includes('Project Alpha'));
        const names=[...bar.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'));
        ensure('tools present',names.join('|')==='Copy link|Edit labels|Rename|Archive|Settings');
        ensure('icon buttons have tooltips',[...bar.querySelectorAll('button')].every(b=>b.title&&b.querySelector('svg')&&!b.textContent.trim()));
        const tops=new Set([...bar.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().top)));
        ensure('one row',tops.size===1);
        const box=bar.getBoundingClientRect(), pageBox=page.getBoundingClientRect(), listBox=list.getBoundingClientRect();
        ensure('floats top right',box.top-pageBox.top<=12&&pageBox.right-box.right<=16&&box.height<=40);
        ensure('floats over the timeline, which starts at the top',Math.abs(listBox.top-pageBox.top)<=1&&getComputedStyle(bar).position==='absolute');
        ensure('labels kept in the row',bar.querySelector('.label-pills')?.getAttribute('aria-label')==='Labels: urgent');
        bar.querySelector('[aria-label="Copy link"]').click(); bar.querySelector('[aria-label="Archive"]').click(); bar.querySelector('[aria-label="Settings"]').click();
        await new Promise(r=>setTimeout(r,20));
        ensure('buttons act',calls.join('|')==='copy|archive|settings');
        bar.querySelector('[aria-label="Rename"]').click(); await new Promise(r=>setTimeout(r,20));
        ensure('rename dialog opens',!!document.querySelector('[role="dialog"][aria-label="Rename topic"]'));
        checks.geometry={bar:[box.top-pageBox.top,pageBox.right-box.right,box.width,box.height],listTop:listBox.top-pageBox.top};
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.ttf': 'empty', '.woff2': 'empty', '.woff': 'empty' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1100,700', '--virtual-time-budget=4000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, [...args, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
    if (process.env.HERMES_TOOLBAR_EVIDENCE) {
      execFileSync(process.env.HERMES_TEST_CHROME, [...args, `--screenshot=${join(process.env.HERMES_TOOLBAR_EVIDENCE, 'session-toolbar.png')}`, pathToFileURL(file).href], { timeout: 30000, stdio: 'pipe' });
      await writeFile(join(process.env.HERMES_TOOLBAR_EVIDENCE, 'session-toolbar.json'), JSON.stringify(result, null, 2));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
