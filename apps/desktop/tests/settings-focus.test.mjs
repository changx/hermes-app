import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Production SettingsPage in real Chromium. The native window first renders an
// empty snapshot, then the real one; nothing in the navigation may overlap.
test('Chromium: Settings opens with focus on the shown page and no navigation overlap', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {SettingsPage} from './src/renderer/settings';
    const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
    const tick=()=>new Promise(r=>setTimeout(r,40));
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'darwin'}),getModelSettings:()=>new Promise(()=>{}),openSettings:async()=>{}};
    localStorage.clear();
    const row=(id,key,name)=>({id,connectionKey:key,name,server:'https://'+name,state:'online'});
    const real={connectionKey:'a',connections:[row('primary','a','agent.tuly.space'),row('j','b','hermes-jamie.tuly.space')]};
    const root=createRoot(document.getElementById('root'));
    // Overlap: a painted box (including focus outline) that reaches into another nav row.
    const overlaps=()=>{const rows=[...document.querySelectorAll('.settings-nav [role=tab]')];const out=[];
      rows.forEach((el,i)=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();const ring=s.outlineStyle!=='none'?parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset):0;
        rows.forEach((other,j)=>{if(i===j)return;const o=other.getBoundingClientRect();if(r.bottom+ring>o.top+0.5&&r.top-ring<o.bottom-0.5)out.push(el.id+'>'+other.id)})});return out};
    (async()=>{try{
      document.getElementById('opener').focus();
      flushSync(()=>root.render(<SettingsPage snapshot={{connections:[]}}/>)); await tick();
      flushSync(()=>root.render(<SettingsPage snapshot={real}/>)); await tick();
      const active=document.activeElement, selected=document.querySelector('[role=tab][aria-selected=true]');
      checks.state={active:active?.id,selected:selected?.id,overlaps:overlaps()};
      ensure('current connection shown',selected.id==='settings-tab-connection-primary');
      ensure('focus follows the page shown on open',active===selected);
      ensure('no navigation row overlaps another',overlaps().length===0);
      // After a user choice, a later snapshot must not move focus.
      flushSync(()=>document.querySelector('#settings-tab-font').click()); document.querySelector('#settings-tab-font').focus();
      flushSync(()=>root.render(<SettingsPage snapshot={{...real,connections:[...real.connections]}}/>)); await tick();
      ensure('user choice keeps focus',document.activeElement.id==='settings-tab-font');
      // Keyboard focus ring on every row stays inside its row.
      for(const tab of document.querySelectorAll('.settings-nav [role=tab]')){tab.focus();ensure('ring inside '+tab.id,overlaps().length===0);}
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const folder = await mkdtemp(join(tmpdir(), 'settings-focus-'));
  try {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><button id="opener">x</button><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=900,640', '--virtual-time-budget=4000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
