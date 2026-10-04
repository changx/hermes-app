import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=new URL('../../../../',import.meta.url).pathname.replace(/\/$/,'');
const require=createRequire(root+'/package.json');
const {build}=require('esbuild');
async function load(path){const out=await build({entryPoints:[root+'/'+path],bundle:true,platform:'node',format:'cjs',write:false});const module={exports:{}};new Function('module','exports','require',out.outputFiles[0].text)(module,module.exports,require);return module.exports;}
const {LivePageClient}=await load('packages/client/src/livePages.ts');
const {mainTransport}=await load('apps/desktop/src/main/transport.ts');
const [base,one,two]=process.argv.slice(2);
const transport=mainTransport(base,true), paths=[];
let connections=0;
const request=transport.http.request.bind(transport.http), connect=transport.socket.connect.bind(transport.socket);
transport.http.request=(...args)=>{paths.push(args[1]);return request(...args);};
transport.socket.connect=(...args)=>{connections++;return connect(...args);};
const sdk=new LivePageClient({...transport,token:()=> 'synthetic-live-test-token-at-least-32-characters',livenessMs:1000,backoffMs:[5]});
async function until(predicate){const end=Date.now()+7000;while(!predicate()){assert.ok(Date.now()<end,'real SDK/plugin condition timed out');await new Promise(resolve=>setTimeout(resolve,5));}}
try{
  await sdk.connect();await until(()=>sdk.isCatalogueReady&&sdk.connectionState==='online');
  const a=sdk.acquirePage(one),b=sdk.acquirePage(two);
  await Promise.all([a.openConversation(one),b.openConversation(two)]);
  const key=a.currentConversationKey, original=a.messages.get(one)?.[0];
  assert.equal(a.channels,sdk.channels);assert.equal(b.threads,sdk.threads);
  assert.equal(connections,1);assert.equal(paths.filter(p=>p==='/v1/capabilities').length,1);assert.equal(paths.filter(p=>p.startsWith('/v1/catalogue')).length,1);
  console.log('READY');
  await until(()=>connections===2&&sdk.connectionState==='online'&&a.messages.get(one)?.some(row=>row.text==='Synthetic integration final'));
  assert.equal(a.currentConversationKey,key);if(original)assert.equal(a.messages.get(one)[0],original);
  sdk.releasePage(two,b);assert.equal(b.messages.size,0);assert.equal(sdk.page(one),a);
  await sdk.acquirePage(two).openConversation(two);assert.equal(connections,2);
  assert.equal(paths.filter(p=>p==='/v1/capabilities').length,2);
  sdk.close();assert.equal(sdk.messages.size,0);assert.equal(sdk.openedPageIds.length,0);
  console.log(JSON.stringify({result:'passed',real_http_ws:true,released_content:true,account_connections_initial:1,account_connections_after_reconnect:connections,capabilities_requests:paths.filter(p=>p==='/v1/capabilities').length,catalogue_requests:paths.filter(p=>p.startsWith('/v1/catalogue')).length,pages:2}));
}finally{sdk.close();}
