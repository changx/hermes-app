import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { LocalDraftMap } from '../../../packages/client/src/localDraftMap.ts';
const require = createRequire(import.meta.url);
const { build } = require('../../../node_modules/esbuild');
const bundle = await build({ entryPoints: [new URL('../src/localDraftStorage.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['expo-file-system','expo-crypto'], write: false });
function harness(root) {
  let failure = false;
  const resolve = (...parts) => join(...parts.map(part => typeof part === 'string' ? part.startsWith('file:') ? fileURLToPath(part) : part : fileURLToPath(part.uri)));
  class File {
    constructor(...parts) { this.path = resolve(...parts); this.uri = pathToFileURL(this.path).href; this.name = this.path.split('/').at(-1); }
    get exists() { return fs.existsSync(this.path); }
    create() { if(failure)throw Error('disk full');fs.writeFileSync(this.path,''); }
    writeSync(data) { if(failure)throw Error('disk full');fs.writeFileSync(this.path,data); }
    textSync() { return fs.readFileSync(this.path,'utf8'); }
    copySync(target) { if(failure)throw Error('disk full');fs.copyFileSync(this.path,target.path); }
    delete() { fs.unlinkSync(this.path); }
  }
  class Directory {
    constructor(...parts) { this.path = resolve(...parts); this.uri = pathToFileURL(this.path).href; }
    create() { fs.mkdirSync(this.path,{recursive:true}); }
    list() { return fs.readdirSync(this.path).map(name=>new File(this,name)); }
  }
  const Paths = { document:new Directory(root,'documents'),cache:new Directory(root,'cache') }; Paths.document.create();Paths.cache.create();
  const mod={exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='expo-file-system'?{File,Directory,Paths}:name==='expo-crypto'?{randomUUID}:require(name),mod,mod.exports);
  const maps=()=>({texts:new LocalDraftMap(text=>!!text.trim()),attachments:new LocalDraftMap(draft=>draft.items.length>0)});
  return { ...mod.exports, maps, File, Paths, fail(value){failure=value;} };
}

test('disk-backed cold restore preserves exact text, whitespace, multiple connections and unopened draft badges',async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-drafts-'));
  try {
    const h=harness(root), a=h.maps();let errors=0;
    const stop=h.bindLocalDraftStorage(a.texts,a.attachments,()=>errors++);
    a.texts.set('connection-a:t','  中文\nfirst\r\n');a.texts.set('connection-a:t','  中文\nlatest\r\n');a.texts.set('connection-b:t','Other device identity');a.texts.set('connection-a:blank',' \n');stop();
    const b=h.maps();const stopB=h.bindLocalDraftStorage(b.texts,b.attachments,()=>errors++);
    assert.equal(b.texts.get('connection-a:t'),'  中文\nlatest\r\n');assert.equal(b.texts.get('connection-b:t'),'Other device identity');assert.equal(b.texts.get('connection-a:blank'),' \n');assert.ok(b.texts.hasDraft('connection-a:t'));assert.equal(b.texts.hasDraft('connection-a:blank'),false);
    b.texts.delete('connection-a:t');b.texts.clear();stopB();
    const c=h.maps();h.bindLocalDraftStorage(c.texts,c.attachments,()=>errors++);assert.equal(c.texts.size,0);assert.equal(errors,0);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('selected attachment bytes survive cache deletion and interrupted upload restores as retryable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-draft-files-'));
  try {
    const h=harness(root),a=h.maps();const stop=h.bindLocalDraftStorage(a.texts,a.attachments,()=>assert.fail('save failed'));
    const source=new h.File(h.Paths.cache,'picked');source.create();source.writeSync('real selected bytes');
    a.attachments.set('connection:t',{items:[{key:1,source:{uri:source.uri,name:'note.txt',size:19},status:'uploading'}],files:[[1,source]]});stop();source.delete();
    const b=h.maps();h.bindLocalDraftStorage(b.texts,b.attachments,()=>assert.fail('save failed'));
    const draft=b.attachments.get('connection:t');assert.ok(b.attachments.hasDraft('connection:t'));assert.equal(draft.items[0].status,'failed');assert.equal(new h.File(draft.items[0].source.uri).textSync(),'real selected bytes');assert.equal(draft.files.length,1);
    b.attachments.delete('connection:t');const c=h.maps();h.bindLocalDraftStorage(c.texts,c.attachments,()=>assert.fail());assert.equal(c.attachments.size,0);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('write failures retain in-memory input, report failure, and do not overwrite the last saved generation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-draft-failure-'));
  try {
    const h=harness(root),a=h.maps();let errors=0;const stop=h.bindLocalDraftStorage(a.texts,a.attachments,()=>errors++);
    a.texts.set('c:t','saved');h.fail(true);a.texts.set('c:t','not yet saved');assert.equal(a.texts.get('c:t'),'not yet saved');assert.equal(errors,1);stop();h.fail(false);
    const b=h.maps();h.bindLocalDraftStorage(b.texts,b.attachments,()=>assert.fail());assert.equal(b.texts.get('c:t'),'saved');
    const dir=join(root,'documents','hermes-local-drafts');for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.json')))fs.writeFileSync(join(dir,name),'broken');
    assert.throws(()=>h.bindLocalDraftStorage(h.maps().texts,h.maps().attachments,()=>{}),/draft storage/);
  } finally {await rm(root,{recursive:true,force:true});}
});
