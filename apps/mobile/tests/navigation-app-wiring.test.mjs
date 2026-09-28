import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const sourceText = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('App.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'Screen');
const declaration = name => screen.body.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(source) === name)).getText(source);
const code = ts.transpileModule(['openThread', 'chooseChannel', 'chooseThread', 'back'].map(declaration).join('\n') + '\nexports.actions = { openThread, chooseChannel, chooseThread, back };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function actions(overrides = {}) {
  const calls = [], context = {
    exports: {}, client: { supportsLatest: true, historyWindow: async () => ({ older_cursor: null, messages: [] }), resumeTail: () => {} },
    openingRef: { current: 0 }, navLock: { current: false }, channelBlocked: { current: false }, agentBlocked: { current: false }, modelBlocked: { current: false }, modelSaving: { current: false },
    locatedThreads: { current: new Set() }, olderCursors: { current: new Map() }, positions: { current: new Map() },
    channelId: null, threadId: null, settingsOpen: false, editing: false, busy: false, pairingBusy: false, config: { baseUrl: 'https://example.com' },
    agentName: { saving: false }, font: { saving: false },
  };
  Object.assign(context, overrides);
  for (const key of ['setThreadId','setPageCursor','setHistoryBusy','setLocated','setStartRef','setError','setNavDirection','setChannelId','setSettingsOpen','setEditing','setBase']) {
    context[key] = value => { calls.push([key, value]); context[key.replace('set', '').replace(/^./, x => x.toLowerCase())] = value; };
  }
  runInNewContext(code, context);
  return { context, calls, ...context.exports.actions };
}

test('production navigation callbacks lock rapid presses and stale thread history cannot return after back', async () => {
  let resolve;
  const h = actions({ client: { supportsLatest: true, historyWindow: () => new Promise(r => { resolve = r; }), resumeTail: () => assert.fail('stale tail') } });
  h.chooseChannel('c'); h.chooseChannel('second');
  assert.deepEqual(h.calls.filter(([name]) => name === 'setChannelId'), [['setChannelId', 'c']]);
  h.context.navLock.current = false;
  h.chooseThread('t'); h.chooseThread('other');
  assert.deepEqual(h.calls.filter(([name]) => name === 'setThreadId'), [['setThreadId', 't']]);
  h.context.navLock.current = false;
  // A fresh Screen render captures the new thread; the same ref fences old requests.
  const returned = actions({ ...h.context, threadId: 't', exports: {}, client: h.context.client });
  returned.back();
  resolve({ older_cursor: 'stale', messages: [{ ref_seq: 9 }] });
  await new Promise(r => setImmediate(r));
  assert.equal(h.context.openingRef.current, 2);
  assert.ok(!h.calls.some(([name, value]) => name === 'setLocated' && value === true));
  assert.equal(returned.context.threadId, null);
});

test('production back callback protects forms, saves and settings, then follows one level at a time', () => {
  const h = actions({ channelId: 'c', channelBlocked: { current: true } });
  h.back(); assert.equal(h.calls.length, 0);
  h.context.channelBlocked.current = false; h.back();
  assert.deepEqual(h.calls.filter(([name]) => name === 'setChannelId'), [['setChannelId', null]]);
  const settings = actions({ settingsOpen: true, agentName: { saving: true } });
  settings.back(); assert.equal(settings.context.settingsOpen, true);
  settings.context.agentName.saving = false; settings.context.modelSaving.current = true;
  settings.back(); assert.equal(settings.context.settingsOpen, true);
  settings.context.modelSaving.current = false; settings.context.font.saving = true;
  settings.back(); assert.equal(settings.context.settingsOpen, true);
  settings.context.font.saving = false; settings.back(); assert.equal(settings.context.settingsOpen, false);
  const connection = actions({ editing: true, pairingBusy: true });
  connection.back(); assert.equal(connection.context.editing, true);
  connection.context.pairingBusy = false; connection.back(); assert.equal(connection.context.editing, false);
});

