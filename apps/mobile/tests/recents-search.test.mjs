import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { quickLabels, recentRows, searchRecentRows } from '../src/recentRows.ts';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = Math.floor(Date.now() / 1000);
const client = (channels, threads, labels = true) => ({ isCatalogueReady: true, supportsSessionLabels: labels, channels: new Map(channels.map(c => [c.id, c])), threads: new Map(threads.map(t => [t.id, t])) });
const thread = (id, title, ago, markers = [], extra = {}) => ({ id, project_id: 'p', title, markers, last_message_at: now - ago, ...extra });
const sources = () => [
  { slot: 'primary', name: 'home', client: client([{ id: 'p', name: 'Research' }], [
    thread('a', 'Login crash', 60, ['bug', 'iOS']), thread('b', 'Slow sync', 9 * 86400, ['bug']),
    thread('c', 'Release notes', 120, ['docs', 'iOS']), thread('d', 'Urgent fix plan', 30 * 86400),
    thread('e', 'Payment flow', 40 * 86400, ['urgent', 'bug']), thread('gone', 'Archived bug', 1, ['bug'], { archived: true }),
    thread('auto', 'Nightly report', 10, ['report'], { origin: 'automation' })]) },
  { slot: 'w', name: 'work', client: client([{ id: 'p', name: 'Ops' }], [thread('z', 'Bug triage', 5, ['bug'])], false) },
];

test('search covers every listed Thread, not only the last 24 hours; labels are AND; archived Threads stay out', () => {
  const s = sources();
  assert.deepEqual(recentRows(s, now).map(r => r.id), ['z', 'a', 'c'], 'Recents itself still keeps the 24-hour rule');
  assert.deepEqual(searchRecentRows(s, { text: '', labels: ['bug'] }).map(r => r.key), ['primary:a', 'primary:b', 'primary:e']);
  assert.deepEqual(searchRecentRows(s, { text: '', labels: ['bug', 'iOS'] }).map(r => r.id), ['a']);
  assert.deepEqual(searchRecentRows(s, { text: 'bug', labels: [] }).map(r => r.key), ['primary:a', 'primary:b', 'primary:e', 'w:z'],
    'keyword matches label text and the title; an exact label ranks before a title prefix (desktop rule)');
  assert.deepEqual(searchRecentRows(s, { text: 'nightly', labels: [] }).map(r => r.id), ['auto'], 'automation Threads are searchable');
  assert.deepEqual(searchRecentRows(s, { text: 'zzz', labels: [] }), []);
  assert.deepEqual(searchRecentRows(s, { text: '', labels: ['bug'] }).find(r => r.id === 'a').markers, ['bug', 'iOS']);
});

test('quick labels: five most used across connections that support labels', () => {
  assert.deepEqual(quickLabels(sources()), ['bug', 'iOS', 'report', 'docs', 'urgent']);
  assert.deepEqual(quickLabels(sources(), 2), ['bug', 'iOS']);
  assert.deepEqual(quickLabels([{ slot: 'w', name: 'work', client: client([{ id: 'p', name: 'Ops' }], [thread('z', 'x', 5, ['bug'])], false) }]), [],
    'a connection without label support offers none');
});

// Production Recents tab with the real row and search logic; platform views are stand-ins.
const state = { connections: [], pushed: [], opened: [] };
globalThis.__recentsTest = state;
const mocks = {
  'react-native': `export const FlatList=p=>require('react').createElement('FlatList',p,(p.data.length?p.data.map((item,index)=>require('react').createElement(require('react').Fragment,{key:p.keyExtractor(item)},p.renderItem({item,index}))):p.ListEmptyComponent)); export const Pressable='Pressable',View='View'; export const StyleSheet={create:x=>x};`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'expo-router': `export const useRouter=()=>({push:p=>globalThis.__recentsTest.pushed.push(p)});`,
  'react-native-safe-area-context': `export const SafeAreaView='SafeAreaView'; export const useSafeAreaInsets=()=>({top:0,bottom:34,left:0,right:0});`,
  '../../App': `export const HeaderIcon='HeaderIcon',Notice='Notice'; export const useConnections=()=>({ready:true,connections:globalThis.__recentsTest.connections,revision:1,listError:''});`,
  '../../FontSize': `export const Text='Text',TextInput='TextInput';`,
  '../../MessageTime': `export const MessageTime='MessageTime';`,
  '../../TabHeader': `export const TabHeader=p=>require('react').createElement('TabHeader',null,p.children);`,
  '../../SessionLabels': `export const LabelPills='LabelPills';`,
  '../../sessionNavigation': `export const useSessionNavigation=()=>({threadOn:(slot,id)=>globalThis.__recentsTest.opened.push(slot+':'+id)});`,
};
const bundle = await build({ entryPoints: [new URL('../src/app/(tabs)/index.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: process.cwd() }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const Recents = mod.exports.default;

const cards = root => root.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel && n.props.onPress && n.props.accessibilityRole === 'button' && !/label|Clear/.test(n.props.accessibilityLabel)).map(n => n.props.accessibilityLabel.split(',')[0]);
const quick = root => root.root.findAll(n => n.type === 'Pressable' && /label .* from search$|^Search label /.test(n.props.accessibilityLabel ?? ''));
const press = async node => act(async () => { node.props.onPress(); });

test('Recents tab: search box and quick label filter search every Thread; a second tap and Clear restore Recents', async () => {
  state.connections = sources();
  let root; await act(async () => { root = create(React.createElement(Recents)); });
  try {
    assert.deepEqual(cards(root), ['Bug triage', 'Login crash', 'Release notes']);
    assert.deepEqual(quick(root).map(n => n.props.accessibilityLabel), ['Search label bug', 'Search label iOS', 'Search label report', 'Search label docs', 'Search label urgent']);
    assert.equal(root.root.findAll(n => n.props.accessibilityLabel === 'Clear search').length, 0);
    await press(quick(root)[0]);
    assert.deepEqual(cards(root), ['Login crash', 'Slow sync', 'Payment flow'], 'label search reaches older Threads');
    assert.equal(quick(root)[0].props.accessibilityState.selected, true);
    assert.equal(quick(root)[0].props.accessibilityLabel, 'Remove label bug from search');
    await press(quick(root)[1]);
    assert.deepEqual(cards(root), ['Login crash'], 'two labels: AND');
    await press(quick(root)[1]); await press(quick(root)[0]);
    assert.deepEqual(cards(root), ['Bug triage', 'Login crash', 'Release notes'], 'second tap removes the label');
    const input = root.root.findByType('TextInput');
    assert.equal(input.props.accessibilityLabel, 'Search conversations');
    await act(async () => { input.props.onChangeText('payment'); });
    assert.deepEqual(cards(root), ['Payment flow']);
    await act(async () => { input.props.onChangeText('zzz'); });
    assert.ok(root.root.findAll(n => n.type === 'Text' && n.props.children === 'No matching conversations').length === 1);
    await press(root.root.find(n => n.props.accessibilityLabel === 'Clear search'));
    assert.equal(root.root.findByType('TextInput').props.value, '');
    assert.deepEqual(cards(root), ['Bug triage', 'Login crash', 'Release notes']);
    const pills = root.root.findAll(n => n.type === 'LabelPills').map(n => n.props.markers);
    assert.deepEqual(pills, [['bug', 'iOS'], ['docs', 'iOS']], 'cards show labels only from connections that support them');
    const list = root.root.findByType('FlatList');
    assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
  } finally { await act(async () => root.unmount()); }
});
