import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: two-column Settings, model warnings/save/errors, keyboard navigation and stale responses', {skip:!process.env.HERMES_TEST_CHROME},async()=>{
  const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {SettingsDialog} from './src/renderer/settings';import {initializeFontSize,setFontSize} from './src/renderer/font-preference';
    const checks=[];const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name)};
    const tick=()=>new Promise(resolve=>setTimeout(resolve,30));let writes=[],failRead=false,failWrite=false,lateRead,closed=0,forgot=0;
    let settings={scope:'connected-default',provider:'codex',model:'current-model',providers:[{id:'codex',name:'Codex',models:['current-model','other-model']},{id:'custom',name:'Configured provider',models:[]}]};
    window.hermesDesktop={getRuntimeInfo:()=>({platform:'darwin'}),getModelSettings:async key=>{if(failRead)throw Error('private detail');if(key==='late')return new Promise(resolve=>lateRead=resolve);return settings;},setModelSettings:async(...args)=>{writes.push(args);if(failWrite)throw Error('secret');if(!args[3])return {confirmation_required:true,warning:'Confirm provider cost and data policy.',provider:args[1],model:args[2]};settings={...settings,provider:args[1],model:args[2]};return settings;}};
    const root=createRoot(document.getElementById('root'));const snapshot={connectionKey:'a',connectionName:'example.test'};
    const render=(value=snapshot)=>flushSync(()=>root.render(<SettingsDialog key={value.connectionKey} snapshot={value} close={()=>{closed++;flushSync(()=>root.render(null));}}/>));
    const click=selector=>flushSync(()=>document.querySelector(selector).click());
    const page=id=>click('#settings-tab-'+id);
    const input=value=>flushSync(()=>{const el=document.querySelector('[aria-label=Model]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
    const submit=()=>flushSync(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    void(async()=>{try{
      initializeFontSize();document.getElementById('opener').focus();render();await tick();
      check('native modal and default page',document.querySelector('dialog').matches(':modal')&&document.querySelector('[role=tab][aria-selected=true]').textContent==='Default agent model');
      const nav=document.querySelector('.settings-nav').getBoundingClientRect(),content=document.querySelector('.settings-content').getBoundingClientRect(),box=document.querySelector('dialog').getBoundingClientRect();
      check('left navigation right content',nav.right<=content.left+1&&content.width>nav.width);check('modal fits viewport',box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight);
      check('actual default shown',document.querySelector('[aria-label=Model]').value==='current-model');check('unchanged save disabled',document.querySelector('button[type=submit]').disabled);
      input('other-model');submit();await tick();check('warning not auto-confirmed',writes.length===1&&writes[0][3]===false&&document.querySelector('.settings-warning').textContent.includes('cost and data policy'));
      page('font');page('model');check('warning survives navigation',!!document.querySelector('.settings-warning'));
      click('.settings-warning button');await tick();check('confirmed save reported',writes.length===2&&writes[1][3]===true&&document.querySelector('.settings-success').textContent==='Default model saved.');
      input('manual-model');failWrite=true;submit();await tick();check('safe failure and no blind retry',document.querySelector('[role=alert]').textContent.includes('Reload')&&!document.querySelector('[role=alert]').textContent.includes('secret')&&document.querySelector('button[type=submit]').disabled);
      failWrite=false;click('button.secondary');await tick();check('reload reads persisted value',document.querySelector('[aria-label=Model]').value==='other-model');
      const provider=document.querySelector('[aria-label=Provider]');provider.value='custom';flushSync(()=>provider.dispatchEvent(new Event('change',{bubbles:true})));input('manual-name');submit();await tick();check('empty inventory accepts explicit model',writes.at(-1)[1]==='custom'&&writes.at(-1)[2]==='manual-name');
      page('shortcuts');check('real shortcuts listed',document.querySelector('.settings-shortcuts').textContent.includes('Previous tab')&&document.querySelector('.settings-shortcuts').textContent.includes('⌘'));
      const tab=document.querySelector('#settings-tab-shortcuts');tab.focus();flushSync(()=>tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));check('arrow keys select and focus',document.activeElement.id==='settings-tab-connection'&&document.querySelector('[aria-selected=true]').id==='settings-tab-connection');
      check('connection manager has add entry and empty state',document.querySelector('.settings-connections').textContent.includes('Add connection')&&document.querySelector('.settings-connections').textContent.includes('No saved connections'));check('no project deletion in global settings',!document.querySelector('dialog').textContent.includes('Delete current project'));
      page('font');setFontSize(24);page('shortcuts');check('large font has local content scroll',document.querySelector('.settings-content').scrollHeight>=document.querySelector('.settings-content').clientHeight);setFontSize(16);
      click('.settings-close');await tick();check('close restores trigger focus',closed===1&&document.activeElement.id==='opener');
      failRead=true;render({...snapshot,connectionKey:'failed'});await tick();check('load failure has reload',document.querySelector('[role=alert]').textContent.includes('Could not load'));failRead=false;
      render({...snapshot,connectionKey:'late'});await tick();render({...snapshot,connectionKey:'b'});await tick();lateRead({...settings,model:'stale-model'});await tick();check('late old connection ignored',document.querySelector('[aria-label=Model]').value!=='stale-model');
      if(new URL(location.href).searchParams.has('preview')){render(snapshot);await tick();}
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks});
    }catch(error){document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(error),checks});}})();
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const folder=await mkdtemp(join(tmpdir(),'desktop-settings-'));
  try {
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
    const file=join(folder,'settings.html');await writeFile(file,`<!doctype html><style>${css}</style><button id="opener">Open Settings</button><div id="root"></div><pre id="results" hidden></pre><script src="settings.js"></script>`);await writeFile(join(folder,'settings.js'),bundle.outputFiles[0].text);
    for(const width of [1280,930,600]){
      const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--window-size=${width},820`,`--user-data-dir=${join(folder,'profile-'+width)}`,'--virtual-time-budget=3000','--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2e6,stdio:['ignore','pipe','pipe']});
      const result=JSON.parse(/<pre id="results" hidden="">(.*?)<\/pre>/.exec(dom)?.[1]??'null');assert.equal(result?.ok,true,JSON.stringify(result));assert.ok(result.checks.length>=18);
    }
    if(process.env.HERMES_SETTINGS_EVIDENCE){
      const dir=process.env.HERMES_SETTINGS_EVIDENCE;await mkdir(dir,{recursive:true});await copyFile(file,join(dir,'settings.html'));await copyFile(join(folder,'settings.js'),join(dir,'settings.js'));
      execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=930,820','--virtual-time-budget=3000',`--screenshot=${join(dir,'settings.png')}`,pathToFileURL(file).href+'?preview'],{timeout:30000,stdio:'ignore'});
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});
