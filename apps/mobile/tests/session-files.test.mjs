import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Production SessionFilesScreen; platform views and the preview are stand-ins.
const state = { viewers: [] };
globalThis.__sessionFilesTest = state;
const mocks = {
  'react-native': `const R=require('react'); export const View='View',Pressable='Pressable',ActivityIndicator='ActivityIndicator'; export const StyleSheet={create:x=>x};
    export const FlatList=p=>R.createElement('FlatList',p,...(p.data.length?p.data.map(item=>R.createElement(R.Fragment,{key:p.keyExtractor(item)},p.renderItem({item}))):[p.ListEmptyComponent]),p.ListFooterComponent);`,
  './FontSize': `export const Text='Text';`,
  './Viewers': `export const useViewer=()=>({openViewer:(title,content)=>globalThis.__sessionFilesTest.viewers.push({title,content})});`,
  './SessionFilePreview': `export const SessionFilePreview='SessionFilePreview';`,
  './WorkspaceUI': `const R=require('react'); export const WorkspaceAction=p=>R.createElement('Action',p); export const workspaceStyles=new Proxy({},{get:()=>({})});`,
};
const bundle = await build({ entryPoints: [new URL('../src/SessionFilesScreen.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { SessionFilesScreen } = mod.exports;

const file = (id, list, extra = {}) => ({ id, thread_id: 'th_1', name: id + '.pdf', mime: 'application/pdf', size: 2048, state: 'available', list, created_at: 1792000000, ref_seq: 4, ...extra });
const client = (calls, pages) => ({ connectionState: 'online', files: { list: async (thread, list, after) => {
  calls.push([thread, list, after]);
  const page = pages[`${list}:${after}`];
  if (page instanceof Error) throw page;
  return page;
} } });
const rows = root => root.root.findAll(n => n.type === 'Pressable').map(n => n.props.accessibilityLabel);
const actions = root => root.root.findAll(n => n.type === 'Action').map(n => [n.props.label, n.props.disabled]);
const texts = root => root.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));

test('Files tab lists delivered files; a missing file stays listed and cannot open; Load more appends', async () => {
  const calls = []; state.viewers = [];
  const c = client(calls, {
    'delivered:null': { items: [file('att_1', 'delivered', { caption: 'Q3 report' }), file('att_2', 'delivered', { state: 'missing' })], nextAfter: '1792000000:att_2' },
    'delivered:1792000000:att_2': { items: [file('att_3', 'delivered')], nextAfter: null },
  });
  let root; await act(async () => { root = create(React.createElement(SessionFilesScreen, { client: c, threadId: 'th_1' })); });
  try {
    assert.deepEqual(calls, [['th_1', 'delivered', null]]);
    assert.deepEqual(actions(root).slice(0, 2), [['Files', true], ['Attachments', false]], 'the current tab is disabled');
    assert.equal(rows(root).length, 2);
    assert.match(rows(root)[0], /^att_1\.pdf, 2\.0 KB · /);
    assert.equal(rows(root)[1], 'att_2.pdf, No longer available');
    assert.ok(texts(root).includes('Q3 report'));
    const missing = root.root.findAll(n => n.type === 'Pressable')[1];
    assert.equal(missing.props.disabled, true);
    await act(async () => { root.root.findAll(n => n.type === 'Pressable')[0].props.onPress(); });
    assert.equal(state.viewers.length, 1);
    assert.equal(state.viewers[0].title, 'att_1.pdf');
    assert.equal(state.viewers[0].content.props.refSeq, 4, 'the preview knows the source message');
    await act(async () => { root.root.find(n => n.type === 'Action' && n.props.label === 'Load more').props.onPress(); });
    assert.deepEqual(calls.at(-1), ['th_1', 'delivered', '1792000000:att_2']);
    assert.equal(rows(root).length, 3);
    assert.equal(root.root.findAll(n => n.type === 'Action' && n.props.label === 'Load more').length, 0);
  } finally { await act(async () => root.unmount()); }
});

test('Attachments tab has its own empty text; a failed load offers Try again', async () => {
  const calls = [];
  const pages = { 'delivered:null': new Error('offline'), 'uploaded:null': { items: [], nextAfter: null } };
  let root; await act(async () => { root = create(React.createElement(SessionFilesScreen, { client: client(calls, pages), threadId: 'th_1' })); });
  try {
    assert.ok(texts(root).includes('Could not load the files. Try again.'));
    pages['delivered:null'] = { items: [file('att_1', 'delivered')], nextAfter: null };
    await act(async () => { root.root.find(n => n.type === 'Action' && n.props.label === 'Try again').props.onPress(); });
    assert.equal(rows(root).length, 1);
    await act(async () => { root.root.find(n => n.type === 'Action' && n.props.label === 'Attachments').props.onPress(); });
    assert.deepEqual(calls.at(-1), ['th_1', 'uploaded', null]);
    assert.ok(texts(root).includes('You have not sent files in this session.'));
  } finally { await act(async () => root.unmount()); }
});
