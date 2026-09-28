import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { transformSync } from '@babel/core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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

// Execute the pinned RN KAV and controller visibility hook with real React.
// Native event/layout APIs remain substitutes, not UIKit acceptance. Legacy
// controller mode models incremental animation writes to catch the old blind spot.
async function harness({ legacy = false, platform = 'ios', header = 100, top = 59, y = 0, height = 766 } = {}) {
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
  const ControllerKAV = load('../node_modules/react-native-keyboard-controller/src/components/KeyboardAvoidingView/index.tsx', {
    react: React, 'react-native': { View: 'View' },
    'react-native-reanimated': { View: 'AnimatedView',
      useSharedValue: value => React.useRef({ value }).current,
      useDerivedValue: fn => ({ get value() { return fn(); } }),
      // Native Reanimated updates are incremental: omitted keys remain applied.
      useAnimatedStyle: fn => { const applied = React.useRef({}); Object.assign(applied.current, fn()); return applied.current; }, runOnUI: fn => fn,
      interpolate: (v, _, [a, b]) => a + (b - a) * v },
    '../../bindings': { KeyboardControllerNative: {} },
    '../../hooks': { useWindowDimensions: () => ({ height: 900 }) },
    '../../utils/findNodeHandle': { findNodeHandle: () => null },
    '../hooks/useCombinedRef': { default: () => null, __esModule: true },
    './hooks': { useKeyboardAnimation: () => nativeState, useTranslateAnimation: () => ({ translate: { value: 0 }, padding: { value: 0 } }) },
  }).default;
  const rnModules = {
    react: React,
    '../../LayoutAnimation/LayoutAnimation': { configureNext() {}, Types: { keyboard: 'keyboard' } },
    '../../StyleSheet/StyleSheet': { compose: (a, b) => [a, b] },
    '../../Utilities/Platform': { OS: platform },
    '../AccessibilityInfo/AccessibilityInfo': { prefersCrossFadeTransitions: async () => false },
    '../View/View': 'View',
    './Keyboard': { isVisible: () => visible, addListener(name, callback) {
      const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(callback);
      return { remove: () => set.delete(callback) };
    } },
  };
  const rnExports = {};
  const rnSource = readFileSync(new URL('../node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js', import.meta.url), 'utf8');
  const { code } = transformSync(rnSource, { filename: 'KeyboardAvoidingView.js', babelrc: false, configFile: false,
    presets: [require.resolve('@react-native/babel-preset')] });
  runInNewContext(code, { exports: rnExports, require: id => {
    if (id.startsWith('@babel/runtime/helpers/') || id === 'react/jsx-runtime') return require(id);
    assert.ok(id in rnModules, id); return rnModules[id];
  } });
  const KAV = legacy ? ControllerKAV : rnExports.default;
  const node = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'FormKeyboardAvoidingView');
  assert.ok(node, 'production form keyboard boundary exists');
  const formSource = legacy ? `export function FormKeyboardAvoidingView({ children }) {
    const focused = useIsFocused();
    const keyboardVisible = useKeyboardState(state => state.isVisible);
    return <KeyboardAvoidingView style={styles.flex} behavior="height" automaticOffset enabled={focused && keyboardVisible}>{children}</KeyboardAvoidingView>;
  }` : node.getText(app);
  const Form = compile(formSource, {}, {
    React, KeyboardAvoidingView: KAV, useKeyboardState: keyboard.useKeyboardState,
    useIsFocused: () => React.useContext(Focus), useHeaderHeight: () => header, useSafeAreaInsets: () => ({ top }), styles: { flex: { flex: 1 } },
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
  const host = legacy ? 'AnimatedView' : 'View';
  await act(async () => root.root.findByType(host).props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: legacy ? 100 : y, width: 390, height } } }));
  const emit = async (name, event) => { await act(async () => { for (const fn of listeners.get(name) ?? []) fn(event); }); };
  await render();
  return {
    render,
    async show(keyboardHeight = 330) {
      visible = true; nativeState.isClosed.value = false; nativeState.heightWhenOpened.value = keyboardHeight; nativeState.progress.value = 1;
      const event = { duration: 250, easing: 'keyboard', endCoordinates: { screenY: 900 - keyboardHeight, height: keyboardHeight } };
      await emit('keyboardWillShow', event);
      await emit('keyboardDidShow', event);
    },
    async hide(stale = true) {
      visible = false;
      if (!stale) { nativeState.isClosed.value = true; nativeState.progress.value = 0; }
      await emit('keyboardWillHide');
      await emit('keyboardDidHide');
    },
    async didHideOnly() { visible = false; await emit('keyboardDidHide'); },
    get style() { return Object.assign({}, ...root.root.findByType(host).props.style); },
    get child() { return { mounts, unmounts, draft }; },
    async edit(value) { await act(async () => setDraft(value)); },
    async close() { await act(async () => root.unmount()); assert.ok([...listeners.values()].every(set => set.size === 0)); },
  };
}

