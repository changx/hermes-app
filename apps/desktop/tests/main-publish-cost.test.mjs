import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin:{contents:"export * from './src/main/connections'; export { snapshotDelta } from './src/shared/snapshot-delta';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['electron'],write:false });
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='electron'?{app:{getPath:()=>tmpdir()},safeStorage:{}}:require(name),mod,mod.exports);
const {DesktopConnections,snapshotDelta}=mod.exports;

// The main process also delivers input to the pages: each server change must stay cheap there,
// or scrolling a long Session stalls while other Sessions run.
function fixture() {
  const workspace=new DesktopConnections(()=>{});
  workspace.ready=true;
  const install=(service,letter)=>{
    service.connection={id:letter.repeat(24),baseUrl:`https://${letter}.example.test`,token:'fixture-only-private-token'};
    service.phase='connected';service.connectionState='online';service.selectedChannelId='p';
    const rows=Array.from({length:50},(_,i)=>({id:`row${i}`,role:i%2?'assistant':'user',text:`text ${i}`,ref_seq:i+1,receipt_id:i%2?undefined:`r${i}`,tool_calls:[{id:`tool${i}`,name:'terminal',label:'Run',detail:'ls'}],attachments:[]}));
    const receipts=new Map(rows.filter(r=>r.receipt_id).map(r=>[r.receipt_id,{id:r.receipt_id,thread_id:'th_long',state:'completed',processing:'completed'}]));
    service.client={channels:new Map([['p',{id:'p',name:'Project'}]]),threads:new Map([['th_long',{id:'th_long',project_id:'p',title:'Long',last_message_at:1}]]),
      messages:new Map([['th_long',rows]]),receipts,attachments:new Map(),interactions:new Map(),isCatalogueReady:true,isThreadAvailable:id=>id==='th_long'};
    service.openPages=['th_long'];service.selectedThreadId='th_long';
    return {service,rows,receipts};
  };
  const a=install(workspace.primary,'a');
  const second=workspace.make('b'.repeat(24),'https://b.example.test');install(second.service,'b');
  return {workspace,a,key:'a'.repeat(24)};
}

test('unchanged message rows keep their identity, so a tab delta carries no rows', () => {
  const {workspace,a,key}=fixture();
  const first=workspace.snapshot('th_long',false,key), second=workspace.snapshot('th_long',false,key);
  assert.equal(first.messages.length,50);
  assert.ok(first.messages.every((row,i)=>row===second.messages[i]));
  assert.equal(snapshotDelta(first,second).messages,undefined);
  // A new receipt object (state change) projects that row again; the other rows stay identical.
  a.receipts.set('r0',{...a.receipts.get('r0'),state:'running',processing:'running'});
  const third=workspace.snapshot('th_long',false,key);
  assert.notEqual(third.messages[0],second.messages[0]);
  assert.equal(third.messages[0].receiptState,'running');
  assert.ok(third.messages.slice(1).every((row,i)=>row===second.messages[i+1]));
  assert.deepEqual(snapshotDelta(second,third).messages.upserts.map(row=>row.id),[third.messages[0].id]);
  // A replaced row object is projected again with its new content.
  a.rows[3]={...a.rows[3],text:'edited'};
  assert.equal(workspace.snapshot('th_long',false,key).messages[3].text,'edited');
});

test('connection status checks and catalogue projection skip Session messages', () => {
  const {workspace,a,key}=fixture();
  const pages=[];const original=a.service.snapshot.bind(a.service);
  a.service.snapshot=(pageId,...rest)=>{if(pageId!==null&&(pageId??a.service.selectedThreadId))pages.push(pageId??'selected');return original(pageId,...rest);};
  assert.equal(workspace.hasConnection(key),true);
  assert.equal(workspace.connectionForChannel(),key);
  assert.deepEqual(pages,[]);
  // One tab snapshot projects only that tab's Session once.
  workspace.snapshot('th_long',false,key);
  assert.deepEqual(pages,['th_long']);
  // Status keeps the snapshot values.
  const status=a.service.status(), full=original(undefined,false);
  for (const field of ['phase','connectionKey','connectionState','connectionName']) assert.equal(status[field],full[field]);
});
