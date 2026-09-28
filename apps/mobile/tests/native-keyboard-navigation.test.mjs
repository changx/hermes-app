import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useEffect() {},
};
const Stack = Object.assign(() => {}, { Screen: 'Screen', Protected: 'Protected' });
const find = (node, type) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean) ?? null;
  return node.type === type ? node : find(node.props?.children, type);
};
function layout() {
  const exports = {};
  const modules = {
    react,
    'expo-router': { Stack, useRouter: () => ({ replace() {} }) },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    'react-native-keyboard-controller': { KeyboardProvider: 'KeyboardProvider' },
    '../FontSize': { FontSizeProvider: 'FontSizeProvider', useFontSize: () => ({ scale: 1 }) },
    '../App': { AppProvider: 'AppProvider', useApp: () => ({ ready: true, config: {}, identity: 'test-identity', editing: false }) },
    '../Viewers': { ViewerProvider: 'ViewerProvider' },
  };
  runInNewContext(ts.transpileModule(read('../src/app/_layout.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  const provider = find(exports.default(), 'AppProvider');
  const routes = provider.props.children[0];
  return routes.type(routes.props);
}

test('native Stack explicitly ends editing on page exit, retaining native navigation and shared providers', () => {
  const tree = layout();
  const stack = find(tree, Stack);
  assert.equal(stack.props.screenOptions.keyboardHandlingEnabled, true);
  assert.notEqual(stack.props.screenOptions.gestureEnabled, false);
  assert.notEqual(stack.props.screenOptions.animation, 'none');
  const screens = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Screen') screens.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  assert.ok(screens.some(s => s.props.name === 'threads/[threadId]'));
  for (const screen of screens) assert.notEqual(screen.props.options?.keyboardHandlingEnabled, false);
});

test('pinned native-stack forwards the option to the iOS endEditing gate (source contract, not UIKit execution)', () => {
  const nativeStack = read('../node_modules/expo-router/build/react-navigation/native-stack/views/NativeStackView.native.js');
  assert.match(nativeStack, /hideKeyboardOnSwipe:\s*keyboardHandlingEnabled/);
  const nativeScreen = read('../node_modules/react-native-screens/ios/RNSScreen.mm');
  assert.match(nativeScreen, /-\s*\(void\)notifyWillDisappear\s*\{\s*if\s*\(_hideKeyboardOnSwipe\)\s*\{\s*\[self endEditing:YES\];/);
});
