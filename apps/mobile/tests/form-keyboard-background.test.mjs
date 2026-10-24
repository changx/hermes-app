import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Form pages (New conversation, New topic, New channel, settings) pad their
// bottom for the keyboard. A third-party iOS keyboard sends keyboardWillShow
// with screenY/width/height 0 while the App is in the background; the
// keyboard stays open on return. Coordinates below were captured on Jamie's
// iPhone (440x956 pt window, header 116, top inset 62, bottom inset 34).
const VALID = { screenX: 0, screenY: 570.67, width: 440, height: 385.33, duration: 383.3 };
const ZERO = { screenX: 0, screenY: 0, width: 0, height: 0, duration: 0 };
const LAYOUT = { x: 0, y: 0, width: 440, height: 806 };
const EXPECTED = LAYOUT.height - (VALID.screenY - 116);

const s = { listeners: new Map(), appState: 'active', os: 'ios', visible: false, metrics: undefined, focused: true, keyboardVisible: true, animations: 0 };
globalThis.__formKeyboardTest = s;
function subscribe(name, callback) {
  const group = s.listeners.get(name) ?? new Set(); s.listeners.set(name, group); group.add(callback);
  return { remove() { group.delete(callback); } };
}
s.subscribe = subscribe;
const emit = async (name, end) => {
  await act(async () => { for (const fn of [...(s.listeners.get(name) ?? [])]) fn({ duration: end.duration, easing: 'keyboard', endCoordinates: end }); await Promise.resolve(); });
};
const reset = patch => { s.listeners.clear(); Object.assign(s, { appState: 'active', os: 'ios', visible: false, metrics: undefined, focused: true, keyboardVisible: true, animations: 0 }, patch); };