test('production Android BackHandler uses the same guarded callback and cleans its listener', () => {
  const registration = screen.body.statements.find(n => ts.isExpressionStatement(n) && n.getText(source).includes("BackHandler.addEventListener('hardwareBackPress'"));
  const compiled = ts.transpileModule(`(function register() { ${registration.getText(source)} })`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let callback, removed = false, count = 0;
  const context = { backState: { current: { ready: true, connected: true, editing: false, settingsOpen: false, threadId: 't', channelId: 'c' } }, latestBack: { current: () => count++ },
    BackHandler: { addEventListener: (event, fn) => { assert.equal(event, 'hardwareBackPress'); callback = fn; return { remove: () => { removed = true; } }; } },
    useEffect: fn => { const cleanup = fn(); context.cleanup = cleanup; } };
  runInNewContext(compiled, context)();
  assert.equal(callback(), true); assert.equal(count, 1);
  context.backState.current = { ...context.backState.current, threadId: null, channelId: null };
  assert.equal(callback(), false); assert.equal(count, 1);
  context.backState.current.settingsOpen = true; context.latestBack.current = () => count += 2;
  assert.equal(callback(), true); assert.equal(count, 3, 'latest callback is used without re-registering');
  context.cleanup(); assert.equal(removed, true);
});

test('channel form draft and saving notify navigation guard; back button does not discard either', async () => {
  const text = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const cells = [], queued = [], blocked = [], effects = []; let cursor = 0, resolve;
  const react = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: value => { const i = cursor++; return cells[i] ??= { current: value }; },
    useState: value => { const i = cursor++; cells[i] ??= { value }; return [cells[i].value, next => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
    useEffect: (fn, deps) => { const i = cursor++, old = cells[i]; if (!old || deps.some((v, at) => !Object.is(v, old.deps?.[at]))) queued.push(() => {
      old?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; effects.push(cells[i]);
    }); } };
  const native = { ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Pressable: 'Pressable', StyleSheet: { create: s => s }, View: 'View' };
  const result = { exports: {} };
  runInNewContext(compiled, { exports: result.exports, module: result, require: name => ({ react: { ...react, default: react }, 'react-native': native,
    './FontSize': { Text: 'Text', TextInput: 'TextInput' }, './channel-edits': { channelPatch: () => ({}), threadPatch: title => ({ title }) } })[name] ?? assert.fail(name) });
  const client = { channels: new Map([['c', { id: 'c', name: 'Channel' }]]), threads: new Map(), createThread: () => new Promise(r => { resolve = r; }), getThread: async () => {} };
  const walk = n => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children), ...walk(n.props?.ListHeaderComponent)] : [];
  const render = () => { cursor = 0; queued.length = 0; const tree = result.exports.ChannelScreens({ client, channelId: 'c', onChannel() {}, onThread() {}, onNavigationBlocked: value => blocked.push(value) });
    while (queued.length) queued.shift()(); return walk(tree); };
  render(); let nodes = render();
  const input = nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'New topic title');
  input.props.onChangeText('Unsent topic'); nodes = render();
  assert.equal(blocked.at(-1), true);
  assert.equal(nodes.find(n => n.props?.label === '‹ Channels').props.disabled, true);
  nodes.find(n => n.props?.label === 'Create').props.onPress();
  nodes = render(); assert.equal(blocked.at(-1), true);
  resolve({ id: 'new' }); await new Promise(r => setImmediate(r));
  render(); assert.equal(blocked.at(-1), false);
});

test('App wires the same back semantics to gesture, button and native modal; modal honors reduced motion', () => {
  const renderReturn = screen.body.statements.filter(ts.isReturnStatement).at(-1).getText(source);
  const treeCode = ts.transpileModule(`(function render() { ${renderReturn} })`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
  const context = { React: { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    styles: {}, config: { id: 'conn' }, settingsOpen: true, reduceMotion: true, navDirection: 'forward', navLock: { current: false },
    error: '', loading: false, client: { supportsLatest: true, threads: new Map() }, threadId: 't', channelId: 'c',
    rows: [], selected: { title: 'Chat' }, visibleMessages: [], located: true, first: 0, pageCursor: null, historyBusy: false,
    positions: { current: new Map() }, timelineRef: { current: null }, text: 'draft', draftAttachments: [{ id: 'file' }], attachmentsBusy: false,
    receipts: [], interactions: [], answers: {}, status: 'online', composerScope: 'conn:t', currentComposer: { current: 'conn:t' }, attachmentClearKey: 0, busy: false,
    agentName: { name: 'Agent', ready: true, error: '', saving: false, save() {}, reload() {} }, font: { saving: false },
    agentBlocked: { current: false }, modelBlocked: { current: false }, modelSaving: { current: false }, channelBlocked: { current: false }, back() {},
    onAgentBlocked() {}, onModelBlocked() {}, onModelSaving() {}, onChannelBlocked() {}, isAgentTyping: () => false,
  };
  for (const name of ['View','Text','Button','ChatTimeline','ChannelScreens','KeyboardAvoidingView','NavigationMotion','Modal','SafeAreaView','AgentSettings','ModelSettings','FontSizeSettings','TypingIndicator','AttachmentComposer']) context[name] = name;
  for (const name of ['locateNext','loadOlder','visibleRef','setText','send','renderAttachments','onAttachmentsChange','setAnswers','answer','run','chooseChannel','chooseThread','setEditing','setSettingsOpen']) context[name] = () => {};
  const tree = runInNewContext(treeCode, context)();
  const walk = n => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : [];
  const nodes = walk(tree);
  const route = nodes.find(n => n.type === 'NavigationMotion' && n.props.pageKey === 'thread:t');
  assert.equal(route.props.direction, 'forward'); assert.equal(route.props.onBack, context.back);
  assert.equal(nodes.find(n => n.type === 'Button' && n.props.title === '‹ Topics').props.onPress, context.back);
  const modal = nodes.find(n => n.type === 'Modal');
  assert.equal(modal.props.animationType, 'none'); assert.equal(modal.props.onRequestClose, context.back);
  const settings = nodes.find(n => n.type === 'NavigationMotion' && n.props.pageKey === 'settings');
  assert.equal(settings.props.onBack, context.back);
  assert.equal(nodes.find(n => n.type === 'ChatTimeline').props.text, 'draft');
});
