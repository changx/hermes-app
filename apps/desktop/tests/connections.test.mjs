import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints:[new URL('../src/main/connections.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false });
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='electron'?{app:{getPath:()=>tmpdir()},safeStorage:{}}:require(name),mod,mod.exports);
const {DesktopConnections}=mod.exports;
const request={baseUrl:'https://second.example.test',code:'ABCD-EFGH-JKLM-NPQR',deviceName:'Test desktop'};
function fixture() {
  const published=[],writes=[],records=new Map();
  const workspace=new DesktopConnections(s=>published.push(s));
  workspace.ready=true;
  workspace.index={async save(entries){writes.push(structuredClone(entries));},async load(){return [];}};
  const cleared=[];
  const drafts={async list(id){return records.get(id)??{};},async put(id,key,draft){records.set(id,{...(records.get(id)??{}),[key]:draft});},async clear(id){cleared.push(['drafts',id]);records.delete(id);},async flush(){}};
  const outbox={async list(){return [];},async clear(id){cleared.push(['outbox',id]);},async put(){},async remove(){}};
  workspace.drafts=drafts; workspace.outbox=outbox;
  function install(service,letter,server) {
    service.connection={id:letter.repeat(24),baseUrl:server,token:'fixture-only-private-token'};
    service.phase='connected';service.connectionState='online';service.selectedChannelId='p';
    service.localDraftStore=drafts;service.outboxStore=outbox;
    service.store={async delete(){cleared.push(['credential',letter]);}};
    const pages=new Map(),calls=[];
    const client={channels:new Map([['p',{id:'p',name:'Shared Project'}]]),threads:new Map([['th_same0000',{id:'th_same0000',project_id:'p',title:letter+' session',last_message_at:1}]]),messages:new Map(),receipts:new Map(),attachments:new Map(),interactions:new Map(),supportsSessionLabels:true,isCatalogueReady:true,
      isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);},
      acquirePage(id){const page={messages:client.messages,currentOlderCursor:undefined,async openConversation(){client.messages.set(id,[{id:'same-message',role:'assistant',text:letter+' content',ref_seq:1}]);service.changed();}};pages.set(id,page);return page;},
      async getModelSettings(){calls.push(['model-read',letter]);return {model:letter,provider:'fixture',providers:[]};},
      async stop(id){calls.push(['stop',id]);},async markResultRead(id){calls.push(['read',id]);},close(){calls.push(['close']);},
    };service.client=client;return {service,client,calls};
  }
  const a=install(workspace.primary,'a','https://first.example.test');
  const account=workspace.make('b'.repeat(24),request.baseUrl),b=install(account.service,'b',request.baseUrl);
  workspace.entries=[{id:account.id,server:request.baseUrl}];
  return {workspace,a,b,published,writes,cleared,records,other:'b'.repeat(24)+':th_same0000'};
}
test('multi-connection projection isolates equal raw Project/Thread IDs, content, links and model targets',async()=>{
  const f=fixture(),s=f.workspace.snapshot();
  assert.equal(s.connections.length,2);assert.equal(new Set(s.channels.map(c=>c.id)).size,2);assert.equal(new Set(s.threads.map(t=>t.id)).size,2);
  await f.workspace.selectThread('th_same0000');await f.workspace.selectThread(f.other);
  assert.equal(f.workspace.snapshot('th_same0000').messages[0].text,'a content');
  assert.equal(f.workspace.snapshot(f.other).messages[0].text,'b content');
  assert.match(f.workspace.sessionLink(f.other),/second\.example\.test/);
  await f.workspace.getModelSettings('a'.repeat(24));await f.workspace.getModelSettings('b'.repeat(24));
  assert.deepEqual(f.a.calls,[['model-read','a']]);assert.deepEqual(f.b.calls,[['model-read','b']]);
  assert.equal(JSON.stringify(f.workspace.snapshot()).includes('fixture-only-private-token'),false);
});
test('draft records qualify UI IDs, retain raw IDs on disk and reject another account identity',async()=>{
  const f=fixture(),draft={text:'peer draft',attachments:[]};
  await f.workspace.saveLocalDraft('b'.repeat(24),f.other,draft);
  assert.deepEqual(f.records.get('b'.repeat(24)),{th_same0000:draft});
  assert.deepEqual(await f.workspace.loadLocalDrafts('b'.repeat(24)),{[f.other]:draft});
  await assert.rejects(f.workspace.saveLocalDraft('a'.repeat(24),f.other,draft),/another connection/);
  assert.equal(f.records.has('a'.repeat(24)),false);
});
test('removing one account clears only its credential, drafts and outbox and rejects stale UI IDs',async()=>{
  const f=fixture();await f.workspace.removeConnection('b'.repeat(24));
  assert.deepEqual(f.cleared,[['credential','b'],['outbox','b'.repeat(24)],['drafts','b'.repeat(24)]]);
  assert.equal(f.workspace.snapshot().connections.length,1);assert.equal(f.workspace.hasConnection('a'.repeat(24)),true);
  assert.equal(f.a.calls.length,0);assert.equal(f.workspace.snapshot().channels.length,1);
  await assert.rejects(f.workspace.selectThread(f.other),/unavailable/);
  await assert.rejects(f.workspace.getModelSettings('b'.repeat(24)),/unavailable/);
});
test('removing primary leaves the second account available and routes its action using raw Thread ID',async()=>{
  const f=fixture();await f.workspace.removeConnection('primary');await f.workspace.stopThread(f.other);
  assert.equal(f.workspace.snapshot().connectionKey,'b'.repeat(24));assert.equal(f.workspace.snapshot().connections.length,1);
  assert.deepEqual(f.b.calls,[['stop','th_same0000']]);
});
test('connection status is account-specific; blocked/offline account does not change another account',()=>{
  const f=fixture();f.b.service.connectionState='blocked';f.b.service.connectionIssue='Pair this device again.';
  let s=f.workspace.snapshot();assert.equal(s.connections[0].state,'online');assert.equal(s.connections[1].state,'blocked');
  assert.equal(s.connections[1].detail,'Pair this device again.');f.b.service.connectionState='retrying';
  s=f.workspace.snapshot();assert.equal(s.connections[0].state,'online');assert.equal(s.connections[1].state,'retrying');
});
test('invalid connection input cannot persist a slot or replace existing clients',async()=>{
  const f=fixture();for(const bad of [{...request,baseUrl:'http://unsafe.example'},{...request,baseUrl:'https://user:password@example.test'},{...request,code:'invalid'},{...request,deviceName:''}])await assert.rejects(f.workspace.addConnection(bad));
  assert.equal(f.writes.length,0);assert.equal(f.workspace.snapshot().connections.length,2);assert.equal(f.a.calls.length,0);assert.equal(f.b.calls.length,0);
});
test('failed list write cannot start pairing or create an in-memory connection',async()=>{
  const f=fixture();f.workspace.index.save=async()=>{throw Error('fixture write failure');};
  await assert.rejects(f.workspace.addConnection({...request,baseUrl:'https://third.example.test'}));
  assert.equal(f.workspace.snapshot().connections.length,2);
});
test('duplicate server address does not create another slot or exchange',async()=>{
  const f=fixture();await assert.rejects(f.workspace.addConnection(request),/already saved/);
  assert.equal(f.writes.length,0);assert.equal(f.workspace.snapshot().connections.length,2);
});
test('failed local cleanup retains a retryable identity and never clears a different account',async()=>{
  const f=fixture();let failed=true;
  f.b.service.outboxStore={async clear(id){if(failed){failed=false;throw Error('fixture cleanup failure');}f.cleared.push(['outbox',id]);}};
  f.records.set('a'.repeat(24),{th_same0000:{text:'primary preserved',attachments:[]}});
  await assert.rejects(f.workspace.removeConnection('b'.repeat(24)),/could not be completed/);
  assert.equal(f.writes.length,0);assert.equal(f.workspace.snapshot().connections[1].state,'blocked');
  await f.workspace.removeConnection('b'.repeat(24));
  assert.ok(f.cleared.some(([kind,id])=>kind==='drafts'&&id==='b'.repeat(24)));
  assert.equal(f.records.get('a'.repeat(24)).th_same0000.text,'primary preserved');
  assert.equal(f.b.service.forgettingId,undefined);
});
test('connection index read failure does not silently reset the list or permit overwriting it',async()=>{
  const f=fixture();f.workspace.ready=false;f.workspace.primary.initialize=async()=>{};
  f.workspace.index.load=async()=>{throw Error('fixture read failure');};await f.workspace.initialize();
  assert.match(f.workspace.snapshot().connectionsError,/could not be loaded/);
  await assert.rejects(f.workspace.addConnection({...request,baseUrl:'https://third.example.test'}),/unavailable/);
  await assert.rejects(f.workspace.removeConnection('primary'),/unavailable/);assert.equal(f.cleared.length,0);
});
