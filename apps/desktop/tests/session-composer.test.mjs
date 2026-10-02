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
const output = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `export { NewSessionDialog } from './src/renderer/new-session-dialog'; export { NavigationPanel } from './src/renderer/navigation-panel'; export { DesktopShellView } from './src/renderer/shell';` }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'], write: false });
const mod = { exports: {} };
new Function('require','module','exports',output.outputFiles[0].text)(name => name.startsWith('react') ? mobileRequire(name) : require(name), mod, mod.exports);
const { NewSessionDialog, NavigationPanel, DesktopShellView } = mod.exports;
const snapshot = { revision: 1, phase: 'connected', connectionState: 'online', channels: [{ id:'a', name:'Alpha' }, { id:'b', name:'Beta' }], threads: [], selectedChannelId:'a', messages: [], interactions: [], canLoadOlder:false };
const prevent = () => ({ preventDefault() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject}; };
function environment(api = {}) {
  const listeners = new Map();
  globalThis.window = { hermesDesktop:api, setInterval:()=>1, clearInterval(){}, addEventListener:(name,fn)=>listeners.set(name,fn), removeEventListener:(name)=>listeners.delete(name) };
  globalThis.document = { activeElement: null };
  return listeners;
}
async function mount(Component, props) { let tree; await act(async()=>{tree=create(React.createElement(Component,props));}); return tree; }
const title = tree => tree.root.findByProps({name:'title'});
const form = tree => tree.root.findByType('form');
async function fill(tree) { await act(async()=>title(tree).props.onChange({target:{value:'First session'}})); }

test('new-session dialog uses hovered parent, can select another channel, cancels without any writes', async()=>{
  const calls=[]; environment({createThread:async x=>calls.push(x)});
  let closed=0; const tree=await mount(NewSessionDialog,{snapshot, initialChannelId:'b',close:()=>closed++,prepared(){}});
  assert.equal(tree.root.findByType('select').props.value,'b');
  await act(async()=>tree.root.findByType('select').props.onChange({target:{value:'a'}}));
  assert.equal(tree.root.findByType('select').props.value,'a');
  await act(async()=>tree.root.findAllByType('button').find(x=>x.children.includes('Cancel')).props.onClick());
  assert.equal(closed,1); assert.deepEqual(calls,[]); await act(async()=>tree.unmount());
});

test('selected files upload only to returned new session; immediate double submit and dismissal cannot interrupt', async()=>{
  const creation=deferred(), calls=[], prepared=[]; let closed=0;
  environment({createThread:x=>{calls.push(['create',x]);return creation.promise;},uploadDroppedFiles:async(files,id)=>{calls.push(['upload',files,id]);return [{id:'file-a',name:'note.txt'}];}});
  const tree=await mount(NewSessionDialog,{snapshot,initialChannelId:'b',close:()=>closed++,prepared:(...args)=>prepared.push(args)}); await fill(tree);
  const file={name:'note.txt',size:10};
  await act(async()=>tree.root.findByProps({type:'file'}).props.onChange({target:{files:[file],value:'x'}}));
  let pending;
  await act(async()=>{pending=form(tree).props.onSubmit(prevent()); form(tree).props.onSubmit(prevent()); tree.root.findByProps({className:'modal-backdrop'}).props.onMouseDown();});
  assert.equal(calls.length,1); assert.equal(closed,0); assert.equal(calls[0][1].channelId,'b');
  await act(async()=>{creation.resolve('authoritative-new-id');await pending;});
  assert.deepEqual(calls[1],['upload',[file],'authoritative-new-id']); assert.equal(prepared[0][0],'authoritative-new-id'); assert.equal(closed,1);
  await act(async()=>tree.unmount());
});

test('upload failure retains selected files and retries same created session without a duplicate', async()=>{
  let creates=0, uploads=0; const payloads=[];
  environment({createThread:async x=>{creates++;payloads.push(x);return 'new-id';},uploadDroppedFiles:async(files,id)=>{uploads++;assert.equal(id,'new-id');if(uploads===1)throw Error('private error');return []}});
  const tree=await mount(NewSessionDialog,{snapshot,close(){},prepared(){}});await fill(tree);
  await act(async()=>tree.root.findByProps({type:'file'}).props.onChange({target:{files:[{name:'a.txt',size:1}],value:''}}));
  await act(async()=>form(tree).props.onSubmit(prevent()));
  assert.match(tree.root.findByProps({role:'alert'}).children.join(''),/session was created/);
  assert.equal(title(tree).props.disabled,true); assert.equal(tree.root.findAllByType('li').length,1);
  await act(async()=>form(tree).props.onSubmit(prevent()));assert.equal(creates,1);assert.equal(uploads,2);
  await act(async()=>tree.unmount());
});

