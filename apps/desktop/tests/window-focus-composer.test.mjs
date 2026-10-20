import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Production Session page in real Chromium. The main process sends `desktop:focus-composer`
// when the app window becomes active; the stand-in preload hands that signal to the page.
test('Chromium: the app window becoming active puts the cursor back in the Session composer', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'window-focus-'));
  try {
    const browser = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      let signal=null;
      window.hermesDesktop={loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},getRuntimeInfo:()=>({platform:'darwin',versions:{}}),
        onFocusComposer:listener=>{signal=listener;return()=>{if(signal===listener)signal=null;};}};
      const snap=extra=>({phase:'connected',connectionKey:'one',connectionState:'online',draftIdentity:'one',supportsSessionLabels:true,tabId:'tab',tabKind:'session',tabActive:true,
        selectedThreadId:'s1',channels:[{id:'p',name:'Research'}],threads:[{id:'s1',channelId:'p',title:'Plan',markers:[],running:false,lastMessageAt:Date.now()/1000}],
        messages:Array.from({length:30},(_,i)=>({id:'m'+i,role:'assistant',text:'Line '+i,toolCalls:[],attachments:[]})),interactions:[],canLoadOlder:false,...extra});
      const root=createRoot(document.getElementById('root'));
      const render=snapshot=>flushSync(()=>root.render(<React.StrictMode><DesktopShellView snapshot={snapshot} viewRole="tab" /></React.StrictMode>));
      render(snap());
      (async()=>{try{
        await wait(80);
        const composer=()=>document.querySelector('[aria-label="Message"]');
        ensure('page subscribes once',typeof signal==='function');
        const other=document.querySelector('.status-actions button'); other.focus();
        ensure('focus starts elsewhere',document.activeElement===other);
        const list=document.querySelector('.message-list'); list.scrollTop=200; const top=list.scrollTop;
        signal(); await wait(20);
        ensure('composer has the cursor',document.activeElement===composer());
        ensure('reading position unchanged',list.scrollTop===top);
        document.activeElement.blur(); ensure('nothing focused',document.activeElement===document.body);
        signal(); await wait(20); ensure('from no focus too',document.activeElement===composer());
        window.hermesDesktop.showContextMenu=async()=>'labels'; document.querySelector('.status-more').click(); await wait(40);
        const dialog=document.querySelector('dialog[open]'); ensure('labels dialog open',dialog&&dialog.contains(document.activeElement));
        const inDialog=document.activeElement; signal(); await wait(20);
        ensure('an open dialog on the page keeps its focus',document.activeElement===inDialog);
        dialog.close(); await wait(20);
        render(snap({tabActive:false})); await wait(20); other.focus(); signal(); await wait(20);
        ensure('a hidden tab does not move focus',document.activeElement!==composer());
      }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), browser.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1100,800', '--virtual-time-budget=5000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
