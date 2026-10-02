import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('upgrade retires only old server-history projection, preserving credentials and original-send store',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'live-desktop-retirement-'));
 try{
  await mkdir(join(folder,'conversation-cache'));await writeFile(join(folder,'conversation-cache','synthetic.sqlite'),'synthetic old projection');
  await writeFile(join(folder,'credentials.json'),'synthetic encrypted envelope');await writeFile(join(folder,'outbox.json'),'synthetic encrypted original');
  const result=await build({entryPoints:[new URL('../src/main/connection-service.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
  const localRequire=createRequire(import.meta.url),module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(name=>name==='electron'?{app:{getPath:()=>folder},dialog:{},shell:{}}:localRequire(name),module,module.exports);
  const service=new module.exports.DesktopConnectionService(()=>{});service.store={load:async()=>null};await service.initialize();
  await assert.rejects(access(join(folder,'conversation-cache')));assert.equal(await readFile(join(folder,'credentials.json'),'utf8'),'synthetic encrypted envelope');assert.equal(await readFile(join(folder,'outbox.json'),'utf8'),'synthetic encrypted original');assert.equal(service.snapshot().phase,'unpaired');service.close();
 }finally{await rm(folder,{recursive:true,force:true});}
});
