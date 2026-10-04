import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),React=require('react');
const {act,create}=require('react-test-renderer');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({entryPoints:[new URL('../src/renderer/shell.tsx',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['react','react/jsx-runtime'],write:false});
const base={revision:1,phase:'connected',connectionState:'online',draftIdentity:'abcdef0123456789abcdef01',channels:[{id:'c',name:'Channel'}],threads:[{id:'t',channelId:'c',title:'Session',running:false,lastMessageAt:Date.now()/1000}],selectedChannelId:'c',selectedThreadId:'t',selectedThreadTitle:'Session',messages:[],interactions:[],canLoadOlder:false};
const saved={t:{text:'  restored\r\n',attachments:[{id:'att_one',name:'note.txt',mime:'text/plain',size:4,state:'available'}]}};
function view() {const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.DesktopShellView;}
function environment(api) {globalThis.window={hermesDesktop:api,setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};globalThis.document={activeElement:null};}
async function mount(Component,snapshot=base){let tree;await act(async()=>{tree=create(React.createElement(Component,{snapshot}));});return tree;}

test('renderer cold mount restores contents, attachment selections and list labels before opening, and every later edit is saved locally',async()=>{
  const calls=[];environment({loadLocalDrafts:async identity=>{assert.equal(identity,base.draftIdentity);return structuredClone(saved);},saveLocalDraft:async(...args)=>calls.push(args)});
  let tree=await mount(view());assert.equal(tree.root.findByProps({'aria-label':'Message'}).props.value,saved.t.text);assert.equal(tree.root.findAllByProps({className:'thread-draft'}).length,1);assert.equal(tree.root.findAllByProps({'aria-label':'Remove note.txt'}).length,1);assert.equal(calls.length,0);
  await act(async()=>tree.root.findByProps({'aria-label':'Message'}).props.onChange({target:{value:'latest'}}));await act(async()=>tree.root.findByProps({'aria-label':'Message'}).props.onChange({target:{value:'latest edited'}}));
  assert.equal(calls.at(-1)[2].text,'latest edited');assert.equal(calls.at(-1)[2].attachments[0].id,'att_one');await act(async()=>tree.unmount());
  environment({loadLocalDrafts:async()=>({t:calls.at(-1)[2]}),saveLocalDraft:async()=>{}});tree=await mount(view());assert.equal(tree.root.findByProps({'aria-label':'Message'}).props.value,'latest edited');await act(async()=>tree.unmount());
});
test('pending and failed restore cannot overwrite storage with empty composers; retry and local save errors are visible',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);let saves=0;
  environment({loadLocalDrafts:()=>pending,saveLocalDraft:async()=>saves++});const tree=await mount(view());assert.equal(tree.root.findAllByType('textarea').length,0);assert.equal(saves,0);
  await act(async()=>resolve(saved));await act(async()=>tree.unmount());
  let reads=0;environment({loadLocalDrafts:async()=>{if(++reads===1)throw Error('read');return saved;},saveLocalDraft:async()=>{throw Error('disk full');}});
  const retry=await mount(view());assert.equal(retry.root.findAllByType('textarea').length,0);assert.match(retry.root.findByProps({role:'alert'}).children.join(''),/could not be loaded/);
  await act(async()=>retry.root.findByType('button').props.onClick());assert.equal(retry.root.findByProps({'aria-label':'Message'}).props.value,saved.t.text);
  await act(async()=>retry.root.findByProps({'aria-label':'Message'}).props.onChange({target:{value:'keep this'}}));assert.equal(retry.root.findByProps({'aria-label':'Message'}).props.value,'keep this');assert.match(retry.root.findByProps({role:'alert'}).children.join(''),/could not be saved/);await act(async()=>retry.unmount());
});
