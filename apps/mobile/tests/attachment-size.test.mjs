import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { appDownloadLimit, browserDownloadUrl, chooseAttachments, MAX_ATTACHMENT_BYTES, MAX_FILE_ATTACHMENT_BYTES, MAX_THUMBNAIL_BYTES, tooLargeForApp } from '../src/attachmentHelpers.ts';
import { validSendContent } from '../src/send.ts';
const require = createRequire(import.meta.url);
const { build } = require('../../../node_modules/esbuild');
const MiB = 1024 * 1024;

// fs-backed stand-in for the expo-file-system File API used by attachmentFiles.ts and transport.ts.
const root = mkdtempSync(join(tmpdir(), 'attachment-size-'));
const toPath = part => typeof part === 'string' ? part.startsWith('file:') ? fileURLToPath(part) : part : part.path;
const uploads = [], downloads = [];
class File {
  constructor(...parts) { this.path = join(...parts.map(toPath)); this.uri = pathToFileURL(this.path).href; }
  get exists() { return fs.existsSync(this.path); }
  get size() { return this.exists ? fs.statSync(this.path).size : 0; }
  create() { fs.writeFileSync(this.path, ''); }
  writeSync(data) { fs.writeFileSync(this.path, data); }
  delete() { fs.unlinkSync(this.path); }
  async bytes() { return new Uint8Array(fs.readFileSync(this.path)); }
  open() { const fd = fs.openSync(this.path, 'r'); return { offset: 0, readBytesSync(n) { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, this.offset); this.offset += r; return new Uint8Array(b.subarray(0, r)); }, close() { fs.closeSync(fd); } }; }
  async upload(url, options) { uploads.push({ url, options, size: this.size }); return { status: 201, body: JSON.stringify({ attachment: { id: 'att_x', thread_id: 'T', name: 'big.mp4', mime: 'video/mp4', size: this.size } }), headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '3' } }; }
  static async downloadFileAsync(url, target, options) { downloads.push({ url, options }); fs.writeFileSync(target.path, Buffer.from('%PDF-1.7 rest')); return target; }
}
const Paths = { cache: { path: root, uri: pathToFileURL(root).href } };
const withNative = { FileSystemUploadTask: function FileSystemUploadTask() {}, downloadFileAsync: async () => '' };
const load = async (entry, native = withNative) => {
  const bundle = await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['expo-file-system', 'expo'], write: false });
  const mod = { exports: {} };
  const modules = { 'expo-file-system': { File, Paths, UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 } }, 'expo': { requireOptionalNativeModule: name => name === 'FileSystem' ? native : null } };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => modules[name] ?? require(name), mod, mod.exports);
  return mod.exports;
};
const { uploadSource, AttachmentFiles, progressLabel } = await load('../src/attachmentFiles.ts');
const { nativeTransport } = await load('../src/transport.ts');
const legacyTransport = (await load('../src/transport.ts', null)).nativeTransport;
const sparse = (name, size) => { const path = join(root, name); fs.writeFileSync(path, ''); fs.truncateSync(path, size); return pathToFileURL(path).href; };

test('picked files go up to 2 GB; pasted bytes keep the 100 MB single-request limit', () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 100 * MiB); assert.equal(MAX_FILE_ATTACHMENT_BYTES, 2048 * MiB);
  assert.equal(chooseAttachments(0, [{ uri: 'file:///a', name: 'a.mp4', size: MAX_FILE_ATTACHMENT_BYTES }]).accepted.length, 1);
  const over = chooseAttachments(0, [{ uri: 'file:///b', name: 'b.mp4', size: MAX_FILE_ATTACHMENT_BYTES + 1 }]);
  assert.equal(over.accepted.length, 0); assert.match(over.error, /over 2 GB/);
  assert.equal(chooseAttachments(0, [{ name: 'p.png', data: { byteLength: MAX_ATTACHMENT_BYTES + 1 } }]).accepted.length, 0);
  const item = size => ({ id: 'att_a', thread_id: 'T', state: 'available', receipt_id: null, name: 'a.mp4', mime: 'video/mp4', size });
  assert.equal(validSendContent('T', '', [item(MAX_FILE_ATTACHMENT_BYTES)]).length, 1);
  assert.throws(() => validSendContent('T', '', [item(MAX_FILE_ATTACHMENT_BYTES + 1)]), /invalid/);
});