test('covered form does not shrink for chat keyboard; pop + didHide releases stale height without remount', async () => {
  const h = await harness();
  await h.edit('keep my draft');
  await h.render(false); await h.show();
  assert.equal(h.style.flex, 1); assert.equal(h.style.height, undefined); assert.equal(h.style.paddingBottom, 0);
  await h.render(true); // incoming native pop while the keyboard is still closing
  assert.equal(h.style.paddingBottom, 296);
  await h.hide(); // keep simulated worklet open: native didHide must still release the height
  assert.equal(h.style.flex, 1); assert.equal(h.style.height, undefined); assert.equal(h.style.paddingBottom, 0);
  assert.deepEqual(h.child, { mounts: 1, unmounts: 0, draft: 'keep my draft' });
  await h.close();
});

test('keyboard closes while covered, returning form is full-height and can avoid its own keyboard again', async () => {
  const h = await harness();
  await h.render(false); await h.show(); await h.hide(); await h.render(true);
  assert.equal(h.style.height, undefined);
  await h.show(); assert.equal(h.style.paddingBottom, 296);
  await h.hide(false); assert.equal(h.style.height, undefined);
  await h.close();
});

test('cancelled navigation while keyboard stays open preserves form and resumes avoidance', async () => {
  const h = await harness();
  await h.show(); assert.equal(h.style.paddingBottom, 296);
  await h.render(false); assert.equal(h.style.height, undefined); assert.equal(h.style.paddingBottom, 0);
  await h.render(true); assert.equal(h.style.paddingBottom, 296);
  assert.deepEqual(h.child, { mounts: 1, unmounts: 0, draft: 'unsaved topic' });
  await h.close();
});

test('legacy height animation reproduces retained native height after didHide', async () => {
  const h = await harness({ legacy: true });
  await h.render(false); await h.show(); await h.render(true);
  assert.equal(h.style.height, 470);
  await h.hide(false);
  assert.equal(h.style.height, 470, 'empty animated patch does not unset native height');
  assert.equal(h.style.flex, 0);
  await h.close();
});

test('didHide alone releases padding even when RN missed willHide', async () => {
  const h = await harness();
  await h.show(); assert.equal(h.style.paddingBottom, 296);
  await h.didHideOnly(); assert.equal(h.style.paddingBottom, 0);
  await h.show(380); assert.equal(h.style.paddingBottom, 346);
  await h.hide(); assert.equal(h.style.paddingBottom, 0);
  await h.close();
});

for (const platform of ['ios', 'android']) {
  test(`${platform} header and hidden-header safe area avoid once and restore repeatedly`, async () => {
    for (const geometry of [
      { header: 100, top: 59, y: 0, height: 766 },
      { header: 0, top: 59, y: 60, height: 747 },
      { header: 64, top: 0, y: 0, height: 836 },
    ]) {
      const h = await harness({ platform, ...geometry });
      for (const keyboardHeight of [330, 380, 240]) {
        await h.show(keyboardHeight);
        assert.equal(h.style.paddingBottom, Math.max(0, geometry.y + geometry.height + Math.max(geometry.header, geometry.top) - (900 - keyboardHeight)));
        assert.equal(h.style.height, undefined); assert.equal(h.style.flex, 1);
        await h.render(false); assert.equal(h.style.paddingBottom, 0);
        await h.hide(); await h.render(true); assert.equal(h.style.paddingBottom, 0);
      }
      assert.equal(h.child.mounts, 1); assert.equal(h.child.unmounts, 0);
      await h.close();
    }
  });
}

test('all non-chat form routes use the guard, without nesting another keyboard avoider', () => {
  const rnImport = app.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === 'react-native');
  assert.match(rnImport.getText(app), /KeyboardAvoidingView/);
  const controllerImport = app.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === 'react-native-keyboard-controller');
  assert.doesNotMatch(controllerImport.getText(app), /KeyboardAvoidingView/);
  for (const name of ['ChannelsScreen', 'ConnectionRoute', 'SettingsRoute']) {
    const node = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name);
    assert.match(node.getText(app), /<FormKeyboardAvoidingView>/);
    assert.doesNotMatch(node.getText(app), /<KeyboardAvoidingView/);
  }
});
