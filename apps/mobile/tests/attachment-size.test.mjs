import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chooseAttachments, MAX_ATTACHMENT_BYTES, MAX_THUMBNAIL_BYTES } from '../src/attachmentHelpers.ts';
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
  write(data) { fs.writeFileSync(this.path, data); }
  delete() { fs.unlinkSync(this.path); }
  async bytes() { return new Uint8Array(fs.readFileSync(this.path)); }
  open() { const fd = fs.openSync(this.path, 'r'); return { readBytes(n) { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return new Uint8Array(b.subarray(0, r)); }, close() { fs.closeSync(fd); } }; }
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
const { uploadSource, AttachmentFiles } = await load('../src/attachmentFiles.ts');
const { nativeTransport } = await load('../src/transport.ts');
const legacyTransport = (await load('../src/transport.ts', null)).nativeTransport;
const sparse = (name, size) => { const path = join(root, name); fs.writeFileSync(path, ''); fs.truncateSync(path, size); return pathToFileURL(path).href; };

test('the attachment limit is 100 MiB in the picker and the send check', () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 100 * MiB);
  assert.equal(chooseAttachments(0, [{ uri: 'file:///a', name: 'a.mp4', size: MAX_ATTACHMENT_BYTES }]).accepted.length, 1);
  const over = chooseAttachments(0, [{ uri: 'file:///b', name: 'b.mp4', size: MAX_ATTACHMENT_BYTES + 1 }]);
  assert.equal(over.accepted.length, 0); assert.match(over.error, /over 100 MB/);
  const item = size => ({ id: 'att_a', thread_id: 'T', state: 'available', receipt_id: null, name: 'a.mp4', mime: 'video/mp4', size });
  assert.equal(validSendContent('T', '', [item(MAX_ATTACHMENT_BYTES)]).length, 1);
  assert.throws(() => validSendContent('T', '', [item(MAX_ATTACHMENT_BYTES + 1)]), /invalid/);
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
  await assert.rejects(uploadSource(client, 'T', { uri: sparse('over.mp4', MAX_ATTACHMENT_BYTES + 1), name: 'over.mp4' }, signal, () => false), /invalid size/);
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
  await assert.rejects(files.load({ id: 'att_big', thread_id: 'T', state: 'available', name: 'b.bin', size: MAX_ATTACHMENT_BYTES + 1 }), /too large/);
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
