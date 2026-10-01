import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
const root=new URL('..',import.meta.url).pathname;
async function load(contents, external){
 const result=await build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',external,write:false});
 const mod={exports:{}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
 return mod.exports;
}
const {DesktopConnectionService}=await load(`export {DesktopConnectionService} from './src/main/connection-service';`,['electron']);
const {render}=await load(`import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {AttachmentView} from './src/renderer/attachment-view'; export const render=(attachment)=>renderToStaticMarkup(createElement(AttachmentView,{attachment}));`,['react','react-dom/server','react/jsx-runtime']);
const metadata={id:'att_'+'a'.repeat(32),thread_id:'thread-a',state:'available',name:'screenshot.png',mime:'image/png',size:8,receipt_id:'receipt',public_url:'https://agent.tuly.space/media/att_'+'a'.repeat(32)+'/screenshot.png'};
function fixture(){
 const service=new DesktopConnectionService(()=>{});service.phase='connected'; service.selectedThreadId='thread-a';
 service.connection={baseUrl:'https://agent.tuly.space',id:'test',token:'synthetic'};
 let count=0;
 service.client={attachments:new Map([[metadata.id,metadata]]),download:async()=>{count++;return new Uint8Array([137,80,78,71,13,10,26,10]);}};
 return {service,calls:()=>count};
}
test('image preview returns bounded authenticated bytes, not token-bearing or remote URLs',async()=>{
 const {service,calls}=fixture();
 const preview=await service.previewAttachmentImage(metadata.id);
 assert.equal(preview,'data:image/png;base64,iVBORw0KGgo=');assert.equal(calls(),1);
 const projected=service.projectAttachment(metadata);
 assert.equal(projected.publicUrl,metadata.public_url);
 const markup=render(projected);
 assert.match(markup,/Loading image…/);assert.match(markup,/Open image: screenshot.png/);
 assert.match(markup,/View file/);assert.match(markup,/target="_blank"/);assert.doesNotMatch(markup,/Bearer|token=/);
});
test('preview rejects missing, foreign, oversized, SVG and non-image attachments without fetching',async()=>{
 for(const mutation of [null,{thread_id:'foreign'},{state:'missing'},{mime:'image/svg+xml'},{mime:'text/html'},{size:0},{size:10*1024*1024+1}]){
  const {service,calls}=fixture();
  if(mutation===null)service.client.attachments.clear();else service.client.attachments.set(metadata.id,{...metadata,...mutation});
  await assert.rejects(service.previewAttachmentImage(metadata.id));assert.equal(calls(),0);
 }
});
test('preview discards corrupt bytes and completion after thread navigation',async()=>{
 const a=fixture();a.service.client.download=async()=>new Uint8Array([1]);
 await assert.rejects(a.service.previewAttachmentImage(metadata.id));
 const b=fixture();b.service.client.download=async()=>{b.service.selectedThreadId='another';return new Uint8Array(8);};
 await assert.rejects(b.service.previewAttachmentImage(metadata.id));
});
