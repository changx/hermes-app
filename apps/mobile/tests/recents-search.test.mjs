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

test('search covers every listed Thread, not only the last 72 hours; labels are AND; archived Threads stay out', () => {
  const s = sources();
  assert.deepEqual(recentRows(s, now).map(r => r.id), ['z', 'a', 'c'], 'Recents itself still keeps the 72-hour rule');
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
const state = { connections: [], pushed: [], opened: [], alerts: [], prompts: [] };
globalThis.__recentsTest = state;
const mocks = {
  'react-native': `export const FlatList=p=>require('react').createElement('FlatList',p,(p.data.length?p.data.map((item,index)=>require('react').createElement(require('react').Fragment,{key:p.keyExtractor(item)},p.renderItem({item,index}))):p.ListEmptyComponent)); export const Pressable='Pressable',View='View'; export const StyleSheet={create:x=>x};
    export const Platform={OS:'ios'}; export const Alert={alert:(title,message,buttons)=>globalThis.__recentsTest.alerts.push({title,buttons}),prompt:(title,message,buttons,type,value)=>globalThis.__recentsTest.prompts.push({title,buttons,value})};`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'expo-router': `export const useRouter=()=>({push:p=>globalThis.__recentsTest.pushed.push(p)});`,
  'react-native-safe-area-context': `export const SafeAreaView='SafeAreaView'; export const useSafeAreaInsets=()=>({top:0,bottom:34,left:0,right:0});`,
  '../../App': `export const HeaderIcon='HeaderIcon',Notice='Notice'; export const useConnections=()=>({ready:true,connections:globalThis.__recentsTest.connections,revision:1,listError:''});`,
  './App': `export const labelsRoute=(connection,threadId)=>({pathname:'/threads/[threadId]/labels',params:{threadId,connection}});`,
  '../../FontSize': `export const Text='Text',TextInput='TextInput';`,
  '../../MessageTime': `export const MessageTime='MessageTime';`,
  '../../TabHeader': `export const TabHeader=p=>require('react').createElement('TabHeader',null,p.children);`,
  '../../TodoFlag': `export const TodoFlag='TodoFlag';`,
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
    assert.equal(root.root.findAll(n => n.type === 'LabelPills').length, 0, 'cards no longer show labels');
    assert.equal(root.root.findAll(n => n.type === 'TodoFlag').length, 0, 'no todo flag without a todo label');
    const list = root.root.findByType('FlatList');
    assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
  } finally { await act(async () => root.unmount()); }
});

test('Recents tab: Todo section above Recent lists every flagged Thread, running first; rows show only the flag', async () => {
  const base = sources();
  base[0].client.threads.set('t-old', thread('t-old', 'Old todo', 20 * 86400, ['bug', 'TODO']));
  base[0].client.threads.set('t-run', thread('t-run', 'Running todo', 50 * 86400, ['todo'], { running: true }));
  base[0].client.threads.set('t-new', thread('t-new', 'Fresh todo', 30, ['todo']));
  // A connection without label support never shows a flag.
  base[1].client.threads.set('t-off', thread('t-off', 'No labels here', 40, ['todo']));
  state.connections = base;
  let root; await act(async () => { root = create(React.createElement(Recents)); });
  try {
    const list = root.root.findByType('FlatList'), keys = list.props.data.map(item => item.key);
    assert.deepEqual(keys.slice(0, 4), ['section:todo', 'todo:primary:t-run', 'todo:primary:t-new', 'todo:primary:t-old'], 'running first, then newest; any age; any case');
    assert.equal(keys[4], 'section:recent');
    assert.deepEqual(keys.slice(5), ['recent:primary:t-run', 'recent:w:z', 'recent:primary:t-new', 'recent:w:t-off', 'recent:primary:a', 'recent:primary:c'],
      'Recent keeps the 72-hour rule with running first; todo Threads stay in it too');
    const headers = root.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'header').map(n => n.props.children);
    assert.deepEqual(headers, ['Todo', 'Recent']);
    assert.equal(root.root.findAll(n => n.type === 'TodoFlag').length, 5, 'three Todo rows plus two of them again in Recent; none for the connection without labels');
    assert.ok(cards(root).includes('Old todo'));
    assert.ok(root.root.findAll(n => n.props.accessibilityLabel === 'Old todo, Research · home, Todo').length === 1);
    assert.deepEqual(quick(root).map(n => n.props.accessibilityLabel).filter(l => /todo/i.test(l)), [], 'the flag is not a quick label');
    await act(async () => { root.root.findByType('TextInput').props.onChangeText('fresh'); });
    assert.deepEqual(root.root.findByType('FlatList').props.data.map(item => item.key), ['search:primary:t-new'], 'a search shows one result list, no sections');
  } finally { await act(async () => root.unmount()); }
});

