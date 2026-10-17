import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Production Settings > MCP servers page in real Chromium with a scripted desktop API:
// server rows and status, approval change, invalid save kept as a draft, save, import.
test('Chromium: MCP servers settings list servers, save, reject invalid JSON and import', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {SettingsPage} from './src/renderer/settings';
    const checks={}; const ensure=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name)};
    const tick=(ms=60)=>new Promise(r=>setTimeout(r,ms));
    const calls=[];
    const server=(name,extra={})=>({name,kind:'stdio',approval:'ask',disabled:false,status:'stopped',...extra});
    let state={path:'/Users/x/Library/Application Support/Hermes/mcp.json',text:'{"mcpServers":{"ads":{"command":"npx"}}}\\n',claudeAvailable:true,
      servers:[server('ads',{status:'running'}),server('web',{kind:'http',approval:'auto',status:'failed',message:'Could not start MCP server "web": refused'}),server('off',{disabled:true})]};
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'darwin'}),openSettings:async()=>{},
      getMcp:async()=>state,
      saveMcp:async text=>{calls.push(['save',text]);if(!text.trim().startsWith('{'))return{ok:false,error:'This is not valid JSON: Unexpected token'};state={...state,text};return{ok:true,state}},
      setMcpApproval:async(name,approval)=>{calls.push(['approval',name,approval]);state={...state,servers:state.servers.map(s=>s.name===name?{...s,approval}:s)};return{ok:true,state}},
      importClaudeMcp:async()=>{calls.push(['import']);return{ok:true,state,added:['notes'],skipped:['ads']}},
      showMcpFile:async()=>{calls.push(['show'])}};
    localStorage.clear(); localStorage.setItem('hermes.desktop.settings-page','mcp');
    const root=createRoot(document.getElementById('root'));
    const setValue=(el,value)=>{const set=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};
    const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
    (async()=>{try{
      flushSync(()=>root.render(<SettingsPage snapshot={{connections:[]}}/>)); await tick();
      ensure('MCP page in This device',document.querySelector('[role=tab][aria-selected=true]')?.textContent==='MCP servers');
      const rows=[...document.querySelectorAll('[data-mcp-server]')];
      ensure('three servers',rows.length===3);
      ensure('running status',rows[0].textContent.includes('Running'));
      ensure('failure explained',rows[1].textContent.includes('Could not start') && rows[1].textContent.includes('refused'));
      ensure('disabled shown',rows[2].textContent.includes('Turned off'));
      ensure('http label',rows[1].textContent.includes('Web address'));
      const editor=document.querySelector('textarea[aria-label="MCP configuration"]');
      ensure('editor shows file',editor.value.includes('"ads"'));
      ensure('path shown',document.body.textContent.includes('Application Support/Hermes/mcp.json'));
      ensure('save disabled until edited',button('Save').disabled);
      // Approval change writes through the API.
      setValue(document.querySelector('select[aria-label="Approval for ads"]'),'auto'); await tick();
      ensure('approval saved',JSON.stringify(calls.at(-1))==='["approval","ads","auto"]');
      ensure('approval notice',document.body.textContent.includes('ads now runs without asking'));
      // Invalid JSON: error shown, draft kept, nothing else changes.
      setValue(editor,'oops'); await tick(10);
      ensure('save enabled after edit',!button('Save').disabled);
      ensure('import disabled while editing',button('Import from Claude Desktop').disabled);
      button('Save').click(); await tick();
      ensure('error shown',document.querySelector('[role=alert]')?.textContent.includes('not valid JSON'));
      ensure('draft kept',document.querySelector('textarea').value==='oops');
      // A poll while editing does not replace the draft.
      await tick(2200);
      ensure('poll keeps draft',document.querySelector('textarea').value==='oops');
      setValue(document.querySelector('textarea'),'{"mcpServers":{}}'); await tick(10);
      button('Save').click(); await tick();
      ensure('saved',calls.at(-1)[0]==='save' && document.body.textContent.includes('Saved.'));
      button('Import from Claude Desktop').click(); await tick();
      ensure('import result',document.body.textContent.includes('Added notes') && document.body.textContent.includes('Skipped ads'));
      button('Show in Finder').click(); await tick();
      ensure('show file',calls.at(-1)[0]==='show');
    }catch(error){checks.failure=error.message}finally{document.getElementById('results').textContent=JSON.stringify(checks)}})();
  ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const folder = await mkdtemp(join(tmpdir(), 'mcp-settings-'));
  try {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><html style="--app-font-size:16px"><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script></html>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=900,640', '--virtual-time-budget=8000', '--allow-file-access-from-files', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 3_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(result); assert.equal(result.failure, undefined, JSON.stringify(result));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
