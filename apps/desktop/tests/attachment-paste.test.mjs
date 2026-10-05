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
const compiled = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `export { DesktopShellView } from './src/renderer/shell'; export { NewSessionPage } from './src/renderer/new-session-page'; export { attachmentInputs, MAX_ATTACHMENT_BYTES } from './src/shared/attachment-input'; export { filesForUpload } from './src/preload/attachment-files'; export { DesktopConnectionService } from './src/main/connection-service';` }, bundle: true, format: 'cjs', platform: 'node', external: ['electron', 'react', 'react/jsx-runtime'], write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? {} : require(name), mod, mod.exports);
const { DesktopShellView, NewSessionPage, attachmentInputs, MAX_ATTACHMENT_BYTES, filesForUpload, DesktopConnectionService } = mod.exports;
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
    assert.equal(tree.root.findAllByProps({ className: 'composer-attachments' })[0].findAllByType('span').length, 2);
    assert.equal(await paste(tree, 'Message', Array.from({ length: 7 }, () => file())), true);
    assert.equal(calls.length, 1, 'reject remaining-capacity overflow before upload');
    assert.equal(await paste(tree, 'Message', [file('huge.png', MAX_ATTACHMENT_BYTES + 1)]), true);
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
  environment({ createThread: async () => { calls.push('create'); return 'created-paste'; }, uploadDroppedFiles: async (files, id) => { calls.push(['upload', files, id]); return [attachment('new-paste')]; }, sendMessage: async input => calls.push(['send', input]), completeNewTab: async () => calls.push('complete') });
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
  await assert.rejects(filesForUpload([file('huge', MAX_ATTACHMENT_BYTES + 1)], () => ''), /10 MiB/);
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