test('Recents tab: long press opens the Session menu; each action runs on the row\'s own connection', async () => {
  const base = sources(), calls = [];
  const home = base[0].client, work = base[1].client;
  home.saveThreadLabels = async (id, markers) => { calls.push(['labels', id, markers]); home.threads.set(id, { ...home.threads.get(id), markers }); return { markers }; };
  home.updateThread = async (id, patch) => { calls.push(['rename', id, patch.title]); };
  home.archiveThread = async id => { calls.push(['archive', 'home', id]); };
  work.archiveThread = async id => { calls.push(['archive', 'work', id]); };
  state.connections = base; state.alerts = []; state.prompts = []; state.pushed = [];
  let root; await act(async () => { root = create(React.createElement(Recents)); });
  const row = title => root.root.find(n => n.type === 'Pressable' && n.props.onLongPress && (n.props.accessibilityLabel ?? '').startsWith(title + ','));
  const button = (alert, text) => alert.buttons.find(b => b.text === text);
  try {
    await act(async () => { row('Login crash').props.onLongPress(); });
    const menu = state.alerts.at(-1);
    assert.equal(menu.title, 'Login crash');
    assert.deepEqual(menu.buttons.map(b => b.text), ['Mark as todo', 'Rename session', 'Edit labels', 'Archive session', 'Cancel']);
    await act(async () => { button(menu, 'Mark as todo').onPress(); });
    assert.deepEqual(calls.at(-1), ['labels', 'a', ['bug', 'iOS', 'todo']]);
    await act(async () => { button(menu, 'Edit labels').onPress(); });
    assert.deepEqual(state.pushed.at(-1), { pathname: '/threads/[threadId]/labels', params: { threadId: 'a', connection: 'primary' } });
    await act(async () => { button(menu, 'Rename session').onPress(); });
    assert.equal(state.prompts.at(-1).value, 'Login crash');
    await act(async () => { button(state.prompts.at(-1), 'Save').onPress('  Login crash on iOS  '); });
    assert.deepEqual(calls.at(-1), ['rename', 'a', 'Login crash on iOS']);
    await act(async () => { button(menu, 'Archive session').onPress(); });
    assert.equal(state.alerts.at(-1).title, 'Archive this session?', 'archive asks first');
    assert.equal(calls.filter(c => c[0] === 'archive').length, 0);
    await act(async () => { button(state.alerts.at(-1), 'Archive').onPress(); });
    assert.deepEqual(calls.at(-1), ['archive', 'home', 'a']);

    // A connection without label support: no todo or label items.
    await act(async () => { row('Bug triage').props.onLongPress(); });
    assert.deepEqual(state.alerts.at(-1).buttons.map(b => b.text), ['Rename session', 'Archive session', 'Cancel']);
    assert.deepEqual(row('Bug triage').props.accessibilityActions.map(a => a.name), ['rename', 'archive'], 'the same actions for screen readers');
    await act(async () => { button(state.alerts.at(-1), 'Archive session').onPress(); });
    await act(async () => { button(state.alerts.at(-1), 'Archive').onPress(); });
    assert.deepEqual(calls.at(-1), ['archive', 'work', 'z']);

    home.archiveThread = async () => { throw new Error('offline'); };
    await act(async () => { row('Release notes').props.onLongPress(); });
    await act(async () => { button(state.alerts.at(-1), 'Archive session').onPress(); });
    await act(async () => { button(state.alerts.at(-1), 'Archive').onPress(); });
    assert.equal(root.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'alert').map(n => n.props.children).join(), 'Could not complete that action. Try again later.');
  } finally { await act(async () => root.unmount()); }
});
