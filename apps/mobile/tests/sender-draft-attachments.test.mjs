import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mocks = {
  'react-native': `export const Image='Image',Pressable='Pressable',ScrollView='ScrollView',View='View',Linking={}; export const Platform={OS:'android'}; export const StyleSheet={create:x=>x};`,
  './FontSize': `export const Text='Text';`,
  'expo-image-picker': 'export {};', 'expo-document-picker': 'export {};', 'expo-clipboard': 'export {};',
  'expo-file-system': 'export class File {}',
  'expo-router': 'export const useIsFocused=()=>true;',
  './Viewers': 'export const useViewer=()=>({openViewer(){}});',
  './FilePreview': `export const ImageViewer='ImageViewer';`,
  './AttachmentGallery': `export const AttachmentGallery='AttachmentGallery';`,
  './ComposerCard': `import React from 'react'; export const ComposerCard=props=>React.createElement('ComposerCard',props,props.children,props.leading,props.send);`,
  './attachmentFiles': 'export const attachmentSlot=async()=>()=>{},forgetFile=()=>{},ownedFile=x=>x,progressLabel=()=>"",uploadSource=async()=>{};',
};
const bundle = await build({ entryPoints: [new URL('../src/Attachments.tsx', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['react'], write: false,
  plugins: [{ name: 'native-boundary', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }] });
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { AttachmentComposer } = mod.exports;
const attachment = id => ({ id, thread_id: 't', name: `${id}.txt`, mime: 'text/plain', size: 4, state: 'available', receipt_id: null });

test('rejected-send attachments return to the empty composer once, with no upload, send or deletion', async () => {
  const saved = [attachment('att_saved')], changes = [], calls = [];
  const props = { client: { deleteUnattached: async () => calls.push('delete') }, threadId: 't', clearKey: 0,
    onChange: (items, busy) => changes.push({ items, busy }), onPasteText() {}, restoredAttachments: saved };
  let root;
  await act(async () => { root = create(React.createElement(AttachmentComposer, props)); });
  try {
    assert.deepEqual(changes.at(-1), { items: saved, busy: false });
    assert.ok(root.root.findAllByType('Text').some(n => n.children.join('') === 'att_saved.txt'));
    await act(async () => root.update(React.createElement(AttachmentComposer, { ...props, clearKey: 1 })));
    assert.deepEqual(changes.at(-1), { items: [], busy: false });
    await act(async () => root.update(React.createElement(AttachmentComposer, { ...props, clearKey: 1, disabled: true })));
    assert.deepEqual(changes.at(-1), { items: [], busy: false }, 'ordinary updates do not resurrect a cleared draft');
    assert.deepEqual(calls, []);
  } finally { await act(async () => root.unmount()); }
  assert.deepEqual(calls, []);
});

test('restoring a rejected send never replaces newer selected attachments', async () => {
  const newer = attachment('att_newer'), changes = [];
  const props = { client: {}, threadId: 't', clearKey: 0, onChange: items => changes.push(items), onPasteText() {},
    initialDraft: { items: [{ key: 1, status: 'ready', source: { name: newer.name }, attachment: newer }], files: [] }, restoredAttachments: [attachment('att_old')] };
  let root;
  await act(async () => { root = create(React.createElement(AttachmentComposer, props)); });
  try { assert.deepEqual(changes.at(-1), [newer]); }
  finally { await act(async () => root.unmount()); }
});
