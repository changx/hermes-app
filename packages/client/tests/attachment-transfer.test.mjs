import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/index.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {HermesClient,HttpError,TimeoutError,TRANSFER_BYTES_PER_SECOND}=module.exports;
const MiB=1024*1024;
const wait=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
const attachment=(size,thread='T')=>({attachment:{id:'att_1',thread_id:thread,name:'video.mp4',mime:'video/mp4',size}});
const client=http=>new HermesClient({token:()=>'synthetic',requestTimeoutMs:20,http:{request:async()=>({status:200,body:{}}),...http},socket:{connect:async()=>{throw new Error('offline');}}});

test('upload deadline grows with the file size at the minimum transfer rate',async()=>{
  assert.equal(TRANSFER_BYTES_PER_SECOND,128*1024);
  const calls=[];
  const sdk=client({async uploadFile(path,_token,name,file,signal){calls.push([path,name,file]);await wait(150,signal);return {status:201,body:attachment(file.size)};}});
  // 128 KiB adds one second to the 20 ms base: a 150 ms transfer completes.
  const done=await sdk.uploadFile('T','video.mp4',{uri:'file:///cache/video.mp4',size:128*1024});
  assert.equal(done.size,128*1024); assert.equal(sdk.attachments.get('att_1').thread_id,'T');
  assert.deepEqual(calls[0],['/v1/threads/T/attachments','video.mp4',{uri:'file:///cache/video.mp4',size:128*1024}]);
  // A tiny file keeps the short base deadline.
  await assert.rejects(sdk.uploadFile('T','tiny.bin',{uri:'file:///cache/tiny.bin',size:1}),TimeoutError);
});

test('byte upload uses the same size-based deadline',async()=>{
  const sdk=client({async upload(_path,_token,_name,bytes,signal){await wait(150,signal);return {status:201,body:attachment(bytes.byteLength)};}});
  assert.equal((await sdk.upload('T','a.bin',new Uint8Array(128*1024))).size,128*1024);
  await assert.rejects(sdk.upload('T','b.bin',new Uint8Array(1)),TimeoutError);
});

test('file upload rejects a reply for another Thread and reports HTTP failures',async()=>{
  let reply={status:201,body:attachment(5,'other')};
  const sdk=client({async uploadFile(){return reply;}});
  await assert.rejects(sdk.uploadFile('T','a',{uri:'file:///a',size:5}),/thread mismatch/);
  reply={status:413,body:'too large'};
  await assert.rejects(sdk.uploadFile('T','a',{uri:'file:///a',size:101*MiB}),error=>error instanceof HttpError&&error.status===413);
});

test('file download writes to the destination and uses the known attachment size for its deadline',async()=>{
  const calls=[];
  const sdk=client({async downloadFile(path,_token,destination,signal){calls.push([path,destination]);await wait(150,signal);return {status:200,size:128*1024};},
    async uploadFile(_p,_t,_n,file){return {status:201,body:attachment(file.size)};}});
  assert.equal(sdk.supportsFileTransfer,true);
  await sdk.uploadFile('T','video.mp4',{uri:'file:///v',size:128*1024});
  assert.equal(await sdk.downloadFile('T','att_1','file:///cache/out.mp4'),128*1024);
  assert.deepEqual(calls[0],['/v1/threads/T/attachments/att_1','file:///cache/out.mp4']);
  // Unknown size: base deadline only.
  await assert.rejects(sdk.downloadFile('T','att_unknown','file:///cache/x'),TimeoutError);
  const failing=client({async downloadFile(){return {status:404,size:0};}});
  await assert.rejects(failing.downloadFile('T','att_1','file:///cache/y'),error=>error instanceof HttpError&&error.status===404);
  assert.equal(client({}).supportsFileTransfer,false);
});
