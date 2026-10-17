import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `export { DesktopShellView } from './src/renderer/shell'; export { NewSessionPage } from './src/renderer/new-session-page'; export { attachmentInputs, MAX_ATTACHMENT_BYTES } from './src/shared/attachment-input'; export { filesForUpload } from './src/preload/attachment-files'; export { namePastedFiles, pastedFileName } from './src/renderer/pasted-files'; export { DesktopConnectionService } from './src/main/connection-service';` }, bundle: true, format: 'cjs', platform: 'node', external: ['electron', 'react', 'react/jsx-runtime'], write: false });
const electron = {};
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? electron : require(name), mod, mod.exports);
const { DesktopShellView, NewSessionPage, attachmentInputs, MAX_ATTACHMENT_BYTES, filesForUpload, DesktopConnectionService, namePastedFiles, pastedFileName } = mod.exports;
const snapshot = { revision: 1, phase: 'connected', connectionState: 'online', channels: [{ id: 'p', name: 'Project' }], threads: [], messages: [], interactions: [], canLoadOlder: false };
const file = (name = 'image.png', size = 3) => ({ name, size, arrayBuffer: async () => new Uint8Array(size).fill(7).buffer });
const attachment = (id, name = 'image.png') => ({ id, name, mime: 'image/png', size: 3, state: 'available' });
function environment(api = {}) {
  globalThis.window = { hermesDesktop: api, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  globalThis.document = { activeElement: null };
}
async function mount(Component, props) { let tree; await act(async () => { tree = create(React.createElement(Component, props)); }); return tree; }
async function paste(tree, label, files) {
  let prevented = false;
  await act(async () => tree.root.findByProps({ 'aria-label': label }).props.onPaste({ clipboardData: { files }, preventDefault() { prevented = true; } }));
  return prevented;
}
test('composer paste uploads into exact session draft, retains text and never sends; plain text keeps browser default', async () => {
  const calls = [], id = 'paste-session';
  environment({ uploadDroppedFiles: async (files, target) => { calls.push([files, target]); return files.map((f, i) => attachment('paste-' + i, f.name)); }, sendMessage: async input => calls.push(input), deleteUnattachedAttachment: async () => {} });
  const tree = await mount(DesktopShellView, { snapshot: { ...snapshot, selectedThreadId: id } });
  try {
    await act(async () => tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: 'Keep this draft' } }));
    assert.equal(await paste(tree, 'Message', []), false);
    assert.equal(calls.length, 0);
    const files = [file(), file('notes.txt')];
    assert.equal(await paste(tree, 'Message', files), true);
    assert.deepEqual(calls, [[files, id]]);
    assert.equal(tree.root.findByProps({ 'aria-label': 'Message' }).props.value, 'Keep this draft');
    assert.equal(tree.root.findAllByProps({ className: 'composer-attachments' })[0].findAllByProps({ className: 'composer-attachment' }).length, 2);
    assert.equal(await paste(tree, 'Message', Array.from({ length: 7 }, () => file())), true);
    assert.equal(calls.length, 1, 'reject remaining-capacity overflow before upload');
    assert.equal(await paste(tree, 'Message', [file('huge.mov', 2 * 1024 ** 3 + 1)]), true);
    assert.equal(calls.length, 1);
    await act(async () => tree.root.findByProps({ 'aria-label': 'Send message' }).props.onClick());
    assert.deepEqual(calls[1], { text: 'Keep this draft', attachmentIds: ['paste-0', 'paste-1'] });
  } finally { await act(async () => tree.unmount()); }
});
test('failed paste keeps draft and offers error; duplicate paste while busy starts no second upload', async () => {
  let reject, count = 0;
  environment({ uploadDroppedFiles: () => { count++; return new Promise((_, fail) => { reject = fail; }); } });
  const tree = await mount(DesktopShellView, { snapshot: { ...snapshot, selectedThreadId: 'paste-failure' } });
  try {
    await act(async () => tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: 'Preserve me' } }));
    await paste(tree, 'Message', [file()]); await paste(tree, 'Message', [file()]);
    assert.equal(count, 1);
    await act(async () => reject(Error('Controlled failure')));
    assert.match(tree.root.findByProps({ role: 'alert' }).children.join(''), /could not be uploaded/);
    assert.equal(tree.root.findByProps({ 'aria-label': 'Message' }).props.value, 'Preserve me');
  } finally { await act(async () => tree.unmount()); }
});
test('new chat paste stays local until submit, then uploads and sends using returned session', async () => {
  const calls = [];
  environment({ getSnapshot: async () => snapshot, createThread: async () => { calls.push('create'); return 'created-paste'; }, uploadDroppedFiles: async (files, id) => { calls.push(['upload', files, id]); return [attachment('new-paste')]; }, sendMessage: async input => calls.push(['send', input]), completeNewTab: async () => calls.push('complete') });
  const tree = await mount(NewSessionPage, { snapshot });
  try {
    assert.equal(await paste(tree, 'First message', []), false);
    const files = [file()]; assert.equal(await paste(tree, 'First message', files), true);
    assert.deepEqual(calls, []);
    assert.equal(tree.root.findAllByType('li').length, 1);
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls.slice(0, 2), ['create', ['upload', files, 'created-paste']]);
    assert.equal(calls[2][1].text, ''); assert.deepEqual(calls[2][1].attachmentIds, ['new-paste']);
    assert.equal(calls[3], 'complete');
  } finally { await act(async () => tree.unmount()); }
});
test('preload keeps disk files as paths and converts pathless clipboard files to exact bytes', async () => {
  const disk = file('disk.txt'), image = file();
  disk.arrayBuffer = () => { throw Error('Do not read disk-backed bytes in preload'); };
  const result = await filesForUpload([disk, image], f => f === disk ? '/fixture/disk.txt' : '');
  assert.equal(result[0], '/fixture/disk.txt'); assert.deepEqual(result[1], { name: 'image.png', bytes: new Uint8Array([7, 7, 7]) });
  await assert.rejects(filesForUpload(Array(9).fill(image), () => ''), /eight/);
  await assert.rejects(filesForUpload([file('huge', MAX_ATTACHMENT_BYTES + 1)], () => ''), /Pasted files can be up to 100 MB/);
  const bigDisk = file('big.mov', MAX_ATTACHMENT_BYTES + 1);
  bigDisk.arrayBuffer = () => { throw Error('Do not read disk-backed bytes in preload'); };
  assert.deepEqual(await filesForUpload([bigDisk], () => '/fixture/big.mov'), ['/fixture/big.mov'], 'disk files above 100 MB go by path');
  await assert.rejects(filesForUpload([file('too.mov', 2 * 1024 ** 3 + 1)], () => '/fixture/too.mov'), /2 GB/);
});
test('main rejects malformed names, counts and bytes before upload', () => {
  for (const value of [null, Array(9).fill('/fixture/file'), [''], [{ name: '../image', bytes: new Uint8Array([1]) }], [{ name: 'a\n', bytes: new Uint8Array([1]) }], [{ name: 'a', bytes: [1] }], [{ name: 'a', bytes: new Uint8Array() }], [{ name: 'a', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }]]) assert.throws(() => attachmentInputs(value));
  assert.equal(attachmentInputs([{ name: 'image.png', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES) }]).length, 1);
});
test('service uploads mixed clipboard bytes and disk files to explicit target; partial failure cleans uploaded files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'paste-service-'));
  const service = new DesktopConnectionService(() => {}), calls = [];
  const client = { isThreadAvailable: id => id === 'target', upload: async (id, name, bytes) => { calls.push(['upload', id, name, [...bytes]]); return { ...attachment('uploaded-' + calls.length, name), thread_id: id }; }, deleteUnattached: async (id, attachmentId) => calls.push(['delete', id, attachmentId]) };
  service.client = client; service.connection = {}; service.phase = 'connected'; service.changed = () => {}; service.selectedThreadId = 'wrong';
  try {
    const path = join(folder, 'notes.txt'); await writeFile(path, 'notes');
    const result = await service.uploadAttachmentInputs([{ name: 'image.png', bytes: new Uint8Array([1, 2, 3]) }, path], 'target');
    assert.equal(result.length, 2); assert.equal(calls[0][1], 'target'); assert.deepEqual(calls[0][3], [1, 2, 3]); assert.equal(calls[1][2], 'notes.txt');
    calls.length = 0;
    const upload = client.upload; client.upload = async (...args) => { if (calls.length) throw Error('Controlled second upload failure'); return upload(...args); };
    await assert.rejects(service.uploadAttachmentInputs([{ name: 'one.png', bytes: new Uint8Array([1]) }, { name: 'two.png', bytes: new Uint8Array([2]) }], 'target'), /not confirmed/);
    assert.deepEqual(calls[1], ['delete', 'target', 'uploaded-1']);
    calls.length = 0;
    await assert.rejects(service.uploadAttachmentInputs([{ name: 'bad/name', bytes: new Uint8Array([1]) }], 'target'));
    assert.equal(calls.length, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('service uploads a disk file above the old 10 MiB limit and rejects one over 100 MiB before any upload', async () => {
  const { truncate } = await import('node:fs/promises');
  const folder = await mkdtemp(join(tmpdir(), 'size-service-'));
  const service = new DesktopConnectionService(() => {}), calls = [];
  const client = { isThreadAvailable: id => id === 'target', upload: async (id, name, bytes) => { calls.push([name, bytes.byteLength]); return { ...attachment('big-' + calls.length, name), thread_id: id }; }, deleteUnattached: async () => {} };
  service.client = client; service.connection = {}; service.phase = 'connected'; service.changed = () => {};
  try {
    assert.equal(MAX_ATTACHMENT_BYTES, 100 * 1024 * 1024);
    const medium = join(folder, 'clip.mp4'); await writeFile(medium, ''); await truncate(medium, 11 * 1024 * 1024);
    const full = join(folder, 'full.mp4'); await writeFile(full, ''); await truncate(full, MAX_ATTACHMENT_BYTES);
    const over = join(folder, 'over.mp4'); await writeFile(over, ''); await truncate(over, MAX_ATTACHMENT_BYTES + 1);
    assert.equal((await service.uploadAttachmentInputs([medium, full], 'target')).length, 2);
    assert.deepEqual(calls, [['clip.mp4', 11 * 1024 * 1024], ['full.mp4', MAX_ATTACHMENT_BYTES]]);
    calls.length = 0;
    await assert.rejects(service.uploadAttachmentInputs([medium, over], 'target'), /100 MiB/);
    assert.equal(calls.length, 0, 'every file is checked before the first upload');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

const clipboardFile = (name = 'image.png', type = 'image/png') => new File([new Uint8Array([7, 7, 7])], name, { type });
test('pasted files without a disk path get generated names; Finder files keep theirs', () => {
  const now = new Date(2026, 9, 16, 14, 3, 22);
  const disk = clipboardFile('Quarterly report.pdf', 'application/pdf');
  const named = namePastedFiles([clipboardFile(), clipboardFile(), disk, clipboardFile('image', 'image/jpeg'), clipboardFile('blob', '')],
    ['Pasted 2026-10-16 14.03.22.png'], now, f => f === disk);
  assert.deepEqual(named.map(f => f.name), ['Pasted 2026-10-16 14.03.22 2.png', 'Pasted 2026-10-16 14.03.22 3.png', 'Quarterly report.pdf', 'Pasted 2026-10-16 14.03.22.jpg', 'Pasted 2026-10-16 14.03.22']);
  assert.equal(named[2], disk, 'a disk file keeps its object, so preload still sends its path');
  assert.equal(named[0].type, 'image/png'); assert.equal(named[0].size, 3);
  assert.deepEqual(attachmentInputs(named.filter(f => f !== disk).map(f => ({ name: f.name, bytes: new Uint8Array([1]) }))).length, 4, 'generated names pass main validation');
  assert.equal(pastedFileName(clipboardFile('shot.PNG'), now, new Set()), 'Pasted 2026-10-16 14.03.22.png');
  const plain = [clipboardFile()];
  assert.equal(namePastedFiles(plain, [], now, undefined)[0], plain[0], 'an older preload without isDiskFile leaves files unchanged');
});
test('both composers name pasted screenshots before upload and before the New chat list', async () => {
  const calls = [];
  environment({ isDiskFile: () => false, uploadDroppedFiles: async (files, target) => { calls.push(files.map(f => f.name)); return files.map((f, i) => attachment('named-' + calls.length + '-' + i, f.name)); }, deleteUnattachedAttachment: async () => {} });
  const tree = await mount(DesktopShellView, { snapshot: { ...snapshot, selectedThreadId: 'named' } });
  try {
    await paste(tree, 'Message', [clipboardFile(), clipboardFile()]);
    await paste(tree, 'Message', [clipboardFile()]);
    assert.equal(calls.length, 2);
    assert.match(calls[0][0], /^Pasted \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    assert.notEqual(calls[0][0], calls[0][1]);
    assert.ok(!calls[0].includes(calls[1][0]), 'a later paste does not reuse a name already in the draft');
    await paste(tree, 'Message', [new File([new Uint8Array(1)], 'image.png', { type: 'image/png' })].map(f => Object.defineProperty(f, 'size', { value: MAX_ATTACHMENT_BYTES + 1 })));
    assert.equal(calls.length, 2, 'pasted bytes above 100 MB are refused before upload; disk files may be larger');
  } finally { await act(async () => tree.unmount()); }
  environment({ isDiskFile: () => false, getSnapshot: async () => snapshot });
  const page = await mount(NewSessionPage, { snapshot });
  try {
    await paste(page, 'First message', [clipboardFile()]);
    const shown = page.root.findAllByProps({ className: 'session-file-name' }).map(n => n.children.join(''));
    assert.equal(shown.length, 1); assert.match(shown[0], /^Pasted .*\.png$/);
  } finally { await act(async () => page.unmount()); }
});
test('Save streams the attachment to disk through downloadFile, never through in-memory download', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'save-service-'));
  const service = new DesktopConnectionService(() => {}), calls = [], big = 150 * 1024 * 1024;
  const item = { id: 'att-big', thread_id: 't', name: 'dataset.zip', mime: 'application/zip', size: big, state: 'available' };
  const client = { attachments: new Map([[item.id, item]]),
    download: async () => { throw Error('Save must not read the file into memory'); },
    downloadFile: async (thread, id, destination, _signal, onProgress) => { calls.push([thread, id, destination]); await writeFile(destination, 'x'); const { truncate } = await import('node:fs/promises'); await truncate(destination, big); onProgress?.(big / 2); onProgress?.(big); return big; } };
  service.client = client; service.connection = {}; service.phase = 'connected'; service.changed = () => {};
  const target = join(folder, 'dataset.zip');
  electron.dialog = { showSaveDialog: async () => ({ canceled: false, filePath: target }) };
  try {
    const progress = [];
    await service.downloadAttachment('att-big', 'save', 't', (received, total) => progress.push([received, total]));
    const { stat, readdir } = await import('node:fs/promises');
    assert.equal((await stat(target)).size, big);
    assert.equal(calls.length, 1); assert.match(calls[0][2], /\/\.dataset\.zip\.[0-9a-f]{8}\.partial$/, 'the incomplete file is hidden in Finder');
    assert.deepEqual(progress, [[0, big], [big / 2, big], [big, big]]);
    assert.deepEqual(await readdir(folder), ['dataset.zip']);
    item.size = big + 1;
    await assert.rejects(service.downloadAttachment('att-big', 'save', 't'), /incomplete/);
    assert.deepEqual(await readdir(folder), ['dataset.zip'], 'a size mismatch leaves no partial file');
  } finally { delete electron.dialog; await rm(folder, { recursive: true, force: true }); }
});

test('service uploads a disk file above 100 MiB in chunks from disk, one chunk at a time', async () => {
  const { truncate, open: openFile } = await import('node:fs/promises');
  const folder = await mkdtemp(join(tmpdir(), 'chunk-service-'));
  const service = new DesktopConnectionService(() => {}), calls = [];
  const size = MAX_ATTACHMENT_BYTES + 3;
  const client = { isThreadAvailable: id => id === 'target', supportsChunkedUpload: true, uploadMaxBytes: 2 * 1024 ** 3,
    upload: async (id, name, bytes) => { calls.push(['single', name, bytes.byteLength]); return { ...attachment('small', name), thread_id: id }; },
    uploadChunked: async (id, name, total, read) => {
      const head = await read(0, 4), tail = await read(total - 3, 3);
      calls.push(['chunked', id, name, total, Buffer.from(head).toString(), Buffer.from(tail).toString()]);
      return { id: 'att_big', thread_id: id, name, mime: 'video/quicktime', size: total, state: 'available' };
    }, deleteUnattached: async () => {} };
  service.client = client; service.connection = {}; service.phase = 'connected'; service.changed = () => {};
  try {
    const big = join(folder, 'big.mov'); await writeFile(big, 'head'); await truncate(big, size);
    const handle = await openFile(big, 'r+'); await handle.write(Buffer.from('end'), 0, 3, size - 3); await handle.close();
    const small = join(folder, 'small.txt'); await writeFile(small, 'notes');
    const result = await service.uploadAttachmentInputs([small, big], 'target');
    assert.deepEqual(result.map(a => a.id), ['small', 'att_big']);
    assert.deepEqual(calls, [['single', 'small.txt', 5], ['chunked', 'target', 'big.mov', size, 'head', 'end']]);
    // Without server support the large file is refused before any upload.
    calls.length = 0; client.supportsChunkedUpload = false;
    await assert.rejects(service.uploadAttachmentInputs([small, big], 'target'), /100 MiB/);
    assert.equal(calls.length, 0);
    client.supportsChunkedUpload = true;
    const over = join(folder, 'over.mov'); await writeFile(over, ''); await truncate(over, 2 * 1024 ** 3 + 1);
    await assert.rejects(service.uploadAttachmentInputs([over], 'target'), /2 GB/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
