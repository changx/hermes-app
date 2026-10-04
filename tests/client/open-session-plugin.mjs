// Real isolated plugin interoperability; synthetic fixture data only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{resolveDir:new URL('../..',import.meta.url).pathname,contents:`export {LivePageClient} from './packages/client/src/livePages'; export {mainTransport} from './apps/desktop/src/main/transport';`},bundle:true,format:'cjs',platform:'node',external:['ws'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const [base,aId,bId]=process.argv.slice(2),transport=mod.exports.mainTransport(base,true);let connections=0;
const client=new mod.exports.LivePageClient({...transport,socket:{connect(...args){connections++;return transport.socket.connect(...args)}},token:()=> 'synthetic-live-test-token-at-least-32-characters',backoffMs:[5]});
const until=async fn=>{const end=Date.now()+8000;while(!fn()){assert.ok(Date.now()<end,'isolated plugin update timed out');await new Promise(r=>setTimeout(r,10))}};
try{
 await client.connect();await until(()=>client.isCatalogueReady);const a=client.acquirePage(aId),b=client.acquirePage(bId);await Promise.all([a.openConversation(aId),b.openConversation(bId)]);
 const key=a.currentConversationKey,initial=connections;assert.equal(initial,1);console.log('READY');
 await until(()=>a.messages.get(aId)?.some(row=>row.text==='Synthetic integration final'));assert.equal(a.currentConversationKey,key);assert.equal(client.page(aId),a);assert.equal(connections,2);
 client.releasePage(bId,b);assert.equal(b.messages.size,0);assert.equal(client.page(aId),a);client.close();assert.deepEqual(client.openedPageIds,[]);
 console.log(JSON.stringify({result:'passed',real_http_ws:true,released_content:true,account_connections_initial:initial,account_connections_after_reconnect:connections,concurrent_pages:true,retained_reconnect:true}));
}finally{client.close()}