const mocks = {
  'react-native': `const s=globalThis.__formKeyboardTest;
    export const View='View';
    export const StyleSheet={create:x=>x};
    export const Platform={get OS(){return s.os}};
    export const AppState={get currentState(){return s.appState}};
    export const LayoutAnimation={configureNext(){s.animations++},Types:{keyboard:'keyboard'}};
    export const Keyboard={addListener:(n,f)=>s.subscribe(n,f),isVisible:()=>s.visible,metrics:()=>s.metrics};`,
  'expo-router': `export const useIsFocused=()=>globalThis.__formKeyboardTest.focused;`,
  'react-native-keyboard-controller': `export const useKeyboardState=sel=>sel({isVisible:globalThis.__formKeyboardTest.keyboardVisible});`,
  'expo-router/react-navigation': `export const useHeaderHeight=()=>116;`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:62,bottom:34,left:0,right:0});`,
};
const bundle = await build({ entryPoints: [new URL('../src/FormKeyboardAvoidingView.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { FormKeyboardAvoidingView, usableKeyboardFrame, formKeyboardPadding } = mod.exports;

const render = async () => {
  let root;
  await act(async () => { root = create(React.createElement(FormKeyboardAvoidingView, null, React.createElement('TextInput', { value: '草稿\n第二行' }))); });
  const view = () => root.root.findByType('View');
  await act(async () => { view().props.onLayout({ nativeEvent: { layout: LAYOUT } }); });
  return { root, padding: () => Object.assign({}, ...[view().props.style].flat()).paddingBottom, input: () => root.root.findByType('TextInput') };
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);

test('installed RN KeyboardAvoidingView pads almost the full screen after the background zero frame (old behavior)', async () => {
  reset();
  const requireMobile = createRequire(new URL('../package.json', import.meta.url));
  const { transformSync } = requireMobile('@babel/core');
  const file = requireMobile.resolve('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js');
  const code = transformSync(fs.readFileSync(file, 'utf8'), { filename: 'KeyboardAvoidingView.js', babelrc: false, configFile: false, presets: [requireMobile.resolve('@react-native/babel-preset')] }).code;
  const rnModules = {
    react: React, '../../LayoutAnimation/LayoutAnimation': { configureNext() {}, Types: { keyboard: 'keyboard' } },
    '../../StyleSheet/StyleSheet': { compose: (a, b) => [a, b] }, '../../Utilities/Platform': { OS: 'ios' },
    '../AccessibilityInfo/AccessibilityInfo': { prefersCrossFadeTransitions: async () => false },
    '../View/View': 'View', './Keyboard': { isVisible: () => s.visible, addListener: subscribe },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id.startsWith('@babel/runtime/helpers/') || id === 'react/jsx-runtime') return requireMobile(id);
    assert.ok(id in rnModules, id); return rnModules[id];
  } });
  let root;
  await act(async () => { root = create(React.createElement(exports.default, { style: { flex: 1 }, behavior: 'padding', keyboardVerticalOffset: 116 }, React.createElement('TextInput'))); });
  const view = () => root.root.findByType('View');
  await act(async () => { await view().props.onLayout({ persist() {}, nativeEvent: { layout: LAYOUT } }); });
  const padding = () => Object.assign({}, ...view().props.style.flat()).paddingBottom;
  await emit('keyboardWillShow', VALID); near(padding(), EXPECTED);
  await emit('keyboardWillShow', ZERO); near(padding(), 922);
  await act(async () => root.unmount());
});

test('a background zero frame does not move the form; the keyboard padding stays correct on return', async () => {
  reset();
  const { root, padding, input } = await render();
  const before = input();
  await emit('keyboardWillShow', VALID); near(padding(), EXPECTED);
  s.appState = 'background';
  await emit('keyboardWillShow', ZERO); near(padding(), EXPECTED);
  await emit('keyboardWillShow', VALID); near(padding(), EXPECTED);
  s.appState = 'inactive';
  await emit('keyboardWillShow', { ...VALID, screenY: 300 }); near(padding(), EXPECTED);
  s.appState = 'active';
  await emit('keyboardWillShow', ZERO); near(padding(), EXPECTED);
  assert.equal(input(), before);
  assert.equal(input().props.value, '草稿\n第二行');
  await act(async () => root.unmount());
  assert.ok([...s.listeners.values()].every(group => group.size === 0));
});

test('a real keyboard change in the foreground still moves the form; a hide always returns to zero', async () => {
  reset();
  const { root, padding } = await render();
  await emit('keyboardWillShow', VALID); near(padding(), EXPECTED);
  await emit('keyboardWillShow', { ...VALID, screenY: 520, height: 436 }); near(padding(), LAYOUT.height - (520 - 116));
  assert.ok(s.animations >= 2);
  s.appState = 'background';
  await emit('keyboardWillHide', ZERO); assert.equal(padding(), 0);
  s.appState = 'active';
  await emit('keyboardWillShow', VALID); near(padding(), EXPECTED);
  await act(async () => root.unmount());
});

test('the form is not padded while unfocused or with the keyboard closed, and keeps its frame for return', async () => {
  reset({ focused: false });
  const { root, padding } = await render();
  await emit('keyboardWillShow', VALID); assert.equal(padding(), 0);
  s.focused = true;
  await act(async () => root.update(React.createElement(FormKeyboardAvoidingView, null, React.createElement('TextInput', { value: '草稿\n第二行' }))));
  near(padding(), EXPECTED);
  s.keyboardVisible = false;
  await act(async () => root.update(React.createElement(FormKeyboardAvoidingView, null, React.createElement('TextInput', { value: '草稿\n第二行' }))));
  assert.equal(padding(), 0);
  await act(async () => root.unmount());
});

test('a form opened over an open keyboard uses the current frame only when it is usable', async () => {
  reset({ visible: true, metrics: VALID });
  let page = await render(); near(page.padding(), EXPECTED);
  await act(async () => page.root.unmount());
  reset({ visible: true, metrics: ZERO });
  page = await render(); assert.equal(page.padding(), 0);
  await act(async () => page.root.unmount());
});

test('Android uses the did-show and did-hide events', async () => {
  reset({ os: 'android' });
  const { root, padding } = await render();
  assert.deepEqual([...s.listeners.keys()].sort(), ['keyboardDidHide', 'keyboardDidShow']);
  await emit('keyboardDidShow', VALID); near(padding(), EXPECTED);
  await emit('keyboardDidHide', ZERO); assert.equal(padding(), 0);
  await act(async () => root.unmount());
});

test('frame checks and padding formula', () => {
  assert.equal(usableKeyboardFrame(VALID, 'active'), true);
  assert.equal(usableKeyboardFrame(VALID, 'background'), false);
  assert.equal(usableKeyboardFrame(VALID, 'inactive'), false);
  assert.equal(usableKeyboardFrame(ZERO, 'active'), false);
  assert.equal(usableKeyboardFrame({ ...VALID, width: 0 }, 'active'), false);
  assert.equal(usableKeyboardFrame({ ...VALID, height: NaN }, 'active'), false);
  assert.equal(usableKeyboardFrame(undefined, 'active'), false);
  near(formKeyboardPadding(LAYOUT, VALID, 116), EXPECTED);
  assert.equal(formKeyboardPadding(LAYOUT, { ...VALID, screenY: 2000 }, 116), 0);
  assert.equal(formKeyboardPadding(null, VALID, 116), 0);
});
