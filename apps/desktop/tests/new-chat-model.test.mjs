import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// New chat: the model list follows the chosen project's connection; Default sends no model;
// a warning asks first and repeats the same session ID with confirmation.
test('Chromium: New chat model choice per project connection, confirmation and layout', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {NewSessionPage} from './src/renderer/new-session-page';
    const checks=[]; const ensure=(n,v)=>{if(!v)throw Error(n);checks.push(n)};
    const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setTimeout(r,0))};
    const settings={
      k1:{scope:'connected-default',provider:'anthropic',model:'claude-opus-5-5',providers:[{id:'anthropic',name:'Anthropic',models:['claude-opus-5-5','claude-sonnet-5-5']},{id:'openai-codex',name:'OpenAI Codex',models:['gpt-6-luna']}]},
      k2:{scope:'connected-default',provider:'openai-codex',model:'gpt-6-luna',providers:[{id:'openai-codex',name:'OpenAI Codex',models:['gpt-6-luna','gpt-6-sol']}]}};
    const snapshot={phase:'connected',connections:[{id:'a'},{id:'b'}],channels:[
      {id:'p',name:'Alpha',connectionName:'one',connectionKey:'k1',supportsThreadModel:true},
      {id:'b:q',name:'Beta',connectionName:'two',connectionKey:'k2',supportsThreadModel:true},
      {id:'r',name:'Old',connectionName:'one',connectionKey:'k1'}],threads:[]};
    const loads=[], creates=[], starts=[]; let respond=null;
    window.hermesDesktop={getModelSettings:async key=>{loads.push(key);return settings[key]},
      createThread:async data=>{creates.push(data);return respond?respond(data):data.clientThreadId},
      startThread:async data=>{starts.push(data);return data.clientThreadId},
      getSnapshot:async()=>({}),sendMessage:async()=>{},completeNewTab:async()=>{}};
    const host=document.getElementById('root'); let root=createRoot(host);
    const select=label=>document.querySelector('select[aria-label="'+label+'"]');
    const choose=(label,value)=>flushSync(()=>{const s=select(label);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,value);s.dispatchEvent(new Event('change',{bubbles:true}))});
    const type=value=>flushSync(()=>{const a=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(a,value);a.dispatchEvent(new Event('input',{bubbles:true}))});
    const submit=async()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick()};
    const fresh=async()=>{root.unmount();root=createRoot(host);flushSync(()=>root.render(<NewSessionPage snapshot={{...snapshot,initialChannelId:'p'}}/>));await tick()};
    (async()=>{try{
      await fresh();
      ensure('loaded from the project connection',loads.join()==='k1');
      ensure('default first',select('Model').options[0].textContent==='Default (claude-opus-5-5)'&&select('Model').value==='default');
      ensure('primary listed once',[...select('Model').options].filter(o=>o.textContent==='claude-opus-5-5').length===0);
      ensure('grouped by provider',[...select('Model').querySelectorAll('optgroup')].map(g=>g.label).join()==='Anthropic,OpenAI Codex');
      const project=select('Project').getBoundingClientRect(), model=select('Model').getBoundingClientRect();
      const gap=model.top-project.bottom;
      ensure('model directly under project ('+gap+')',gap>=4&&gap<=16&&model.height>20);
      choose('Model','openai-codex\\u0000gpt-6-luna');
      ensure('choice kept',select('Model').value==='openai-codex\\u0000gpt-6-luna');
      choose('Project','b:q'); await tick();
      ensure('other connection list',loads.join()==='k1,k2'&&select('Model').options[0].textContent==='Default (gpt-6-luna)');
      ensure('choice reset to default',select('Model').value==='default');
      choose('Project','r'); await tick();
      ensure('older server: no model control',!select('Model'));
      choose('Project','p'); await tick();
      type('hello'); await submit();
      // Default model, text only: the session starts at once (no create request from the page, no model).
      ensure('default starts at once with no model',creates.length===0&&starts.length===1&&!('model' in starts[0])&&starts[0].channelId==='p'&&starts[0].text==='hello'&&/^desktop:/.test(starts[0].clientMessageId));

      await fresh(); creates.length=0;
      choose('Model','openai-codex\\u0000gpt-6-luna'); type('hello'); await submit();
      ensure('choice sent',creates.length===1&&creates[0].model.provider==='openai-codex'&&creates[0].model.model==='gpt-6-luna'&&creates[0].confirmModel===false);
      ensure('model locked after send',select('Model').disabled);

      await fresh(); creates.length=0;
      respond=data=>data.confirmModel?data.clientThreadId:{confirmation_required:true,warning:'This model trains on your data.',...data.model};
      choose('Model','anthropic\\u0000claude-sonnet-5-5'); type('hello'); await submit();
      const dialog=document.querySelector('[role=alertdialog]');
      ensure('warning shown',dialog&&dialog.textContent.includes('This model trains on your data.'));
      ensure('send waits for the answer',document.querySelector('.new-chat-send').disabled);
      flushSync(()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Use this model').click()); await tick();
      ensure('same session confirmed',creates.length===2&&creates[1].clientThreadId===creates[0].clientThreadId&&creates[1].confirmModel===true&&creates[1].model.model==='claude-sonnet-5-5');

      await fresh(); creates.length=0;
      choose('Model','anthropic\\u0000claude-sonnet-5-5'); type('hello'); await submit();
      flushSync(()=>[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent==='Cancel').click()); await tick();
      ensure('cancel unlocks the model',!select('Model').disabled&&!document.querySelector('[role=alertdialog]'));
      choose('Model','default'); respond=null; starts.length=0; await submit();
      ensure('retry after cancel uses the new choice and the same session ID',creates.length===1&&starts.length===1&&!('model' in starts[0])&&starts[0].clientThreadId===creates[0].clientThreadId);

      await fresh(); creates.length=0;
      respond=data=>data.model?{model_rejected:true}:data.clientThreadId;
      choose('Model','openai-codex\\u0000gpt-6-luna'); type('hello'); await submit();
      ensure('rejected model message',document.querySelector('[role=alert]').textContent.includes('model is not available'));
      ensure('rejected model unlocks',!select('Model').disabled);

      // New automation: only projects whose server creates automations; the first message carries no flag from the renderer.
      root.unmount();root=createRoot(host);respond=null;creates.length=0;starts.length=0;
      flushSync(()=>root.render(<NewSessionPage snapshot={{...snapshot,automationEditor:true,initialChannelId:'p',channels:snapshot.channels.map(c=>c.id==='b:q'?{...c,supportsAutomationEditors:true}:c)}}/>));await tick();
      ensure('automation heading and hint',document.querySelector('h1').textContent==='New automation'&&!!document.querySelector('.new-chat-hint'));
      ensure('automation projects only',[...select('Project').options].map(o=>o.value).join()==='b:q');
      type('every morning summarize the news'); await submit();
      ensure('automation title and project',starts.length===1&&starts[0].title==='New automation'&&starts[0].channelId==='b:q'&&!('automationEditor' in starts[0]));
      root.unmount();root=createRoot(host);
      flushSync(()=>root.render(<NewSessionPage snapshot={{...snapshot,automationEditor:true}}/>));await tick();
      ensure('older servers explained',!document.querySelector('form')&&document.querySelector('main').textContent.includes('needs a newer Hermes server'));
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks:checks.length,gap});
    }catch(e){document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(e),checks})}})();
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false, alias: { '@hermes-app/client/threadModel': new URL('../../../packages/client/src/threadModel.ts', import.meta.url).pathname } });
  const folder = await mkdtemp(join(tmpdir(), 'new-chat-model-'));
  try {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', `--user-data-dir=${join(folder, 'profile')}`, pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 5000000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.equal(result?.ok, true, (result?.error ?? 'No result') + ' after ' + JSON.stringify(result?.checks));
    assert.equal(result.checks, 23);
    console.log(JSON.stringify(result));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
