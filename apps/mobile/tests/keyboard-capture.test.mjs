import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { KEYBOARD_REPORT_BUILD, KeyboardReport, REPORT_LIMIT, GEOMETRY_LIMIT, safeReportData } from '../src/keyboardReport.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('report allowlists geometry, rejects all text/identity fields and invalid numbers', () => {
  const data = safeReportData({ screenY: 570.123, height: 330, paddingBottom: 296, text: 'SECRET',
    token: 'SECRET', channelId: 'SECRET', part: 'SECRET', appState: 'active', focused: true,
    width: Infinity, x: NaN, y: 1e10, nativeEvent: { text: 'SECRET' } });
  assert.deepEqual(data, { screenY: 570.12, height: 330, paddingBottom: 296,
    widthStatus: 'positive-infinity', xStatus: 'nan', y: 1e10, focused: true, appState: 'active' });
  const report = new KeyboardReport();
  report.append('sample', 'new-topic', { token: 'SECRET', text: 'SECRET', height: 330 });
  report.append('SECRET', 'new-topic', {}); report.append('sample', 'SECRET', {});
  assert.equal(report.snapshot().entries.length, 1);
  assert.ok(!JSON.stringify(report.snapshot()).includes('SECRET'));
});

test('bounded ring, immutable snapshot, explicit reset and privacy-safe restore/expiry', () => {
  const report = new KeyboardReport();
  for (let i = 0; i < REPORT_LIMIT + 7; i++) report.append('sample', 'new-topic', { height: i });
  const snapshot = report.snapshot();
  assert.equal(snapshot.entries.length, GEOMETRY_LIMIT); assert.equal(snapshot.dropped, REPORT_LIMIT + 7 - GEOMETRY_LIMIT);
  snapshot.entries[0].data.height = -99; assert.notEqual(report.snapshot().entries[0].data.height, -99);
  report.reset('third-party'); assert.equal(report.snapshot().entries.length, 0);
  assert.equal(report.snapshot().keyboard, 'third-party');
  const saved = { ...snapshot, entries: [{ kind: 'layout', route: 'new-channel', elapsedMs: 5,
    data: { height: 330, text: 'SECRET', token: 'SECRET' } }] };
  report.restore(saved); assert.equal(report.snapshot().entries[0].data.height, 330);
  assert.ok(!JSON.stringify(report.snapshot()).includes('SECRET'));
  report.reset('system-english'); report.restore({ ...saved, startedAt: Date.now() - 86400001 });
  assert.equal(report.snapshot().entries.length, 0);
});

test('layout storm cannot evict show or foreground events; repeated layouts are counted and throttled', () => {
  const original = Date.now;
  Date.now = () => 1000000;
  try {
    const report = new KeyboardReport();
    report.append('app-state', 'new-topic', { appState: 'active' });
    report.append('keyboardWillShow', 'new-topic', { screenY: 0 });
    for (let i = 0; i < 5000; i++) report.append('layout', 'new-topic', { part: 'form', height: 100000 + i });
    assert.equal(report.snapshot().suppressedLayouts, 4999);
    for (let i = 0; i < 5000; i++) report.append('sample', 'new-topic', { height: 100000 + i });
    const snapshot = report.snapshot();
    assert.equal(snapshot.entries.length, GEOMETRY_LIMIT + 2);
    assert.deepEqual(snapshot.entries.slice(0, 2).map(e => e.kind), ['app-state', 'keyboardWillShow']);
    const restored = new KeyboardReport(); restored.restore(snapshot);
    assert.equal(restored.snapshot().entries.length, GEOMETRY_LIMIT + 2);
    assert.equal(restored.snapshot().suppressedLayouts, 4999);
    report.reset('third-party'); assert.equal(report.snapshot().suppressedLayouts, 0);
    assert.equal(report.append('layout', 'new-topic', { part: 'form', height: 806 }), true);
  } finally { Date.now = original; }
});

test('large finite, NaN, infinity and missing geometry remain distinguishable through JSON and restore', () => {
  const report = new KeyboardReport();
  report.append('sample', 'new-topic', { height: 345678, storedBottom: NaN, paddingBottom: Infinity,
    measuredHeight: undefined, screenY: -Infinity, width: 1e15, widthStatus: 'SECRET' });
  const snapshot = JSON.parse(JSON.stringify(report.snapshot()));
  const data = snapshot.entries[0].data;
  assert.equal(data.height, 345678); assert.equal(data.storedBottomStatus, 'nan');
  assert.equal(data.paddingBottomStatus, 'positive-infinity'); assert.equal(data.measuredHeightStatus, 'missing');
  assert.equal(data.screenYStatus, 'negative-infinity'); assert.equal(data.width, 1e12);
  assert.equal(data.widthStatus, 'clamped'); assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
  const restored = new KeyboardReport(); restored.restore(snapshot);
  assert.deepEqual(restored.snapshot().entries[0].data, data);
});