test('a picked file above 100 MB uploads in chunks read at the right offsets', async () => {
  const signal = new AbortController().signal;
  const path = join(root, 'big.mov'), size = MAX_ATTACHMENT_BYTES + 5;
  const fd = fs.openSync(path, 'w'); fs.writeSync(fd, Buffer.from('head'), 0, 4, 0); fs.writeSync(fd, Buffer.from('tail!'), 0, 5, size - 5); fs.closeSync(fd);
  const uri = pathToFileURL(path).href, reads = [];
  const client = { supportsFileTransfer: true, supportsChunkedUpload: true, uploadMaxBytes: MAX_FILE_ATTACHMENT_BYTES,
    async uploadFile() { throw Error('a large file must not use the single upload'); },
    async uploadChunked(thread, name, total, read, s) {
      reads.push([thread, name, total, s === signal]);
      const first = await read(0, 4), last = await read(total - 5, 5);
      reads.push(Buffer.from(first).toString(), Buffer.from(last).toString());
      return { id: 'att_c' };
    } };
  assert.deepEqual(await uploadSource(client, 'T', { uri, name: 'big.mov' }, signal, () => false), { id: 'att_c' });
  assert.deepEqual(reads, [['T', 'big.mov', size, true], 'head', 'tail!']);
  // A server without chunked uploads refuses the file before any upload.
  await assert.rejects(uploadSource({ ...client, supportsChunkedUpload: false }, 'T', { uri, name: 'big.mov' }, signal, () => false), /invalid size/);
  assert.equal(await uploadSource(client, 'T', { uri, name: 'late.mov' }, signal, () => true), undefined);
});

test('a picked file uploads through the native file path with its real size; pasted bytes still upload as bytes', async () => {
  const calls = [];
  const client = { supportsFileTransfer: true,
    async uploadFile(thread, name, file) { calls.push(['file', thread, name, file]); return { id: 'att_f' }; },
    async upload(thread, name, bytes) { calls.push(['bytes', thread, name, bytes.byteLength]); return { id: 'att_b' }; } };
  const signal = new AbortController().signal;
  const uri = sparse('full.mp4', MAX_ATTACHMENT_BYTES);
  assert.deepEqual(await uploadSource(client, 'T', { uri, name: 'full.mp4', size: 1 }, signal, () => false), { id: 'att_f' });
  assert.deepEqual(calls.pop(), ['file', 'T', 'full.mp4', { uri, size: MAX_ATTACHMENT_BYTES }]);
  await assert.rejects(uploadSource(client, 'T', { uri: sparse('over.mp4', MAX_ATTACHMENT_BYTES + 1), name: 'over.mp4' }, signal, () => false), /invalid size/, 'no chunked upload support');
  assert.equal(await uploadSource(client, 'T', { uri, name: 'late.mp4' }, signal, () => true), undefined);
  assert.equal(calls.length, 0);
  assert.deepEqual(await uploadSource(client, 'T', { name: 'p.png', data: new Uint8Array(3) }, signal, () => false), { id: 'att_b' });
  assert.deepEqual(calls.pop(), ['bytes', 'T', 'p.png', 3]);
  // A client without file transfer keeps the byte path.
  const legacy = { ...client, supportsFileTransfer: false };
  const small = sparse('small.txt', 5);
  await uploadSource(legacy, 'T', { uri: small, name: 'small.txt' }, signal, () => false);
  assert.deepEqual(calls.pop(), ['bytes', 'T', 'small.txt', 5]);
});

