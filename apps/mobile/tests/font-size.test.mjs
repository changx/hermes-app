import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { safeFontScale } from '../src/fontScale.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// Transpile and run the production provider and wrappers with explicit native
// and React substitutes. This exercises hooks and native props, not UIKit layout.
function mount(store, os = 'ios') {
  const cells = [], contexts = [];
  let lastRoot;
  let at = 0, effects = [], cleanups = [];
  const react = {
    createContext: value => { const context = { value }; context.Provider = { context }; contexts.push(context); return context; },
    useContext: context => context.value,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: fn => fn,
    useState: initial => { const cell = cells[at++] ??= { value: initial }; return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }]; },
    useRef: initial => cells[at++] ??= { current: initial },
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useEffect: fn => { const cell = cells[at++] ??= { called: false }; if (!cell.called) { cell.called = true; effects.push(() => cleanups.push(fn())); } },
  };
  const native = {
    Animated: { createAnimatedComponent: type => type },
    Platform: { OS: os },
    Pressable: 'Pressable', Text: 'NativeText', TextInput: 'NativeTextInput', View: 'View',
    StyleSheet: { create: value => value, flatten: style => Array.isArray(style) ? Object.assign({}, ...style.map(item => native.StyleSheet.flatten(item) || {})) : style },
  };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/FontSize.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: output, exports: output.exports, require: name => {
    if (name === 'react') return { ...react, default: react };
    if (name === 'react-native') return native;
    if (name === 'expo-secure-store') return store;
    if (name === './fontScale') return { safeFontScale };
    assert.fail(name);
  } });
  const api = output.exports;
  const render = () => {
    at = 0;
    const root = api.FontSizeProvider({ children: 'app' });
    lastRoot = root;
    contexts[0].value = root.props.value;
    effects.splice(0).forEach(effect => effect());
    return root.props.value;
  };
  const unmount = () => cleanups.splice(0).forEach(fn => fn?.());
  return { api, render, contexts, root: () => lastRoot, unmount, restartEffects: () => {
    unmount();
    for (const cell of cells) if (cell?.called === true) cell.called = false;
    render();
  } };
}

test('saved Small uses the former Default and Default is larger across native text and input', async () => {
  for (const [saved, scale] of [['Small', 1], ['Default', 1.1], ['Large', 1.15], ['Extra large', 1.3], [null, 1.1], ['invalid', 1.1]]) {
    const h = mount({ getItemAsync: async () => saved, setItemAsync: async () => {} });
    h.render(); await flush();
    assert.equal(h.render().scale, scale);
    assert.equal(safeFontScale(scale), scale);
    for (const Component of [h.api.Text, h.api.TextInput]) {
      const element = Component({ style: { fontSize: 15, lineHeight: 23 } }, null);
      assert.equal(element.props.style.fontSize, 15 * scale);
      assert.equal(element.props.style.lineHeight, 23 * scale);
    }
    h.unmount();
  }
  for (const invalid of [0.9, NaN, Infinity, 100]) assert.equal(safeFontScale(invalid), 1);
});

test('cold restore is device-wide, invalid values fall back visibly, read failure is not silent', async () => {
  const storage = new Map();
  const store = { getItemAsync: async key => storage.get(key) ?? null, setItemAsync: async (key, value) => { storage.set(key, value); } };
  storage.set('hermes.interface_font_size.v1', 'Large');
  let h = mount(store);
  assert.equal(h.render().loading, true);
  assert.equal(h.root().props.children[0].type, 'View', 'app must wait for cold restore');
  await flush();
  assert.equal(h.render().choice, 'Large');
  assert.equal(h.root().props.children[0], 'app');
  assert.equal(h.render().scale, 1.15);
  h.unmount();
  storage.set('hermes.interface_font_size.v1', 'HUGE; color:red');
  h = mount(store); h.render(); await flush();
  assert.equal(h.render().choice, 'Default');
  assert.match(h.render().error, /not recognized/);
  h.unmount();
  h = mount({ ...store, getItemAsync: async () => { throw Error('disk'); } });
  h.render(); await flush();
  assert.equal(h.render().choice, 'Default');
  assert.match(h.render().error, /Could not load/);
  h.unmount();
});

