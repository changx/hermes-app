import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{resolveDir:new URL('../..',import.meta.url).pathname,contents:'export {LivePageClient} from "./packages/client/src/livePages"; export {mainTransport} from "./apps/desktop/src/main/transport";'},bundle:true,format:'cjs',platform:'node',external:['ws'],write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {LivePageClient,mainTransport}=mod.exports;
const [base,aId,bId]=process.argv.slice(2),transport=mainTransport(base,true);
const sdk=new LivePageClient({...transport,token:()=> 'synthetic-live-test-token-at-least-32-characters'});
const until=async fn=>{const deadline=Date.now()+8000;while(!fn()){assert.ok(Date.now()<deadline,'plugin update timed out');await new Promise(resolve=>setTimeout(resolve,10));}};
try{
 await sdk.connect();await until(()=>sdk.isCatalogueReady);
 const a=sdk.acquirePage(aId),b=sdk.acquirePage(bId);await Promise.all([a.openConversation(aId),b.openConversation(bId)]);
 const key=a.currentConversationKey;
 console.log('READY');
 await until(()=>a.messages.get(aId)?.some(row=>row.text==='Multi-page A update')&&b.messages.get(bId)?.some(row=>row.text==='Multi-page B update'));
 assert.equal(a.currentConversationKey,key);assert.equal(sdk.page(aId),a);
 sdk.releasePage(bId,b);assert.equal(b.messages.size,0);assert.equal(sdk.page(aId),a);
 sdk.suspendConnection();const rows=a.messages.get(aId);await sdk.connect();await until(()=>a.connectionState==='online');assert.equal(a.currentConversationKey,key);assert.equal(a.messages.get(aId)[0],rows[0]);
 sdk.close();assert.equal(sdk.messages.size,0);assert.deepEqual(sdk.openedPageIds,[]);
 console.log(JSON.stringify({result:'passed',real_plugin_http_ws:true,concurrent_pages:true,released_content:true,retained_reconnect:true}));
}finally{sdk.close();}