test('a message attachment downloads straight into a cache file and keeps the PDF signature check', async () => {
  let memoryReads = 0;
  const written = new Map();
  const client = { supportsFileTransfer: true, async download() { memoryReads++; return new Uint8Array(); },
    async downloadFile(_thread, id, destination) { const bytes = written.get(id); fs.writeFileSync(fileURLToPath(destination), bytes); return bytes.length; } };
  const files = new AttachmentFiles(client, 'T');
  written.set('att_pdf', Buffer.from('%PDF-1.7 body'));
  const pdf = await files.load({ id: 'att_pdf', thread_id: 'T', state: 'available', name: 'r.pdf', mime: 'application/pdf', size: 13 });
  assert.equal(pdf.kind, 'pdf'); assert.ok(fs.existsSync(fileURLToPath(pdf.uri)));
  written.set('att_fake', Buffer.from('not a pdf'));
  assert.equal((await files.load({ id: 'att_fake', thread_id: 'T', state: 'available', name: 'f.pdf', mime: 'application/pdf', size: 9 })).kind, 'other');
  written.set('att_short', Buffer.from('abc'));
  await assert.rejects(files.load({ id: 'att_short', thread_id: 'T', state: 'available', name: 's.bin', size: 4 }), /invalid body/);
  await assert.rejects(files.load({ id: 'att_big', thread_id: 'T', state: 'available', name: 'b.bin', size: MAX_FILE_ATTACHMENT_BYTES + 1 }), /too large/);
  const bytesOnly = new AttachmentFiles({ ...client, supportsFileTransfer: false }, 'T');
  await assert.rejects(bytesOnly.load({ id: 'att_mid', thread_id: 'T', state: 'available', name: 'm.bin', size: MAX_ATTACHMENT_BYTES + 1 }), /too large/);
  assert.equal(appDownloadLimit(true), MAX_FILE_ATTACHMENT_BYTES); assert.equal(appDownloadLimit(false), MAX_ATTACHMENT_BYTES);
  assert.equal(memoryReads, 0);
  const cached = fs.readdirSync(root).filter(name => name.startsWith('hermes-attachment-'));
  assert.equal(cached.length, 2, 'the failed download leaves no cache file');
  files.dispose();
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('hermes-attachment-')).length, 0);
  assert.equal(MAX_THUMBNAIL_BYTES, 10 * MiB);
});

test('the native transport uploads and downloads files with authentication and parses the reply', async () => {
  const http = nativeTransport('https://agent.example').http;
  const uri = sparse('clip.mp4', 7);
  const reply = await http.uploadFile('/v1/threads/T/attachments', 'tok', 'clip 1.mp4', { uri, size: 7 });
  assert.equal(reply.status, 201); assert.equal(reply.body.attachment.size, 7); assert.equal(reply.retryAfterMs, 3000);
  const sent = uploads.pop();
  assert.equal(sent.url, 'https://agent.example/v1/threads/T/attachments');
  assert.equal(sent.options.httpMethod, 'POST'); assert.equal(sent.options.uploadType, 0); assert.equal(sent.options.sessionType, 'foreground');
  assert.deepEqual(sent.options.headers, { Authorization: 'Bearer tok', 'X-File-Name': 'clip%201.mp4', 'X-File-Name-Encoding': 'percent-utf8', 'Content-Type': 'application/octet-stream' });
  await assert.rejects(http.uploadFile('/x', 'tok', 'clip.mp4', { uri, size: 8 }), /100 MiB/);
  await assert.rejects(http.uploadFile('/x', 'tok', '../clip.mp4', { uri, size: 7 }), /Invalid attachment name/);
  const target = pathToFileURL(join(root, 'out.pdf')).href;
  assert.deepEqual(await http.downloadFile('/v1/threads/T/attachments/att_1', 'tok', target), { status: 200, size: 13 });
  const got = downloads.pop();
  assert.equal(got.url, 'https://agent.example/v1/threads/T/attachments/att_1');
  assert.deepEqual(got.options.headers, { Authorization: 'Bearer tok', 'Accept-Encoding': 'identity' });
  assert.equal(got.options.idempotent, true);
});

test('an app without native file tasks keeps the byte path', () => {
  const http = legacyTransport('https://agent.example').http;
  assert.equal(http.uploadFile, undefined); assert.equal(http.downloadFile, undefined);
  assert.equal(typeof http.upload, 'function'); assert.equal(typeof http.download, 'function');
  assert.equal(typeof nativeTransport('https://agent.example').http.uploadFile, 'function');
});

