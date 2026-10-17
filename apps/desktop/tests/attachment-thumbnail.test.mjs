import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), React = require('react'), {act,create} = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`export * from './src/renderer/attachment-thumbnail'; export {AttachmentView} from './src/renderer/attachment-view';`},bundle:true,platform:'node',format:'cjs',external:['react','react/jsx-runtime'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);
const {AttachmentThumbnail,AttachmentView,attachmentTypeLabel,imageThumbnailSupported}=mod.exports;
// State/lifecycle fixtures do not claim image decoding; native tests decode actual clipboard PNGs.
const source='data:image/png;base64,Y29udHJvbGxlZC1zdGF0ZS1maXh0dXJl';
const attachment=id=>({id,name:id+'.png',mime:'image/png',size:3,state:'available'});
async function mount(element){let tree;await act(async()=>{tree=create(element,{createNodeMock:()=>({closest:()=>null})});});return tree;}
function environment(api={}){
  const oldWindow=globalThis.window, oldObserver=globalThis.IntersectionObserver, oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  const observers=[],created=[],revoked=[];
  globalThis.window={hermesDesktop:api};
  globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}fire(){this.callback([{isIntersecting:true}]);}};
  URL.createObjectURL=file=>{const url='blob:controlled-'+created.length;created.push({file,url});return url;};URL.revokeObjectURL=url=>revoked.push(url);
  return {observers,created,revoked,restore(){globalThis.window=oldWindow;globalThis.IntersectionObserver=oldObserver;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}};
}
test('every attachment type has a truthful tile; only supported raster images get automatic image loads',()=>{
  for(const [name,label] of [['a.png','IMG'],['a.pdf','PDF'],['a.html','HTML'],['a.txt','TXT'],['a.zip','ZIP'],['a.docx','DOC'],['a.csv','DATA'],['a.mov','VIDEO'],['a.wav','AUDIO'],['a.bin','FILE']])assert.equal(attachmentTypeLabel(name),label);
  assert.equal(imageThumbnailSupported('a.png','',true),true);assert.equal(imageThumbnailSupported('a.jpg','image/jpeg'),true);
  for(const [name,mime] of [['a.svg','image/svg+xml'],['a.heic','image/heic'],['a.png','text/html'],['a.pdf','application/pdf']])assert.equal(imageThumbnailSupported(name,mime,true),false);
  assert.equal(imageThumbnailSupported('a.png','',false),false,'remote image classification uses authoritative MIME');
});
test('local image CSP allows blob images without enabling blob scripts or remote network access',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const policy=html.match(/content="(default-src[^"]+)"/)?.[1];
  assert.equal(policy,"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'");
});
test('selected and pasted File images stay local and revoke their object URLs on replacement and unmount',async()=>{
  const env=environment(),first=new File(['fixture'],'first.png',{type:'image/png'}),second=new File(['fixture'],'second.jpg',{type:'image/jpeg'});
  let tree;try{tree=await mount(React.createElement(AttachmentThumbnail,{file:first}));assert.equal(env.created.length,1);assert.equal(tree.root.findByType('img').props.src,env.created[0].url);
    await act(async()=>tree.update(React.createElement(AttachmentThumbnail,{file:second})));assert.deepEqual(env.revoked,[env.created[0].url]);assert.equal(tree.root.findByType('img').props.src,env.created[1].url);
    await act(async()=>tree.root.findByType('img').props.onError());assert.equal(tree.root.findAllByType('img').length,0);assert.equal(tree.root.findByProps({role:'img'}).props['data-thumbnail-state'],'error');
    await act(async()=>tree.unmount());tree=undefined;assert.deepEqual(env.revoked,env.created.map(item=>item.url));
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});
test('non-images and unsupported images use file tiles without creating local URLs or fetching remote content',async()=>{
  let calls=0;const env=environment({previewAttachmentImage:async()=>{calls++;return source;}});let tree;
  try{tree=await mount(React.createElement('div',null,React.createElement(AttachmentThumbnail,{file:new File(['<script>'], 'page.html',{type:'text/html'})}),React.createElement(AttachmentThumbnail,{attachment:{...attachment('svg'),name:'vector.svg',mime:'image/svg+xml'}}),React.createElement(AttachmentThumbnail,{attachment:{...attachment('pdf'),name:'paper.pdf',mime:'application/pdf'}})));
    assert.equal(tree.root.findAllByProps({role:'img'}).length,3);assert.equal(tree.root.findAllByType('img').length,0);assert.equal(env.created.length,0);assert.equal(calls,0);
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});
test('remote thumbnails load lazily and late responses cannot replace a newer attachment image',async()=>{
  const pending=new Map(),calls=[];const env=environment({previewAttachmentImage:id=>{calls.push(id);return new Promise(resolve=>pending.set(id,resolve));}});let tree;
  try{tree=await mount(React.createElement(AttachmentThumbnail,{attachment:attachment('first')}));assert.deepEqual(calls,[]);await act(async()=>env.observers[0].fire());assert.deepEqual(calls,['first']);
    await act(async()=>tree.update(React.createElement(AttachmentThumbnail,{attachment:attachment('second')})));await act(async()=>env.observers[1].fire());
    await act(async()=>pending.get('first')(source));assert.equal(tree.root.findAllByType('img').length,0);
    await act(async()=>pending.get('second')(source));assert.equal(tree.root.findByType('img').props.src,source);assert.equal(tree.root.findByProps({role:'img'}).props['aria-label'],'Thumbnail: second.png');
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});
test('authenticated thumbnail requests use at most three concurrent slots and reject remote URL sources',async()=>{
  const calls=[],pending=[];const env=environment({previewAttachmentImage:id=>{calls.push(id);return new Promise(resolve=>pending.push(resolve));}});let tree;
  try{tree=await mount(React.createElement('div',null,...Array.from({length:6},(_,i)=>React.createElement(AttachmentThumbnail,{key:i,attachment:attachment(String(i))}))));await act(async()=>env.observers.forEach(observer=>observer.fire()));assert.equal(calls.length,3);
    await act(async()=>pending.slice(0,3).forEach(resolve=>resolve(source)));assert.equal(calls.length,6);
    await act(async()=>pending.slice(3).forEach(resolve=>resolve('https://untrusted.example/image.png')));assert.equal(tree.root.findAllByType('img').length,3);assert.equal(tree.root.findAllByProps({'data-thumbnail-state':'error'}).length,3);
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});
test('message thumbnail reuses the large image source instead of downloading the same attachment twice',async()=>{
  let calls=0,previews=0;const env=environment({previewAttachmentImage:async()=>{calls++;return source;},previewAttachment:async()=>{previews++;}});let tree;
  try{tree=await mount(React.createElement(AttachmentView,{attachment:attachment('message')}));await act(async()=>env.observers[0].fire());assert.equal(calls,1);assert.equal(tree.root.findAllByType('img').length,2);assert.equal(tree.root.findAllByType('img')[0].props.src,tree.root.findAllByType('img')[1].props.src);
    await act(async()=>tree.root.findByProps({'aria-label':'Preview image: message.png'}).props.onClick());assert.equal(previews,1);
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Save shows download progress on the card, disables Save/Open while it runs and clears when done',async()=>{
  let listener,finish,unsubscribed=0;const calls=[];
  const env=environment({onDownloadProgress:l=>{listener=l;return()=>{unsubscribed++;};},downloadAttachment:(id,action)=>{calls.push([id,action]);return new Promise(resolve=>{finish=resolve;});}});let tree;
  try{
    const file={id:'att-big',name:'large-test-150MB.bin',mime:'application/octet-stream',size:150*1048576,state:'available'};
    tree=await mount(React.createElement(AttachmentView,{attachment:file}));
    const button=label=>tree.root.findAll(n=>n.type==='button'&&n.children.join('')===label)[0];
    await act(async()=>button('Save').props.onClick());
    assert.deepEqual(calls,[['att-big','save']]);
    assert.equal(button('Save').props.disabled,true);assert.equal(button('Open externally').props.disabled,true);
    assert.equal(tree.root.findAllByProps({role:'progressbar'}).length,0,'no bar while the Save dialog is open');
    await act(async()=>button('Save').props.onClick());assert.equal(calls.length,1,'a second click starts nothing');
    await act(async()=>listener({attachmentId:'other',received:5,total:10}));
    assert.equal(tree.root.findAllByProps({role:'progressbar'}).length,0,'other attachments do not move this bar');
    await act(async()=>listener({attachmentId:'att-big',received:67*1048576,total:150*1048576}));
    const bar=tree.root.findByProps({role:'progressbar'});
    assert.equal(bar.props['aria-valuenow'],44);
    assert.equal(tree.root.findByProps({className:'attachment-progress-text'}).children.join(''),'Saving… 44% · 67 of 150 MB');
    assert.equal(tree.root.findByProps({className:'attachment-progress-fill'}).props.style.width,'44%');
    await act(async()=>finish());
    assert.equal(tree.root.findAllByProps({role:'progressbar'}).length,0);assert.equal(unsubscribed,1);
    assert.equal(button('Save').props.disabled,false);
  }finally{if(tree)await act(async()=>tree.unmount());env.restore();}
});
