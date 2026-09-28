import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compile(source, modules, context = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, ...context, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  return exports;
}
const load = (path, modules) => compile(readFileSync(new URL(path, import.meta.url), 'utf8'), modules);

// Real React + pinned KAV/useKeyboardState code; native keyboard/event/animation
// APIs are substitutes. Deliberately retain stale animated state after didHide
// to verify the application guard, not to claim this reproduces UIKit ordering.
async function harness() {
  const Focus = React.createContext(true);
  const listeners = new Map();
  let visible = false, mounts = 0, unmounts = 0, draft, setDraft;
  const nativeState = { isClosed: { value: true }, heightWhenOpened: { value: 0 }, progress: { value: 0 } };
  const keyboard = load('../node_modules/react-native-keyboard-controller/src/hooks/useKeyboardState/index.ts', {
    react: React,
    '../../bindings': { KeyboardEvents: { addListener(name, callback) {
      const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(callback);
      return { remove: () => set.delete(callback) };
    } } },
    '../../module': { KeyboardController: { state: () => ({ height: visible ? 330 : 0 }), isVisible: () => visible } },
  });
  const KAV = load('../node_modules/react-native-keyboard-controller/src/components/KeyboardAvoidingView/index.tsx', {
    react: React, 'react-native': { View: 'View' },
    'react-native-reanimated': { View: 'AnimatedView',
      useSharedValue: value => React.useRef({ value }).current,
      useDerivedValue: fn => ({ get value() { return fn(); } }),
      useAnimatedStyle: fn => fn(), runOnUI: fn => fn,
      interpolate: (v, _, [a, b]) => a + (b - a) * v },
    '../../bindings': { KeyboardControllerNative: {} },
    '../../hooks': { useWindowDimensions: () => ({ height: 900 }) },
    '../../utils/findNodeHandle': { findNodeHandle: () => null },
    '../hooks/useCombinedRef': { default: () => null, __esModule: true },
    './hooks': { useKeyboardAnimation: () => nativeState, useTranslateAnimation: () => ({ translate: { value: 0 }, padding: { value: 0 } }) },
  }).default;
  const node = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'FormKeyboardAvoidingView');
  assert.ok(node, 'production form keyboard boundary exists');
  const Form = compile(node.getText(app), {}, {
    React, KeyboardAvoidingView: KAV, useKeyboardState: keyboard.useKeyboardState,
    useIsFocused: () => React.useContext(Focus), styles: { flex: { flex: 1 } },
  }).FormKeyboardAvoidingView;
  function Draft() {
    [draft, setDraft] = React.useState('unsaved topic');
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return React.createElement('Input', { value: draft });
  }
  let root, focused = true;
  async function render(value = focused) {
    focused = value;
    const tree = React.createElement(Focus.Provider, { value }, React.createElement(Form, {}, React.createElement(Draft)));
    await act(async () => { if (root) root.update(tree); else root = create(tree); });
  }
  await render();
  await act(async () => root.root.findByType('AnimatedView').props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 390, height: 766 } } }));
  await render();
  return {
    render,
    async show() {
      visible = true; nativeState.isClosed.value = false; nativeState.heightWhenOpened.value = 330; nativeState.progress.value = 1;
      await act(async () => { for (const fn of listeners.get('keyboardWillShow') ?? []) fn(); });
    },
    async hide(stale = true) {
      visible = false;
      if (!stale) { nativeState.isClosed.value = true; nativeState.progress.value = 0; }
      await act(async () => { for (const fn of listeners.get('keyboardDidHide') ?? []) fn(); });
    },
    get style() { return Object.assign({}, ...root.root.findByType('AnimatedView').props.style); },
    get child() { return { mounts, unmounts, draft }; },
    async edit(value) { await act(async () => setDraft(value)); },
    async close() { await act(async () => root.unmount()); assert.ok([...listeners.values()].every(set => set.size === 0)); },
  };
}

test('covered form does not shrink for chat keyboard; pop + didHide releases stale height without remount', async () => {
  const h = await harness();
  await h.edit('keep my draft');
  await h.render(false); await h.show();
  assert.equal(h.style.flex, 1); assert.equal(h.style.height, undefined);
  await h.render(true); // incoming native pop while the keyboard is still closing
  assert.equal(h.style.height, 470);
  await h.hide(); // keep simulated worklet open: native didHide must still release the height
  assert.equal(h.style.flex, 1); assert.equal(h.style.height, undefined);
  assert.deepEqual(h.child, { mounts: 1, unmounts: 0, draft: 'keep my draft' });
  await h.close();
});

test('keyboard closes while covered, returning form is full-height and can avoid its own keyboard again', async () => {
  const h = await harness();
  await h.render(false); await h.show(); await h.hide(); await h.render(true);
  assert.equal(h.style.height, undefined);
  await h.show(); assert.equal(h.style.height, 470);
  await h.hide(false); assert.equal(h.style.height, undefined);
  await h.close();
});

test('cancelled navigation while keyboard stays open preserves form and resumes avoidance', async () => {
  const h = await harness();
  await h.show(); assert.equal(h.style.height, 470);
  await h.render(false); assert.equal(h.style.height, undefined);
  await h.render(true); assert.equal(h.style.height, 470);
  assert.deepEqual(h.child, { mounts: 1, unmounts: 0, draft: 'unsaved topic' });
  await h.close();
});

test('all non-chat form routes use the guard, without nesting another keyboard avoider', () => {
  for (const name of ['ChannelsScreen', 'ConnectionRoute', 'SettingsRoute']) {
    const node = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name);
    assert.match(node.getText(app), /<FormKeyboardAvoidingView>/);
    assert.doesNotMatch(node.getText(app), /<KeyboardAvoidingView/);
  }
});
