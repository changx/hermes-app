import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The native module is the only boundary: a fake stands in for expo-alternate-app-icons.
const state = { module: null };
globalThis.__appIconTest = state;
const mocks = {
  'react-native': `export const Image='Image',Pressable='Pressable',View='View'; export const StyleSheet={create:x=>x};`,
  expo: `export const requireOptionalNativeModule=name=>name==='ExpoAlternateAppIcons'?globalThis.__appIconTest.module:null;`,
  './FontSize': `export const Text='Text';`,
};
const load = async () => {
  const bundle = await build({ entryPoints: [new URL('../src/AppIcon.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'],
    loader: { '.png': 'empty' }, plugins: [{ name: 'boundary', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const fake = (name = null, fail = false) => ({
  name, calls: [], supportsAlternateIcons: true,
  getAppIconName() { return this.name; },
  async setAlternateAppIcon(next) { this.calls.push(next); if (fail) throw new Error('native detail'); this.name = next; return next; },
});
const radios = root => root.root.findAll(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio');
const selected = root => radios(root).filter(node => node.props.accessibilityState.selected).map(node => node.props.accessibilityLabel);
const texts = root => root.root.findAllByType('Text').map(node => [].concat(node.props.children).join(''));

function Probe({ out }) { out.value = mod.useAppIcon(); return null; }
let mod;

test('Without the native module (Expo Go) the setting is unavailable', async () => {
  state.module = null; mod = await load();
  const out = {}; let root; await act(async () => { root = create(React.createElement(Probe, { out })); });
  assert.equal(out.value.available, false);
  assert.equal(out.value.current, 'mochi');
  root.unmount();
});

test('Current icon comes from the system; choices map to the app.json names', async () => {
  state.module = fake('Orb'); mod = await load();
  let root; await act(async () => { root = create(React.createElement(mod.AppIconSettings)); });
  assert.deepEqual(radios(root).map(node => node.props.accessibilityLabel), ['Mochi', 'Bubble', 'Orb']);
  assert.deepEqual(selected(root), ['Orb']);
  await act(async () => radios(root).find(node => node.props.accessibilityLabel === 'Bubble').props.onPress());
  assert.deepEqual(state.module.calls, ['Bubble']);
  assert.deepEqual(selected(root), ['Bubble']);
  await act(async () => radios(root).find(node => node.props.accessibilityLabel === 'Mochi').props.onPress());
  assert.deepEqual(state.module.calls, ['Bubble', null], 'Mochi resets to the primary icon');
  assert.deepEqual(selected(root), ['Mochi']);
  assert.ok(radios(root).find(node => node.props.accessibilityLabel === 'Mochi').props.disabled, 'current choice is not pressable again');
  root.unmount();
});

test('A failed change keeps the real current icon and explains without technical detail', async () => {
  state.module = fake(null, true); mod = await load();
  let root; await act(async () => { root = create(React.createElement(mod.AppIconSettings)); });
  await act(async () => radios(root).find(node => node.props.accessibilityLabel === 'Orb').props.onPress());
  assert.deepEqual(selected(root), ['Mochi']);
  const all = texts(root).join('\n');
  assert.ok(all.includes('Could not change the app icon. Your current icon is still in use.'));
  assert.ok(!all.includes('native detail'));
  root.unmount();
});

test('app.json declares exactly the alternate names the picker uses, with existing files', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const plugin = config.plugins.find(entry => Array.isArray(entry) && entry[0] === 'expo-alternate-app-icons');
  assert.ok(plugin, 'plugin configured');
  assert.deepEqual(plugin[1].map(icon => icon.name), ['Bubble', 'Orb']);
  for (const icon of plugin[1]) for (const file of [icon.ios, icon.android.foregroundImage, icon.android.backgroundImage]) {
    assert.ok(readFileSync(new URL('../' + file.replace(/^\.\//, ''), import.meta.url)).length > 1000, file);
  }
});
