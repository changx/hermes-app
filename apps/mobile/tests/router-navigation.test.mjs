import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { routeId } from '../src/routeId.ts';

const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, `production ${name} callback found`);
  const script = ts.transpileModule(`globalThis.callback = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(script, context);
  return context.callback;
}

test('route IDs accept only opaque path-safe identifiers, never token/body params', () => {
  assert.equal(routeId('t_4b-9'), 't_4b-9');
  for (const raw of [undefined, ['t_one', 't_other'], '', '../settings', 'a/b', 'token?x=secret', '你', 'x'.repeat(129)])
    assert.equal(routeId(raw), null);
});

test('late history completion after pop cannot resume a hidden chat or update its cursor', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const events = [];
  const focusedRef = { current: true }, openingRef = { current: 0 };
  const client = { supportsLatest: true, historyWindow: () => gate, resumeTail: () => events.push('resume') };
  const context = {
    client, focusedRef, openingRef, locatedThreads: { current: new Set() }, positions: { current: new Map() }, olderCursors: { current: new Map() },
    setPageCursor: value => events.push(['cursor', value]), setHistoryBusy: value => events.push(['busy', value]),
    setLocated: value => events.push(['located', value]), setStartRef: value => events.push(['start', value]), setError: value => events.push(['error', value]),
  };
  const open = callback('openThread', context);
  const pending = open('t_one');
  focusedRef.current = false; openingRef.current++;
  finish({ messages: [{ ref_seq: 99 }], older_cursor: 'secret-cursor' });
  await pending;
  assert.deepEqual(events, [['cursor', null], ['busy', true], ['located', false], ['start', null]]);
  assert.equal(context.olderCursors.current.size, 0);
});

test('hidden timeline reports do not mark a thread read', () => {
  const read = [], focusedRef = { current: false };
  const context = { client: { markRead: (...args) => { read.push(args); return Promise.resolve(); } }, focusedRef,
    appActive: { current: true }, threadId: 't_one', markedRef: { current: 0 } };
  const visible = callback('visibleRef', context);
  visible(8); assert.equal(read.length, 0);
  focusedRef.current = true; visible(8);
  assert.deepEqual(read, [['t_one', 8]]);
  focusedRef.current = false; visible(9); assert.equal(read.length, 1);
});

test('forget stops outbox, clears saved connection and resets routed identity', async () => {
  const events = [];
  let identity = 4;
  const context = {
    run: fn => fn(), pairingTask: { current: null }, SecureStore: { deleteItemAsync: async key => { events.push(['delete', key]); } },
    PAIRING_KEY: 'pairing', CONFIG_KEY: 'connection',
    outboxRef: { current: { stop: async () => events.push('stop'), storage: { clear: async () => events.push('clear') } } },
    setPendingPairing: value => events.push(['pending', value]), setRecords: value => events.push(['records', value]),
    setSession: value => events.push(['session', value]), setConfig: value => events.push(['config', value]),
    setIdentity: update => { identity = update(identity); }, setPairingCode: value => events.push(['code', value]),
    setEditing: value => events.push(['editing', value]), setStatus: value => events.push(['status', value]),
    router: { replace: path => events.push(['replace', path]) },
  };
  await callback('forget', context)();
  assert.equal(identity, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['delete', 'pairing'], ['pending', null], 'stop', 'clear', ['delete', 'connection'],
    ['records', []], ['session', null], ['config', null], ['code', ''], ['editing', false], ['status', 'suspended'], ['replace', '/connection'],
  ]);
});

test('route-local send failure hidden by settings settles busy and keeps error for return', async () => {
  const events = [], busyRef = { current: false };
  const run = callback('run', { busyRef, focusedRef: { current: false },
    setBusy: value => events.push(['busy', value]), setError: value => events.push(['error', value]) });
  await run(async () => { throw Error('storage'); }, 'Message not saved');
  assert.equal(busyRef.current, false);
  assert.deepEqual(events, [['busy', true], ['error', ''], ['error', 'Message not saved'], ['busy', false]]);
});

test('a channel form completion behind another screen cannot navigate', async () => {
  const channelSource = ts.createSourceFile('ChannelScreens.tsx', readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let runNode;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(channelSource) === 'run') runNode = node.initializer;
    ts.forEachChild(node, visit); };
  visit(channelSource);
  assert.ok(runNode);
  const events = [], focusedRef = { current: true }, generation = { current: 1 }, working = { current: false };
  const context = { focusedRef, generation, working, setBusy: value => events.push(['busy', value]), setError: value => events.push(['error', value]) };
  runInNewContext(ts.transpileModule(`globalThis.run = ${runNode.getText(channelSource)};`, {}).outputText, context);
  let finish;
  const pending = context.run(async current => {
    await new Promise(resolve => { finish = resolve; });
    if (current()) events.push('navigate');
  });
  focusedRef.current = false; generation.current++;
  finish(); await pending;
  assert.ok(!events.includes('navigate'));
  assert.equal(working.current, false);
});
