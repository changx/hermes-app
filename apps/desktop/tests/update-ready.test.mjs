import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export { updateReadyVersion } from './src/main/app-menu.ts'; export { UpdateReadyButton } from './src/renderer/update-ready.tsx';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'], jsx: 'automatic', write: false });
const module = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { updateReadyVersion, UpdateReadyButton } = module.exports;
const React = require('react');
const renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('title-bar version only while an update is ready', () => {
  for (const phase of ['unsupported', 'idle', 'checking', 'downloading', 'preparing', 'error'])
    assert.equal(updateReadyVersion({ phase, version: '0.1.138', available: '0.1.139' }), undefined, phase);
  assert.equal(updateReadyVersion({ phase: 'ready', version: '0.1.138', available: '0.1.139' }), '0.1.139');
  assert.equal(updateReadyVersion({ phase: 'ready', version: '0.1.138' }), '');
});

test('button: hidden without a ready update, a click restarts', async () => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(UpdateReadyButton, { version: undefined, onRestart() {} })); });
  assert.equal(tree.toJSON(), null);
  let restarts = 0;
  await renderer.act(async () => { tree.update(React.createElement(UpdateReadyButton, { version: '0.1.139', onRestart: () => restarts++ })); });
  const button = tree.root.findByType('button');
  assert.equal(button.props.children, 'Update ready · Restart');
  assert.match(button.props['aria-label'], /0\.1\.139/);
  assert.match(button.props.title, /Hermes 0\.1\.139 is downloaded/);
  await renderer.act(async () => button.props.onClick());
  assert.equal(restarts, 1);
  tree.unmount();
});
