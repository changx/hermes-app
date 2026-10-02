import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../../../',import.meta.url).pathname;
const bundle=await build({stdin:{resolveDir:root,contents:'export * from "./apps/desktop/src/main/sqlite-cache"; export * from "./apps/desktop/src/main/projection-cache-worker"; export {HermesClient} from "./packages/client/src/index";'},bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {SQLiteProjectionCache,ProjectionCacheWorker,HermesClient}=mod.exports;
const identity='a'.repeat(24),other='b'.repeat(24);
const message=n=>({id:'m'+n,ref_seq:n,role:'assistant',text:'synthetic '+n});
const checkpoint=()=>({schema:1,cursor:'c1',lastEventId:1,channels:[{id:'p',name:'P'}],threads:[{id:'a',project_id:'p',title:'A',archived:0,last_ref:3,read_ref:0,unread_count:3}],receipts:[],interactions:[],attachments:[],messages:[['a',[message(1),message(3),message(5)]]],versions:[['message:a:5',1]],fetchSequence:1,entitySequence:[],messageSequence:[['a:5',1]],knownEmptyThreads:[]});
const client=()=>new HermesClient({token:()=> 'SYNTHETIC_CREDENTIAL_NOT_IN_CACHE',http:{request(){throw Error('unused')}},socket:{connect(){throw Error('unused')}}});
const disk=async()=>{const dir=await mkdtemp(join(tmpdir(),'core-dataflow-sqlite-'));return {dir,path:join(dir,'cache.sqlite'),cleanup:()=>rm(dir,{recursive:true,force:true})}};

test('SQLite cold reopen restores entities and exact cursor; latest/older windows honor sparse refs',async()=>{
  const files=await disk();let cache;
  try{
    cache=new SQLiteProjectionCache(files.path,identity);const value=checkpoint();cache.save(value);cache.close();
    cache=new SQLiteProjectionCache(files.path,identity);const restored=cache.load();
    assert.deepEqual(restored,value);assert.deepEqual(cache.history('a',undefined,2).map(m=>m.ref_seq),[3,5]);
    assert.deepEqual(cache.history('a',5,2).map(m=>m.ref_seq),[1,3]);assert.deepEqual(cache.history('foreign'),[]);
    const c=client();c.restoreCheckpoint(restored);assert.equal(c.cursor,'c1');assert.equal(c.messages.get('a').length,3);
    assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_CREDENTIAL/);
  }finally{cache?.close();await files.cleanup()}
});

test('SQLite only updates changed rows and deletes removed entities in the checkpoint transaction',async()=>{
  const files=await disk();const cache=new SQLiteProjectionCache(files.path,identity);
  try{
    const first=checkpoint();assert.deepEqual(cache.save(first),{changed:5,removed:0});assert.deepEqual(cache.save(first),{changed:0,removed:0});
    const second=structuredClone(first);second.cursor='c2';second.lastEventId=2;second.messages[0][1][0].text='edited';
    assert.deepEqual(cache.save(second),{changed:1,removed:0});
    second.messages[0][1].shift();assert.deepEqual(cache.save(second),{changed:0,removed:1});assert.equal(cache.load().cursor,'c2');
  }finally{cache.close();await files.cleanup()}
});

test('SQL constraint failure rolls back BOTH entity modifications and cursor; retry remains valid',async()=>{
  const files=await disk();const cache=new SQLiteProjectionCache(files.path,identity);
  try{
    const first=checkpoint();cache.save(first);
    const broken=structuredClone(first);broken.cursor='c2';broken.lastEventId=2;broken.channels[0].name='must rollback';
    broken.messages[0][1].push({...message(7),id:'m1'});
    assert.throws(()=>cache.save(broken));assert.deepEqual(cache.load(),first);
    const valid=structuredClone(first);valid.cursor='c2';valid.lastEventId=2;valid.messages[0][1].push(message(7));cache.save(valid);
    assert.equal(cache.load().cursor,'c2');assert.equal(cache.history('a').length,4);
  }finally{cache.close();await files.cleanup()}
});

test('cache refuses foreign connection identity; clear removes only disposable projection',async()=>{
  const files=await disk();const cache=new SQLiteProjectionCache(files.path,identity);
  try{cache.save(checkpoint());assert.throws(()=>new SQLiteProjectionCache(files.path,other),/Foreign/);cache.clear();assert.equal(cache.load(),null);assert.deepEqual(cache.history('a'),[])}
  finally{cache.close();await files.cleanup()}
});

test('real worker saves, cold reads and closes SQLite outside main loop; file permissions stay private',async()=>{
  const files=await disk();const workerPath=new URL('../dist/main/cache-worker.cjs',import.meta.url).pathname;
  const worker=new ProjectionCacheWorker(files.path,identity,workerPath);
  try{
    assert.equal(await worker.load(),null);await worker.save(checkpoint());assert.deepEqual(await worker.load(),checkpoint());
    const broken=checkpoint();broken.cursor='must-not-commit';broken.messages[0][1].push({...message(7),id:'m1'});
    await assert.rejects(worker.save(broken),{name:'CacheStorageError'});assert.equal((await worker.load()).cursor,'c1');
    assert.deepEqual((await worker.history('a',5)).map(m=>m.ref_seq),[1,3]);
    assert.equal((await stat(files.path)).mode & 0o777,0o600);
    const bytes=await readFile(files.path);assert.doesNotMatch(bytes.toString('utf8'),/SYNTHETIC_CREDENTIAL/);
    await worker.clear();assert.equal(await worker.load(),null);
  }finally{await worker.close();await files.cleanup()}
  await assert.rejects(worker.load(),/closed/);
});

test('SDK replay and real SQLite worker survive process-local cold reopen and continue from the saved cursor',async()=>{
  const files=await disk(),workerPath=new URL('../dist/main/cache-worker.cjs',import.meta.url).pathname;
  let worker=new ProjectionCacheWorker(files.path,identity,workerPath),n=1;
  const make=()=>new HermesClient({token:()=> 'SYNTHETIC_CREDENTIAL_NOT_IN_CACHE',onCheckpoint:async value=>{await worker.save(value)},http:{async request(_method,path){
    if(path.startsWith('/v1/sync'))return {status:200,body:{events:[{event_id:n,cursor:'c'+n,kind:'message',thread_id:'a',ref:String(n),version:1}],waterline:'c'+n,next_cursor:'c'+n,has_more:false}};
    if(path.startsWith('/v1/snapshot'))return {status:200,body:{threads:[],next_after:null}};
    return {status:200,body:{messages:[message(n)],older_cursor:null,next_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
  }},socket:{connect(){throw Error('unused')}}});
  try{
    const first=make();first.cursor='c0';first.supportsLatest=true;await first.catchUp();assert.equal(first.cursor,'c1');await worker.close();
    worker=new ProjectionCacheWorker(files.path,identity,workerPath);const saved=await worker.load();assert.equal(saved.cursor,'c1');
    const second=make();second.restoreCheckpoint(saved);second.supportsLatest=true;n=2;await second.catchUp();
    assert.equal(second.cursor,'c2');assert.deepEqual(second.messages.get('a').map(m=>m.ref_seq),[1,2]);
    assert.deepEqual((await worker.history('a')).map(m=>m.ref_seq),[1,2]);assert.equal((await worker.load()).cursor,'c2');
  }finally{await worker.close();await files.cleanup()}
});

test('restore validates all cache ranks and identities before touching a fresh client',()=>{
  for(const breakCache of [x=>x.schema=2,x=>x.messages[0][1].push(message(1)),x=>x.messageSequence.push(['a:9',99]),x=>x.receipts.push({id:'invalid'})]) {
    const c=client(),value=checkpoint();breakCache(value);assert.throws(()=>c.restoreCheckpoint(value));assert.equal(c.cursor,null);assert.equal(c.channels.size,0);assert.equal(c.messages.size,0);
  }
  const c=client();c.restoreCheckpoint(checkpoint());assert.throws(()=>c.restoreCheckpoint(checkpoint()),/initialized/);
});
