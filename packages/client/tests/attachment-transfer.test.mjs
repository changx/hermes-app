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

// A fake server with the plugin's chunked-upload protocol (chunked_upload.py).
function chunkServer({size,chunk=4,loseReplyAt,failAlways}={}){
  const state={received:0,bytes:[],calls:[],deleted:false,completes:0};
  const json=(status,body)=>({status,body});
  const view=()=>({upload:{id:'up_'+'a'.repeat(32),received:state.received,chunk_size:chunk,size}});
  return {state,http:{
    async request(method,path,_token,body){
      state.calls.push([method,path.replace(/up_a+/,'UP'),body]);
      if(path==='/v1/capabilities')return json(200,{protocol:1,chunked_uploads:true,upload_max_bytes:2*1024**3});
      if(method==='POST'&&path==='/v1/threads/T/uploads')return json(201,view());
      if(method==='GET')return json(200,view());
      if(method==='DELETE'){state.deleted=true;return json(200,{deleted:true});}
      if(method==='POST'&&path.endsWith('/complete')){state.completes++;return state.received===size?json(201,attachment(size)):json(409,view());}
      return json(404,{});
    },
    async uploadChunk(path,_token,bytes){
      const offset=Number(new URL('http://x'+path).searchParams.get('offset'));
      state.calls.push(['PUT',offset,bytes.byteLength]);
      if(failAlways)throw new Error('network down');
      if(offset!==state.received)return json(409,view());
      for(const b of bytes)state.bytes.push(b); state.received+=bytes.byteLength;
      if(offset===loseReplyAt){loseReplyAt=undefined;throw new Error('connection reset');}  // stored, reply lost
      return json(200,view());
    }}};
}

test('chunked upload sends ordered chunks, resumes after a lost reply and completes once',async()=>{
  const size=2*MiB+MiB/2, data=Uint8Array.from({length:size},(_,i)=>i%251);
  const server=chunkServer({size,chunk:MiB,loseReplyAt:MiB});
  const sdk=client(server.http); await sdk.capabilities();
  assert.equal(sdk.supportsChunkedUpload,true); assert.equal(sdk.uploadMaxBytes,2*1024**3);
  const reads=[], progress=[];
  const done=await sdk.uploadChunked('T','video.mp4',size,async(offset,length)=>{reads.push([offset,length]);return data.slice(offset,offset+length);},undefined,(sent)=>progress.push(sent));
  assert.equal(done.size,size); assert.equal(sdk.attachments.get('att_1').thread_id,'T');
  assert.ok(server.state.bytes.length===size&&server.state.bytes.every((v,i)=>v===data[i]),'the server holds every byte once, in order');
  assert.deepEqual(reads,[[0,MiB],[MiB,MiB],[2*MiB,MiB/2]],'the lost reply resyncs to the confirmed offset instead of resending');
  assert.deepEqual(progress,[MiB,size],"progress after each confirmed step");
  assert.deepEqual(server.state.calls[1],['POST','/v1/threads/T/uploads',{name:'video.mp4',size}]);
  assert.ok(server.state.calls.some(c=>c[0]==='GET'),'resync after the lost reply');
  assert.equal(server.state.completes,1); assert.equal(server.state.deleted,false);
});

test('chunked upload gives up after repeated failures and deletes the server upload',async()=>{
  const server=chunkServer({size:10,failAlways:true});
  const sdk=client(server.http); await sdk.capabilities();
  const abort=new AbortController(); setTimeout(()=>abort.abort(),1500);
  await assert.rejects(sdk.uploadChunked('T','a.bin',10,async(o,l)=>new Uint8Array(l),abort.signal),/aborted/);
  await wait(10);
  assert.equal(server.state.deleted,true,'a stopped upload removes its partial file on the server');
  // Without the capability (or the transport method), chunked upload is not offered.
  const old=client({async request(){return {status:200,body:{protocol:1}};},async uploadChunk(){}}); await old.capabilities();
  assert.equal(old.supportsChunkedUpload,false); assert.equal(old.uploadMaxBytes,100*MiB);
  await assert.rejects(old.uploadChunked('T','a',10,async()=>new Uint8Array()),/unavailable/);
  const noTransport=client({async request(){return {status:200,body:{protocol:1,chunked_uploads:true}};}}); await noTransport.capabilities();
  assert.equal(noTransport.supportsChunkedUpload,false);
  await assert.rejects(sdk.uploadChunked('T','a',2*1024**3+1,async()=>new Uint8Array()),/size unsupported/);
});