test('immediate preview waits for durable write; failure reverts and is visible; retry succeeds', async () => {
  const write = deferred(), saved = [];
  const store = { getItemAsync: async () => 'Small', setItemAsync: (key, value) => { saved.push([key, value]); return saved.length === 1 ? write.promise : Promise.resolve(); } };
  const h = mount(store); h.render(); await flush();
  let value = h.render(); assert.equal(value.choice, 'Small');
  const pending = value.select('Extra large');
  value = h.render(); assert.equal(value.choice, 'Extra large'); assert.equal(value.saving, true); assert.equal(value.error, null);
  await flush(); assert.deepEqual(saved, [['hermes.interface_font_size.v1', 'Extra large']]);
  write.reject(Error('disk full')); await pending;
  value = h.render(); assert.equal(value.choice, 'Small'); assert.equal(value.saving, false);
  assert.match(value.error, /Could not save/);
  await value.select('Large');
  value = h.render(); assert.equal(value.choice, 'Large'); assert.equal(value.error, null);
  assert.deepEqual(saved.at(-1), ['hermes.interface_font_size.v1', 'Large']);
  h.unmount();
});

test('overlapping saves serialize; stale failure cannot roll back a newer choice', async () => {
  const first = deferred(), second = deferred(), calls = [];
  const store = { getItemAsync: async () => 'Default', setItemAsync: (key, value) => {
    calls.push(value); return calls.length === 1 ? first.promise : second.promise;
  } };
  const h = mount(store); h.render(); await flush();
  const p1 = h.render().select('Small'); await flush();
  const p2 = h.render().select('Large'); await flush();
  assert.deepEqual(calls, ['Small']);
  first.reject(Error('failed old write')); await flush();
  assert.equal(h.render().choice, 'Large'); assert.equal(h.render().error, null);
  assert.deepEqual(calls, ['Small', 'Large']);
  second.resolve(); await Promise.all([p1, p2]);
  assert.equal(h.render().saving, false); assert.equal(h.render().choice, 'Large');
  h.unmount();
});

test('newest failed save rolls back only to the most recently durable size', async () => {
  const first = deferred(), second = deferred(), calls = [];
  const h = mount({ getItemAsync: async () => 'Default', setItemAsync: (_key, value) => {
    calls.push(value); return calls.length === 1 ? first.promise : second.promise;
  } });
  h.render(); await flush();
  const p1 = h.render().select('Small'); await flush();
  const p2 = h.render().select('Extra large');
  first.resolve(); await p1; await flush();
  assert.equal(h.render().choice, 'Extra large');
  assert.equal(h.render().saving, true);
  second.reject(Error('disk full')); await p2;
  assert.equal(h.render().choice, 'Small');
  assert.match(h.render().error, /Could not save/);
  h.unmount();
});

test('late hydration never replaces a user choice and unmounted reads do not update', async () => {
  const read = deferred(), writes = [];
  const store = { getItemAsync: () => read.promise, setItemAsync: async (_key, value) => { writes.push(value); } };
  const h = mount(store); h.render();
  await h.render().select('Large');
  read.resolve('Small'); await flush();
  assert.equal(h.render().choice, 'Large'); assert.deepEqual(writes, ['Large']);
  h.unmount();
  const later = deferred(); const h2 = mount({ ...store, getItemAsync: () => later.promise });
  h2.render(); h2.unmount(); later.resolve('Extra large'); await flush();
  assert.equal(h2.render().choice, 'Default');
});