test('Agent files above the app download limit open their public link in the browser', () => {
  const link = 'https://agent.tuly.space/media/att_' + '0'.repeat(32) + '/dataset.zip';
  assert.equal(tooLargeForApp({ size: MAX_ATTACHMENT_BYTES }), false);
  assert.equal(tooLargeForApp({ size: MAX_ATTACHMENT_BYTES + 1 }), true);
  assert.equal(tooLargeForApp({}), false);
  assert.equal(browserDownloadUrl({ size: MAX_ATTACHMENT_BYTES, public_url: link }), undefined, 'files the app can hold still open in the app');
  assert.equal(browserDownloadUrl({ size: 2 * 1024 * MiB, public_url: link }), link);
  assert.equal(browserDownloadUrl({ size: 2 * 1024 * MiB }), undefined);
  const source = fs.readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('const open = (attachment: Attachment)'), source.indexOf('return <View style={styles.root}>{attachments.map'));
  assert.match(open, /if \(tooLargeForApp\(attachment, limit\)\) \{[\s\S]*Linking\.openURL\(url\)[\s\S]*return;\s*\}/, 'a large file never starts an in-app download');
  assert.ok(open.indexOf('tooLargeForApp(attachment, limit)') < open.indexOf('gallerySequence('), 'checked before the gallery opens');
  assert.match(open, /filter\(item => item\.id === attachment\.id \|\| \(!tooLargeForApp\(item, limit\) && !attachmentPageUrl\(server, item\)\)\)/, 'the gallery skips files it cannot load and web pages');
  assert.match(source, /Large file\. Tap to download in your browser/);
});

test('an in-app download reports progress to listeners and clears it when done', async () => {
  const seen = []; let finish;
  const client = { supportsFileTransfer: true, async download() { throw Error('no memory reads'); },
    downloadFile(_thread, _id, destination, _signal, onProgress) {
      return new Promise(resolve => { finish = () => { onProgress(150 * MiB, 150 * MiB); fs.writeFileSync(fileURLToPath(destination), Buffer.from('%PDF-1.7 big')); resolve(12); }; onProgress(67 * MiB, 150 * MiB); }); } };
  const files = new AttachmentFiles(client, 'T');
  const stop = files.onProgress(() => seen.push(files.downloadProgress('att_big')));
  const loading = files.load({ id: 'att_big', thread_id: 'T', state: 'available', name: 'big.pdf', mime: 'application/pdf' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(seen[0], { received: 0, total: undefined }, 'the first notice arrives at once');
  assert.deepEqual(files.downloadProgress('att_big'), { received: 67 * MiB, total: undefined });
  finish(); await loading;
  assert.equal(files.downloadProgress('att_big'), undefined, 'progress clears when the file is ready');
  assert.equal(seen.at(-1), undefined, 'listeners hear the clear');
  stop(); files.dispose();
  assert.equal(progressLabel({ received: 67 * MiB, total: 150 * MiB }), '44% · 67 of 150 MB');
  assert.equal(progressLabel({ received: 3.5 * MiB }), '3.5 MB');
  // Expo SDK 58 on iOS reports native Int64 progress as BigInt.
  assert.equal(progressLabel({ received: 388864n, total: 777728 }), '50% · 0.4 of 0.7 MB');
  assert.equal(progressLabel({ received: 67n * BigInt(MiB), total: 150n * BigInt(MiB) }), '44% · 67 of 150 MB');
  const source = fs.readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
  assert.match(source, /downloading \? `Downloading… \$\{progressLabel\(downloading\)\}`/);
  assert.match(fs.readFileSync(new URL('../src/AttachmentGallery.tsx', import.meta.url), 'utf8'), /Downloading… \$\{progress\}/);
});

test('a published HTML attachment opens its web page on this connection, not the bare file', () => {
  const source = fs.readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('const open = (attachment: Attachment)'), source.indexOf('return <View style={styles.root}>{attachments.map'));
  assert.match(open, /const page = attachmentPageUrl\(server, attachment\);\s*if \(page\) \{[\s\S]*Linking\.openURL\(page\)[\s\S]*return;\s*\}/, 'a page opens in the browser');
  assert.ok(open.indexOf('attachmentPageUrl(server, attachment)') < open.indexOf('tooLargeForApp(attachment, limit)'), 'before any download path');
  assert.ok(open.indexOf('attachmentPageUrl(server, attachment)') < open.indexOf('gallerySequence('), 'before the gallery opens');
  assert.match(source, /Web page\. Tap to open in your browser/);
  assert.match(source, /Could not open the page\. Tap to retry/);
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<MessageAttachments files=\{attachmentFiles\} attachments=\{row\.attachments\} gallery=\{gallery\} server=\{config\?\.baseUrl\} \/>/, 'the page joins the connection server');
  assert.match(app, /\[attachmentFiles, gallery, config\?\.baseUrl\]\);/, 'rows redraw when the server changes');
});
