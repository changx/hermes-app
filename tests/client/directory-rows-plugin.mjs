// Real isolated plugin interoperability for changed directory rows; synthetic fixture data only.
// argv: base URL, Thread with an unread result, second Thread. Prints READY, then a JSON result.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
const bundle=await build({stdin:{resolveDir:new URL('../..',import.meta.url).pathname,contents:`export {LivePageClient} from './packages/client/src/livePages'; export {mainTransport} from './apps/desktop/src/main/transport';`},bundle:true,format:'cjs',platform:'node',external:['ws'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const [base,aId,bId]=process.argv.slice(2),transport=mod.exports.mainTransport(base,true),calls=[];
const request=transport.http.request.bind(transport.http);
transport.http.request=(method,path,...rest)=>{calls.push(method+' '+path.split('?')[0]);return request(method,path,...rest)};
const client=new mod.exports.LivePageClient({...transport,token:()=> 'synthetic-live-test-token-at-least-32-characters',backoffMs:[5]});
const until=async fn=>{const end=Date.now()+8000;while(!fn()){assert.ok(Date.now()<end,'isolated plugin update timed out');await new Promise(r=>setTimeout(r,10))}};
const count=call=>calls.filter(c=>c===call).length;
try{
  await client.connect();await until(()=>client.isCatalogueReady&&client.connectionState==='online');
  assert.equal(client.supportsCatalogueThreads,true);
  const a=client.acquirePage(aId);await a.openConversation(aId);
  const row=client.threads.get(aId);assert.equal(row.completed_unread,true);
  await until(()=>a.messages.get(aId)?.some(m=>m.ref_seq===row.result_ref&&m.role==='assistant'));
  const walks=count('GET /v1/catalogue');
  await a.markResultRead(aId,row.result_version,row.result_ref);
  // Cleared by the acknowledgement's own response.
  assert.equal(client.threads.get(aId).completed_unread,false);
  assert.equal(count('POST /v1/threads/'+aId+'/result-read'),1);
  await until(()=>count('GET /v1/catalogue/threads')>=1); // the commit's directory_changed names the row
  console.log('READY');
  // The harness now completes a result on the second Thread.
  await new Promise(resolve=>{const lines=createInterface({input:process.stdin});lines.once('line',()=>{lines.close();process.stdin.destroy();resolve()})});
  await until(()=>client.threads.get(bId)?.completed_unread===true);
  assert.equal(client.threads.get(aId).completed_unread,false);
  assert.equal(count('GET /v1/catalogue'),walks,'no catalogue walk after the initial read');
  console.log(JSON.stringify({result:'passed',real_http_ws:true,read_cleared_by_response:true,row_reads:count('GET /v1/catalogue/threads'),catalogue_walks_after_ready:count('GET /v1/catalogue')-walks}));
}finally{client.close()}
