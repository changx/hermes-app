import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const mobileRequire = require; // Desktop tests also run on CI without installing the mobile workspace.
const React = mobileRequire('react');
const { act, create } = mobileRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `export { NewSessionPage } from './src/renderer/new-session-page'; export { NavigationPanel } from './src/renderer/navigation-panel'; export { DesktopShellView } from './src/renderer/shell';` }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'], write: false });
const mod = { exports: {} };
new Function('require','module','exports',output.outputFiles[0].text)(name => name.startsWith('react') ? mobileRequire(name) : require(name), mod, mod.exports);
const { NewSessionPage, NavigationPanel, DesktopShellView } = mod.exports;
const snapshot = { revision: 1, phase: 'connected', connectionState: 'online', channels: [{ id:'a', name:'Alpha' }, { id:'b', name:'Beta' }], threads: [], selectedChannelId:'a', messages: [], interactions: [], canLoadOlder:false };
const prevent = () => ({ preventDefault() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject}; };
function environment(api = {}) {
  const listeners = new Map();
  globalThis.window = { hermesDesktop:{sendMessage:async()=>{},completeNewTab:async()=>{},...api}, setInterval:()=>1, clearInterval(){}, addEventListener:(name,fn)=>listeners.set(name,fn), removeEventListener:(name)=>listeners.delete(name) };
  globalThis.document = { activeElement: null };
  return listeners;
}
async function mount(Component, props) { let tree; await act(async()=>{tree=create(React.createElement(Component,props));}); return tree; }
const title = tree => tree.root.findByProps({'aria-label':'First message'});
const form = tree => tree.root.findByType('form');
async function fill(tree) { await act(async()=>title(tree).props.onChange({target:{value:'First session'}})); }

test('Chromium: production shell keeps gray bubbles right aligned and composer controls inside the conversation', {skip: !process.env.HERMES_TEST_CHROME}, async()=>{
  environment({});
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const {renderToStaticMarkup}=require('react-dom/server');
  const html=renderToStaticMarkup(React.createElement(DesktopShellView,{snapshot:{...snapshot,selectedThreadId:'t',threads:[{id:'t',channelId:'a',title:'Example',running:true}],messages:[{id:'user',role:'user',text:'A short user message',toolCalls:[],attachments:[]},{id:'agent',role:'assistant',text:'Assistant response',toolCalls:[],attachments:[]}]}}));
  const folder=await mkdtemp(join(tmpdir(),'session-layout-'));
  try {
    const file=join(folder,'layout.html');
    await writeFile(file,`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${html}</div><pre id="results"></pre><script>
      const results=[];
      for(const width of [720,1280,1800]) {
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';document.querySelector('.session-tab-page').style.width=width+'px';
        const user=document.querySelector('.message-user'),agent=document.querySelector('.message-assistant'),pane=document.querySelector('.session-tab-page'),row=document.querySelector('.composer-toolbar'),box=document.querySelector('.composer-box'),field=box.querySelector('textarea');
        const bubble=user.getBoundingClientRect(),other=agent.getBoundingClientRect(),bounds=pane.getBoundingClientRect(),controls=[...row.children].map(x=>{const b=x.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,height:b.height}});
        const stop=document.querySelector('.running-row .stop-button').getBoundingClientRect();
        results.push({width,bubbleLeft:bubble.left,agentLeft:other.left,bubbleWidth:bubble.width,agentWidth:other.width,background:getComputedStyle(user).backgroundColor,paneLeft:bounds.left,paneRight:bounds.right,controls,stop:{left:stop.left,right:stop.right,bottom:stop.bottom},inputTop:box.getBoundingClientRect().top,box:(b=>({left:b.left,right:b.right,height:b.height}))(box.getBoundingClientRect()),boxRadius:getComputedStyle(box).borderTopLeftRadius,fieldHeight:field.getBoundingClientRect().height,fieldBottom:field.getBoundingClientRect().bottom,rowTop:row.getBoundingClientRect().top,animations:[...document.querySelectorAll('.running-dots span')].map(x=>getComputedStyle(x).animationName)});
      } document.getElementById('results').textContent=JSON.stringify(results);
    </script></body></html>`);
    for(const reduced of [false,true]) {
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',...(reduced?['--force-prefers-reduced-motion']:[]),`--user-data-dir=${join(folder,reduced?'reduced-profile':'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
    const results=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)[1]);
    for(const result of results){
      assert.equal(result.background,'rgb(243, 243, 243)');
      assert.ok(result.bubbleLeft>result.agentLeft,'user bubble is right aligned');
      assert.ok(result.bubbleWidth<=(result.agentWidth-28)*.6+1,'user bubble has 60 percent cap');
      assert.ok(Math.abs(result.bubbleLeft+result.bubbleWidth-(result.agentLeft+result.agentWidth-14))<1,'user right gutter');
      assert.equal(result.controls.length,2,'tool row holds plus and send only');
      assert.ok(result.stop.bottom<=result.inputTop,'stop shares running row above input, not send row');
      assert.ok(result.stop.left>=result.paneLeft && result.stop.right<=result.paneRight);
      assert.deepEqual(result.animations,Array(3).fill(reduced?'none':'agent-running-dot'));
      for(const control of result.controls){assert.ok(control.width>0);assert.ok(control.left>=result.paneLeft);assert.ok(control.right<=result.paneRight);}
      // ChatGPT-style card: one borderless text line above a tool row with round 32px plus/send.
      assert.equal(result.boxRadius,'22px');
      assert.equal(result.fieldHeight,48);
      assert.ok(result.rowTop>=result.fieldBottom-0.5,'tool row sits below the text');
      assert.ok(Math.abs(result.box.height-100)<0.6,'empty card is about 100px tall');
      for(const control of result.controls){assert.equal(control.width,32);assert.equal(control.height,32);}
      assert.ok(Math.abs(result.controls[0].left-(result.box.left+11))<0.6,'plus at card left');
      assert.ok(Math.abs(result.controls[1].right-(result.box.right-11))<0.6,'send at card right');
    }
    }
  } finally {await rm(folder,{recursive:true,force:true});}
});