function load(modules, context) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/KeyboardCapture.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, ...context, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  return exports;
}
async function harness(platform = 'ios') {
  const callbacks = new Map(), timers = new Map(), files = new Map(), shared = [];
  let timerID = 0, failStorage = false, api, root, draftMounts = 0;
  function listen(name, fn) { const set = callbacks.get(name) ?? new Set(); callbacks.set(name, set); set.add(fn); return { remove() { set.delete(fn); } }; }
  class File {
    constructor(_dir, name) { this.uri = 'file:///cache/' + name; }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    textSync() { return files.get(this.uri); }
    write(value) { if (failStorage) throw new Error('synthetic storage failure'); files.set(this.uri, value); }
  }
  const AppState = { currentState: 'active', addEventListener: (_name, fn) => listen('app', fn) };
  const native = { Alert: { alert() {} }, AppState,
    Dimensions: { get: () => ({ width: 390, height: 900, fontScale: 1 }), addEventListener: (_name, fn) => listen('dimensions', fn) },
    Keyboard: { isVisible: () => true, addListener: listen }, Modal: 'Modal', View: 'View', Pressable: 'Pressable',
    Platform: { OS: platform }, Share: { share: async value => { shared.push(value); } }, StyleSheet: { create: value => value } };
  const exports = load({ react: React, 'react-native': native, 'expo-file-system': { File, Paths: { cache: '/cache' } },
    './FontSize': { Text: 'Text' }, './keyboardReport': { KEYBOARD_REPORT_BUILD, KeyboardReport } }, {
    setTimeout(fn) { const id = ++timerID; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  function Draft() { React.useEffect(() => { draftMounts++; }, []); return React.createElement('Input', { value: 'PRIVATE DRAFT' }); }
  const kav = { state: { bottom: 296 }, props: { enabled: true }, viewRef: { current: { measureInWindow(fn) { fn(0, 100, 390, 766); } } } };
  function Harness({ focused }) {
    api = exports.useKeyboardCapture('new-topic', focused); api.ref.current = kav;
    return React.createElement(React.Fragment, {}, React.createElement(Draft), React.createElement(exports.KeyboardCaptureButton, { route: 'new-topic' }));
  }
  async function render(focused = true) { await act(async () => {
    const tree = React.createElement(Harness, { focused }); if (root) root.update(tree); else root = create(tree);
  }); }
  await render();
  const emit = async (name, value) => { await act(async () => { for (const fn of callbacks.get(name) ?? []) fn(value); }); };
  const drain = async () => { await act(async () => { const pending = [...timers]; timers.clear(); pending.forEach(([, fn]) => fn()); }); };
  const snapshot = () => JSON.parse(files.get('file:///cache/hermes-keyboard-report.json'));
  return { emit, drain, render, snapshot, kav, api, shared, AppState, root, files,
    failStorage() { failStorage = true; }, get mounts() { return draftMounts; },
    async close() { await act(async () => root.unmount()); assert.ok([...callbacks.values()].every(set => set.size === 0)); assert.equal(timers.size, 0); } };
}

test('actual capture hook records delayed frames and retained padding through background/foreground without altering draft', async () => {
  const h = await harness(); await h.drain();
  h.AppState.currentState = 'inactive'; await h.emit('app', 'inactive');
  h.AppState.currentState = 'background'; await h.emit('app', 'background');
  h.AppState.currentState = 'active'; await h.emit('app', 'active');
  h.kav.state.bottom = 866;
  await h.emit('keyboardWillShow', { duration: 250, endCoordinates: { screenY: 0, height: 330, width: 390 },
    startCoordinates: { screenY: 900, height: 0 }, isEventFromThisApp: true, text: 'SECRET' });
  await h.drain(); await h.drain();
  const snapshot = h.snapshot();
  assert.ok(snapshot.entries.some(e => e.kind === 'keyboardWillShow' && e.data.screenY === 0));
  assert.ok(snapshot.entries.some(e => e.kind === 'sample' && e.data.paddingBottom === 866 && e.data.measuredHeight === 766));
  assert.deepEqual(snapshot.entries.filter(e => e.kind === 'app-state').map(e => e.data.appState), ['inactive', 'background', 'active']);
  assert.ok(!JSON.stringify(snapshot).includes('SECRET')); assert.ok(!JSON.stringify(snapshot).includes('PRIVATE DRAFT'));
  await h.render(false); await h.emit('keyboardDidChangeFrame', { endCoordinates: { screenY: 600 } });
  await h.render(true); assert.equal(h.mounts, 1); assert.equal(h.kav.state.bottom, 866);
  await h.close();
});

test('export executes local persistence then shares exact file on iOS; storage failure prevents false success', async () => {
  const h = await harness(); await h.drain();
  const share = () => h.root.root.findAllByType('Pressable').find(n => n.findAllByType('Text').some(text => text.props.children === 'Share report'));
  await act(async () => share().props.onPress());
  assert.equal(h.shared[0].url, 'file:///cache/hermes-keyboard-export.json');
  assert.ok(h.snapshot().entries.some(e => e.kind === 'report-share'));
  const frozen = h.files.get(h.shared[0].url);
  await h.emit('app', 'inactive');
  assert.equal(h.files.get(h.shared[0].url), frozen, 'share-sheet lifecycle cannot overwrite the exported snapshot');
  h.failStorage(); await act(async () => share().props.onPress());
  assert.equal(h.shared.length, 1);
  assert.ok(h.root.root.findAllByType('Text').some(n => n.props.children === 'Could not share the report. Try again.'));
  await h.close();
});

test('Android exports geometry text, not an unsupported file URL', async () => {
  const h = await harness('android'); await h.drain();
  const share = h.root.root.findAllByType('Pressable').find(n => n.findAllByType('Text').some(text => text.props.children === 'Share report'));
  await act(async () => share.props.onPress()); assert.equal(h.shared[0].url, undefined);
  assert.equal(JSON.parse(h.shared[0].message).build, 'keyboard-resume-capture-v2');
  await h.close();
});