test('creation failure retries stable identity, invalid files never reach upload',async()=>{
  const payloads=[];environment({createThread:async x=>{payloads.push(x);if(payloads.length===1)throw Error('offline');return 'new';}});
  const tree=await mount(NewSessionDialog,{snapshot,close(){},prepared(){}});await fill(tree);
  await act(async()=>tree.root.findByProps({type:'file'}).props.onChange({target:{files:[{name:'empty',size:0}],value:''}}));
  assert.equal(tree.root.findAllByType('li').length,0);
  await act(async()=>form(tree).props.onSubmit(prevent()));await act(async()=>form(tree).props.onSubmit(prevent()));
  assert.equal(payloads[0].clientThreadId,payloads[1].clientThreadId);await act(async()=>tree.unmount());
});

test('Channel toolbar and Command-N open production dialog with correct default and preserve selected conversation',async()=>{
  const listeners=environment({});const tree=await mount(DesktopShellView,{snapshot});
  await act(async()=>tree.root.findByProps({'aria-label':'New session in Beta'}).props.onClick());
  assert.equal(tree.root.findByType('select').props.value,'b');
  await act(async()=>tree.root.findAllByType('button').find(x=>x.children.includes('Cancel')).props.onClick());
  await act(async()=>listeners.get('keydown')({key:'n',metaKey:true,preventDefault(){}}));
  assert.equal(tree.root.findByType('select').props.value,'a');await act(async()=>tree.unmount());
});

test('desktop composer separates stop and send; preserves IME/Shift+Enter and sends exactly once',async()=>{
  const send=deferred(),calls=[];environment({sendMessage:x=>{calls.push(x);return send.promise;},stopThread:async()=>calls.push('stop')});
  const tree=await mount(DesktopShellView,{snapshot:{...snapshot, selectedThreadId:'thread-a',threads:[{id:'thread-a',channelId:'a',title:'First',running:true}]}});
  await act(async()=>tree.root.findByProps({'aria-label':'Message'}).props.onChange({target:{value:'hello'}}));
  const input=tree.root.findByProps({'aria-label':'Message'});
  await act(async()=>{input.props.onKeyDown({key:'Enter',shiftKey:true,nativeEvent:{isComposing:false},preventDefault(){throw Error('must not suppress')}});input.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:true},preventDefault(){throw Error('must not suppress')}});});
  assert.deepEqual(calls,[]);
  await act(async()=>{tree.root.findByProps({'aria-label':'Send message'}).props.onClick();tree.root.findByProps({'aria-label':'Send message'}).props.onClick();});
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{text:'hello',attachmentIds:[]});
  assert.equal(tree.root.findByProps({'aria-label':'Stop agent'}).props.disabled,undefined);
  await act(async()=>send.resolve());assert.equal(tree.root.findByProps({'aria-label':'Message'}).props.value,'');await act(async()=>tree.unmount());
});

test('left blue user bubbles and mobile-like bounded composer have explicit CSS rules',async()=>{
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.message-user \{[^}]*max-width: 80%;[^}]*margin-right: auto;[^}]*background: #e6f0ff;/);
  assert.match(css,/\.composer textarea \{[^}]*max-height: 120px;[^}]*resize: none;/);
  assert.match(css,/channel-toolbar:focus-within/);
});

test('Chromium: production shell keeps blue bubbles left and all composer controls inside the conversation', {skip: !process.env.HERMES_TEST_CHROME}, async()=>{
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
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';document.querySelector('.desktop-shell').style.width=width+'px';
        const user=document.querySelector('.message-user'),agent=document.querySelector('.message-assistant'),pane=document.querySelector('.conversation-pane'),row=document.querySelector('.composer-row');
        const bubble=user.getBoundingClientRect(),other=agent.getBoundingClientRect(),bounds=pane.getBoundingClientRect(),controls=[...row.children].map(x=>{const b=x.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,height:b.height}});
        results.push({width,bubbleLeft:bubble.left,agentLeft:other.left,bubbleWidth:bubble.width,agentWidth:other.width,background:getComputedStyle(user).backgroundColor,paneLeft:bounds.left,paneRight:bounds.right,controls});
      } document.getElementById('results').textContent=JSON.stringify(results);
    </script></body></html>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
    const results=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)[1]);
    for(const result of results){
      assert.equal(result.background,'rgb(230, 240, 255)');
      assert.equal(result.bubbleLeft,result.agentLeft,'same left edge, not right-aligned');
      assert.ok(result.bubbleWidth < result.agentWidth*.8,'short blue bubble shrinks to content');
      assert.equal(result.controls.length,4,'plus, input, stop, send');
      for(const control of result.controls){assert.ok(control.width>0);assert.ok(control.left>=result.paneLeft);assert.ok(control.right<=result.paneRight);}
      assert.equal(result.controls[1].height,42);
    }
  } finally {await rm(folder,{recursive:true,force:true});}
});
