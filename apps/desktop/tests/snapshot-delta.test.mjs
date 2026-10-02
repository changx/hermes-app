import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const root=new URL('../../../',import.meta.url).pathname;
const bundle=await build({stdin:{resolveDir:root,contents:'export * from "./apps/desktop/src/shared/snapshot-delta"; export * from "./apps/desktop/src/renderer/desktop-store-core";'},bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {snapshotDelta,applySnapshotDelta,DesktopSnapshotStore}=mod.exports;
const row=(id,text=id)=>({id,role:'assistant',text,toolCalls:[],attachments:[]});
const base=()=>({revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'Project'}],threads:[{id:'a',channelId:'p',title:'A',unreadCount:0,running:false},{id:'b',channelId:'p',title:'B',unreadCount:0,running:false}],messages:[row('m1'),row('m2')],interactions:[],selectedThreadId:'a',selectedChannelId:'p',canLoadOlder:false});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('sidebar update sends only changed session row and retains all message identities',()=>{
  const before=base(),after=structuredClone(before);after.revision=2;after.threads[1].running=true;after.threads[1].unreadCount=4;
  const patch=snapshotDelta(before,after);assert.equal(patch.messages,undefined);assert.equal(patch.channels,undefined);
  assert.deepEqual(patch.threads.upserts,[after.threads[1]]);assert.equal(patch.threads.order,undefined);
  const result=applySnapshotDelta(before,structuredClone(patch));assert.equal(result.messages,before.messages);
  assert.equal(result.threads[0],before.threads[0]);assert.notEqual(result.threads[1],before.threads[1]);
});

test('same-ID edit changes exactly one message; append, prepend and removal retain unaffected rows',()=>{
  let before=base();const edited=structuredClone(before);edited.revision=2;edited.messages[0].text='edited';
  let patch=snapshotDelta(before,edited);assert.equal(patch.messages.upserts.length,1);
  let next=applySnapshotDelta(before,patch);assert.notEqual(next.messages[0],before.messages[0]);assert.equal(next.messages[1],before.messages[1]);
  before=next;const expanded={...before,revision:3,messages:[row('old'),...before.messages,row('new')]};
  next=applySnapshotDelta(before,snapshotDelta(before,expanded));assert.equal(next.messages[1],before.messages[0]);assert.equal(next.messages[2],before.messages[1]);
  before=next;const shrunk={...before,revision:4,messages:before.messages.slice(1)};
  next=applySnapshotDelta(before,snapshotDelta(before,shrunk));assert.deepEqual(next,shrunk);assert.equal(next.messages[0],before.messages[1]);
});

test('selection delta clears previous session content, optional state and interactions exactly',()=>{
  const before={...base(),errorMessage:'old',interactions:[{id:'i',kind:'approval',prompt:'allow?',choices:['yes']}]};
  const after={...base(),revision:2,selectedThreadId:'b',messages:[row('b1')],interactions:[]};
  const result=applySnapshotDelta(before,snapshotDelta(before,after));assert.deepEqual(result,after);assert.equal(result.errorMessage,undefined);
  assert.throws(()=>applySnapshotDelta(before,{...snapshotDelta(before,after),baseRevision:0}),/gap/);
});

test('large history never crosses IPC for a status-only update',()=>{
  const before={...base(),messages:Array.from({length:1000},(_,i)=>row('m'+i,'large body '.repeat(100)))};
  const after={...before,revision:2,threads:before.threads.map(t=>t.id==='b'?{...t,running:true}:t)};
  const delta=snapshotDelta(before,after);assert.equal(delta.messages,undefined);
  assert.ok(JSON.stringify(delta).length<1500);assert.ok(JSON.stringify(after).length>1000000);
});

test('delta arriving before startup baseline is buffered and merged without a stale overwrite',async()=>{
  let listener,resolve;
  const before=base(),after={...before,revision:2,messages:[...before.messages,row('m3')]};
  const store=new DesktopSnapshotStore({subscribe(fn){listener=fn;return()=>{}},getSnapshot(){return new Promise(r=>resolve=r)}});
  const stop=store.subscribe(()=>{});listener(snapshotDelta(before,after));assert.equal(store.getSnapshot().revision,0);
  resolve(before);await tick();assert.deepEqual(store.getSnapshot(),after);stop();
});

test('an IPC gap obtains one fresh baseline; repeated deltas cannot create duplicate restore requests',async()=>{
  let listener,requests=0;const before=base();let baseline=before;
  const store=new DesktopSnapshotStore({subscribe(fn){listener=fn;return()=>{}},async getSnapshot(){requests++;return baseline}});
  const stop=store.subscribe(()=>{});await tick();
  const skipped={...before,revision:3,messages:[row('fresh')]},after={...skipped,revision:4};baseline=after;
  const delta=snapshotDelta(skipped,after);listener(delta);listener(delta);await tick();
  assert.equal(requests,2);assert.deepEqual(store.getSnapshot(),after);stop();
});

test('an unsubscribed startup read cannot overwrite a later subscription',async()=>{
  let resolve;let calls=0;
  const store=new DesktopSnapshotStore({subscribe(){return()=>{}},getSnapshot(){return ++calls===1?new Promise(r=>resolve=r):Promise.resolve({...base(),revision:3})}});
  const stop=store.subscribe(()=>{});stop();const next=store.subscribe(()=>{});await tick();resolve(base());await tick();
  assert.equal(store.getSnapshot().revision,3);next();
});
