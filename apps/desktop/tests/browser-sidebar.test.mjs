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
const { chromeUserAgent, browserUrl, previewMime, previewResponse, pdfViewerResource, byteRange, markdownPage, previewAssetType, localPreview, DesktopConnectionService } = mod.exports;
test('Markdown renders through the app renderer page: only the nonce script runs and file HTML stays text', async () => {
  const source = '# Title\n\n<script>alert(1)</script>\n\n</script><img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n| a |\n|---|\n| 1 |\n\n$E=mc^2$';
  const response = previewResponse({ name: 'notes.md', mime: 'text/markdown', bytes: bytes(source) });
  const html = await response.text(), csp = response.headers.get('content-security-policy');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  const key = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  assert.ok(key, csp); assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*'self'|script-src[^;]*https:/);
  assert.match(csp, /default-src 'none'/); assert.match(csp, /base-uri 'none'/);
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(match => match[0]);
  assert.deepEqual(scripts, ['<script type="application/json" id="hermes-markdown">', `<script nonce="${key}" src="/__hermes_preview__/markdown-preview.js">`]);
  const json = /<script type="application\/json" id="hermes-markdown">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(json), source, 'exact source, escaped so it cannot close the script element');
  assert.doesNotMatch(json, /</);
  assert.match(html, /&lt;script&gt;alert\(1\)/, 'fallback text is escaped');
  assert.notEqual(/nonce-([^']+)/.exec(previewResponse({ name: 'n.md', mime: 'text/markdown', bytes: bytes('a') }).headers.get('content-security-policy'))[1], key, 'fresh nonce per page');
  assert.equal(await previewResponse({ name: 'notes.md', mime: 'text/markdown', bytes: bytes('# raw') }, true).text(), '# raw');
  const large = await previewResponse({ name: 'big.md', mime: 'text/markdown', bytes: bytes('# big\n' + 'x'.repeat(1024 * 1024)) }).text();
  assert.match(large, /^<!doctype html><meta charset="utf-8"><title>big\.md<\/title>/); assert.doesNotMatch(large, /<script/);
  assert.equal(previewAssetType('markdown-preview.js'), 'text/javascript'); assert.equal(previewAssetType('fonts/KaTeX_Main-Regular.woff2'), 'font/woff2');
  for (const name of ['../main/index.cjs', 'index.js', 'fonts/../index.js', 'fonts/x.ttf', 'katex.css/..']) assert.equal(previewAssetType(name), undefined, name);
});
test('media bodies answer Range requests', async () => {
  const media = { name: 'clip.mp4', mime: 'video/mp4', bytes: bytes('0123456789') };
  const full = previewResponse(media);
  assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const part = previewResponse(media, false, 'bytes=2-5');
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await part.text(), '2345');
  assert.equal(await previewResponse(media, false, 'bytes=7-').text(), '789');
  assert.equal(await previewResponse(media, false, 'bytes=-3').text(), '789');
  assert.equal(previewResponse(media, false, 'bytes=20-').status, 416);
  assert.deepEqual(byteRange('bytes=0-99', 10), { start: 0, end: 9 });
  for (const bad of ['bytes=5-2', 'items=0-1', 'bytes=-', 'bytes=1-2,4-5']) assert.equal(byteRange(bad, 10), undefined);
});
test('chrome://resources is allowed only for subresources of the built-in PDF viewer frame', () => {
  const viewer = { url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' };
  assert.equal(pdfViewerResource({ url: 'chrome://resources/js/assert.js', resourceType: 'script', frame: viewer }), true);
  assert.equal(pdfViewerResource({ url: 'chrome://resources/css/text_defaults_md.css', resourceType: 'stylesheet', frame: viewer }), true);
  assert.equal(pdfViewerResource({ url: 'chrome://resources/js/assert.js', resourceType: 'script', frame: { url: 'https://example.com/' } }), false);
  assert.equal(pdfViewerResource({ url: 'chrome://resources/js/assert.js', resourceType: 'script', frame: null }), false);
  assert.equal(pdfViewerResource({ url: 'chrome://resources/js/assert.js', resourceType: 'script', frame: { get url() { throw new Error('destroyed'); } } }), false);
  assert.equal(pdfViewerResource({ url: 'chrome://resources/page.html', resourceType: 'subFrame', frame: viewer }), false);
  assert.equal(pdfViewerResource({ url: 'chrome://settings/', resourceType: 'script', frame: viewer }), false);
});
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
  for (const [name, expected] of [['screenshot.png','image/png'],['document.pdf','application/pdf'],['page.html','text/html'],['source.js','text/javascript'],['notes.md','text/markdown'],['clip.mov','video/mp4'],['song.mp3','audio/mpeg'],['voice.m4a','audio/mp4'],['style.css','text/css'],['font.woff2','font/woff2'],['vector.svg','application/octet-stream']]) assert.equal(previewMime(name,'application/octet-stream'),expected);
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