test('StrictMode effect remount ignores the earlier cold read and its loading completion', async () => {
  const first = deferred(), second = deferred(), reads = [first, second];
  const h = mount({ getItemAsync: () => reads.shift().promise, setItemAsync: async () => {} });
  h.render(); h.restartEffects();
  first.resolve('Small'); await flush();
  assert.equal(h.render().loading, true);
  assert.equal(h.render().choice, 'Default');
  second.resolve('Large'); await flush();
  assert.equal(h.render().loading, false);
  assert.equal(h.render().choice, 'Large');
  h.unmount();
});

test('native wrappers flatten styles, scale size and line height once, inherit nested size, retain accessibility scaling and refs', () => {
  const h = mount({ getItemAsync: async () => null, setItemAsync: async () => {} });
  h.render();
  const { api, contexts } = h;
  assert.equal(api.validFontSize('Large'), 'Large'); assert.equal(api.validFontSize('1.15'), 'Default');
  assert.equal(api.scaledTextStyle(undefined, 1), undefined);
  assert.equal(api.scaledTextStyle([{ fontSize: 15, lineHeight: 22 }, { color: 'red' }], 1.3).fontSize, 19.5);
  assert.equal(api.scaledTextStyle([{ fontSize: 15, lineHeight: 22 }, { color: 'red' }], 1.3).lineHeight, 28.6);
  assert.equal(api.scaledTextStyle({ fontWeight: '700' }, 1.3, true).fontSize, undefined);
  assert.equal(api.scaledTextStyle({ fontSize: 13 }, 1.3, true).fontSize, 16.900000000000002);
  assert.equal(api.scaledTextStyle(undefined, 1.3).fontSize, 22.1);
  contexts[0].value = { ...contexts[0].value, scale: 1.15 };
  const ref = { current: null };
  const text = api.Text({ style: [{ fontSize: 16, lineHeight: 20 }, { color: 'blue' }], children: 'hello', allowFontScaling: true, maxFontSizeMultiplier: 2 }, ref);
  assert.equal(text.type, 'NativeText'); assert.equal(text.props.ref, ref);
  assert.equal(text.props.style.fontSize, 18.4); assert.equal(text.props.style.lineHeight, 23);
  assert.equal(text.props.allowFontScaling, true); assert.equal(text.props.maxFontSizeMultiplier, 2);
  assert.equal(text.props.children[0].type.context, contexts[1]);
  contexts[1].value = true;
  const nested = api.Text({ style: { fontWeight: 'bold' }, children: 'child' }, ref);
  assert.equal(nested.props.style.fontSize, undefined);
  const input = api.TextInput({ style: { fontSize: 14, lineHeight: 21 }, value: 'draft' }, ref);
  assert.equal(input.type, 'NativeTextInput'); assert.equal(input.props.ref, ref);
  assert.equal(input.props.style.fontSize, 16.099999999999998); assert.equal(input.props.style.lineHeight, 24.15);
  assert.equal(input.props.value, 'draft'); assert.equal(input.props.allowFontScaling, undefined);
  h.unmount();
});

test('settings shows all options, live preview, loading and save failure without a false success label', async () => {
  const store = { getItemAsync: async () => 'Default', setItemAsync: async () => { throw Error('disk'); } };
  const h = mount(store); h.render(); await flush();
  const render = () => h.api.FontSizeSettings();
  const root = render();
  assert.equal(root.type, 'View');
  const [label, preview, options] = root.props.children;
  assert.equal(label.props.children[0], 'Interface font size');
  assert.match(preview.props.children[0], /Preview:/);
  const labels = options.props.children[0].map(option => option.props.children[0].props.children[0]);
  assert.deepEqual(Array.from(labels), ['Small', 'Default', 'Large', 'Extra large']);
  options.props.children[0][2].props.onPress();
  assert.equal(h.render().saving, true);
  await flush();
  assert.match(h.render().error, /Could not save/);
  assert.equal(h.render().saving, false);
  assert.equal(h.render().choice, 'Default');
  h.unmount();
});
