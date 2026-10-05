import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const compiled = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `export * from './src/shared/browser-policy'; export { localPreview } from './src/main/local-preview'; export { DesktopConnectionService } from './src/main/connection-service';` }, bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });
const mod = { exports: {} }; new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? {} : require(name), mod, mod.exports);
const { chromeUserAgent, browserUrl, previewMime, previewResponse, localPreview, DesktopConnectionService } = mod.exports;
const bytes = value => new TextEncoder().encode(value);

test('browser uses reduced standard Chrome UA for real engine and platform, with no application markers', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const ua = chromeUserAgent(platform, '132.0.1234.56');
    assert.match(ua, /^Mozilla\/5.0 \(.+\) AppleWebKit\/537.36 \(KHTML, like Gecko\) Chrome\/132.0.0.0 Safari\/537.36$/);
    assert.doesNotMatch(ua, /Electron|Hermes/);
  }
  assert.match(chromeUserAgent('darwin', '132'), /Intel Mac OS X 10_15_7/);
  assert.throws(() => chromeUserAgent('linux', 'bad'));
});
test('web URL policy supports web addresses but denies privileged schemes and credential URLs', () => {
  assert.equal(browserUrl('example.com/a'), 'https://example.com/a');
  assert.equal(browserUrl('http://127.0.0.1:8000/page'), 'http://127.0.0.1:8000/page');
  for (const value of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,a', 'hermesapp://session/a', 'hermes-preview://test/a', 'https://user:pass@example.com', 'https://a\nb.com', 'a'.repeat(4097)]) assert.throws(() => browserUrl(value));
});
test('preview types include images, PDF and generated HTML; text is escaped and binary reports an explicit fallback', async () => {
  for (const [name, expected] of [['screenshot.png','image/png'],['document.pdf','application/pdf'],['page.html','text/html'],['source.js','text/javascript'],['notes.md','text/plain'],['style.css','text/css'],['font.woff2','font/woff2'],['vector.svg','application/octet-stream']]) assert.equal(previewMime(name,'application/octet-stream'),expected);
  const text = await previewResponse({ name: '<notes>.txt', mime: 'text/plain', bytes: bytes('<script>throw Error("unsafe")</script>') }).text();
  assert.match(text, /&lt;script&gt;/); assert.doesNotMatch(text, /<script>/);
  const html = '<!doctype html><script>document.title="Generated"</script>';
  const response = previewResponse({ name: 'page.html', mime: 'text/html', bytes: bytes(html) });
  assert.equal(await response.text(), html); assert.match(response.headers.get('Content-Security-Policy'), /object-src 'none'/);
  assert.match(await previewResponse({ name:'archive.zip', mime:'application/zip', bytes:bytes('binary fixture') }).text(), /cannot be previewed/);
  assert.throws(() => previewResponse({name:'large.txt',mime:'text/plain',bytes:new Uint8Array(10*1024*1024+1)}));
});
test('local preview reads a selected file or pathless clipboard bytes without uploading or reading sibling paths', async () => {
  const dir=await mkdtemp(join(tmpdir(),'sidebar-local-preview-'));
  try { const path=join(dir,'page.html');await writeFile(path,'<h1>local page</h1>');assert.equal(new TextDecoder().decode((await localPreview(path)).bytes),'<h1>local page</h1>');
    assert.equal((await localPreview({name:'paste.png',bytes:bytes('controlled bytes')})).name,'paste.png');
    await assert.rejects(localPreview(dir));await assert.rejects(localPreview('relative.html'));await assert.rejects(localPreview({name:'../secret',bytes:bytes('bad')}));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('attachment preview checks thread, identity, state, length and resource allowlist before opening', async () => {
  const service=new DesktopConnectionService(()=>{}), attachment={id:'a',thread_id:'thread',state:'available',name:'page.html',mime:'text/html',size:3};let downloads=0;
  const client={attachments:new Map([['a',attachment],['css',{...attachment,id:'css',name:'styles.css'}],['secret',{...attachment,id:'secret',name:'secret.txt'}],['other',{...attachment,id:'other',thread_id:'other',name:'other.js'}]]),isThreadAvailable:()=>true,getAttachment:async()=>attachment,download:async()=>{downloads++;return bytes('abc');}};
  service.client=client;service.phase='connected';service.connection={id:'test-identity'};
  assert.equal((await service.attachmentPreview('a','thread')).name,'page.html');assert.equal(downloads,1);
  assert.deepEqual(service.previewResources('thread'),[{id:'css',name:'styles.css'}]);
  await assert.rejects(service.attachmentPreview('a','other'));assert.equal(downloads,1);
  attachment.state='deleted';await assert.rejects(service.attachmentPreview('a','thread'));assert.equal(downloads,1);attachment.state='available';
  client.download=async()=>bytes('bad length');await assert.rejects(service.attachmentPreview('a','thread'));
  client.download=async()=>{service.client={};return bytes('abc');};await assert.rejects(service.attachmentPreview('a','thread'));
});
