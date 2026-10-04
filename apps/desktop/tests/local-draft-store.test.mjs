import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/main/local-draft-store.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
function store(directory,available=true) {
  const electron={app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>available,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}};
  const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='electron'?electron:require(name),mod,mod.exports);
  return new mod.exports.LocalDraftStore();
}
const a='abcdef0123456789abcdef01',b='1234567890abcdef12345678';
const file={id:'att_one',name:'note.txt',mime:'text/plain',size:4,state:'available'};
test('local drafts restore from real disk with exact text and uploaded attachment selections; isolated by connection',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'desktop-drafts-'));
  try {
    const s=store(directory);await Promise.all([s.put(a,'t',{text:'  first\r\n',attachments:[]}),s.put(a,'t',{text:'  latest 中文\r\n',attachments:[file]}),s.put(b,'t',{text:'separate',attachments:[]})]);
    const restored=store(directory);assert.deepEqual(await restored.list(a),{t:{text:'  latest 中文\r\n',attachments:[file]}});assert.equal((await restored.list(b)).t.text,'separate');
    assert.ok(!(await readFile(join(directory,'drafts.secure.json'),'utf8')).includes('latest'));
    await restored.put(a,'t',{text:' \n',attachments:[]});assert.equal((await store(directory).list(a)).t.text,' \n');
    await restored.put(a,'t',{text:'',attachments:[]});assert.deepEqual(await store(directory).list(a),{});assert.ok((await restored.list(b)).t);
    await restored.clear(b);assert.deepEqual(await store(directory).list(b),{});
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('invalid requests, unavailable secure storage and corrupted local files never become empty successful restores',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'desktop-drafts-fail-'));
  try {
    const s=store(directory);assert.throws(()=>s.put(a,'__proto__',{text:'x',attachments:[]}));assert.throws(()=>s.put(a,'t',{text:'x',attachments:[{...file,id:'invalid'}]}));
    await assert.rejects(store(directory,false).put(a,'t',{text:'x',attachments:[]}));
    await s.put(a,'t',{text:'safe',attachments:[]});await assert.rejects(store(directory,false).list(a));
    await writeFile(join(directory,'drafts.secure.json'),'broken');await assert.rejects(s.list(a));await assert.rejects(s.put(a,'t',{text:'new',attachments:[]}));assert.equal(await readFile(join(directory,'drafts.secure.json'),'utf8'),'broken');
  } finally {await rm(directory,{recursive:true,force:true});}
});
