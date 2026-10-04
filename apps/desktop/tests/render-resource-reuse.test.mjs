import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createMermaidLoader } from '../src/renderer/mermaid-engine.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('production desktop row defers first folded mount and retains the revealed subtree', async () => {
  let mounts = 0, releases = 0;
  const Content = () => { React.useEffect(() => { mounts++; return () => { releases++; }; }, []); return React.createElement('Content'); };
  const file = new URL('../src/renderer/shell.tsx', import.meta.url).pathname;
  const bundle = await build({ stdin: { contents: readFileSync(file, 'utf8') + '\nexport const TestRow = MessageRow;', resolveDir: dirname(file), loader: 'tsx' },
    bundle: true, jsx: 'automatic', platform: 'node', format: 'cjs', write: false, external: ['react', 'react/jsx-runtime', 'test-content'],
    plugins: [{ name: 'content-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/message-content$/ }, () => ({ path: 'content', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export { MessageContent } from "test-content";' }));
    } }] });
  const output = { exports: {} }, require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'test-content' ? { MessageContent: Content } : require(name), output, output.exports);
  const props = { message: { id: 'one', role: 'assistant', text: 'Graph', toolCalls: [], attachments: [] }, continuation: false };
  let root;
  await act(async () => { root = create(React.createElement(output.exports.TestRow, { ...props, hidden: true })); });
  assert.equal(mounts, 0); assert.equal(root.toJSON(), null);
  await act(async () => root.update(React.createElement(output.exports.TestRow, { ...props, hidden: false })));
  const content = root.root.findByType('Content'); assert.equal(mounts, 1);
  await act(async () => root.update(React.createElement(output.exports.TestRow, { ...props, hidden: true })));
  assert.equal(root.root.findByType('Content'), content); assert.equal(releases, 0);
  await act(async () => root.unmount()); assert.equal(releases, 1);
});

test('concurrent Mermaid consumers initialize the real loader once and keep security settings', async () => {
  let loads = 0, initializes = 0, config;
  const engine = { initialize(value) { initializes++; config = value; } };
  const get = createMermaidLoader(async () => { loads++; return { default: engine }; });
  const first = get(), second = get(); assert.equal(first, second);
  assert.equal(await first, engine); assert.equal(await get(), engine);
  assert.equal(loads, 1); assert.equal(initializes, 1);
  assert.equal(config.securityLevel, 'strict'); assert.equal(config.htmlLabels, false); assert.equal(config.maxTextSize, 20000);
});

test('a failed engine load retries; successful initialization is never replayed', async () => {
  let attempts = 0, initializes = 0;
  const get = createMermaidLoader(async () => { if (++attempts === 1) throw Error('fixture load failure'); return { default: { initialize() { initializes++; } } }; });
  await assert.rejects(get(), /fixture load failure/); await get(); await get();
  assert.equal(attempts, 2); assert.equal(initializes, 1);
});

test('production Markdown components retain code and diagram host identity when surrounding prose changes', async () => {
  let renders = 0, hosts = 0, initializations = 0;
  const get = createMermaidLoader(async () => ({ default: { initialize() { initializations++; }, async render() { renders++; return { svg: '<svg/>' }; } } }));
  const bundle = await build({ entryPoints: [new URL('../src/renderer/message-content.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react/jsx-runtime', 'test-engine'], plugins: [{ name: 'test-engine', setup(builder) {
      builder.onResolve({ filter: /mermaid-engine$/ }, () => ({ path: 'engine', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export { getMermaid } from "test-engine";', loader: 'js' }));
    } }] });
  const output = { exports: {} }, require = createRequire(import.meta.url);
  const svg = { tagName: 'svg', attributes: [], children: [], remove() {} };
  const Parser = class { parseFromString() { return { querySelector: () => null, documentElement: svg }; } };
  const Serializer = class { serializeToString() { return '<svg/>'; } };
  new Function('require', 'module', 'exports', 'DOMParser', 'XMLSerializer', bundle.outputFiles[0].text)(name => name === 'test-engine' ? { getMermaid: get } : require(name), output, output.exports, Parser, Serializer);
  const tree = prose => React.createElement(output.exports.MessageContent, { text: prose + '\n\n```mermaid\ngraph TD; A-->B\n```\n\n```js\nconst x = 1;\n```' });
  let root;
  await act(async () => { root = create(tree('Before'), { createNodeMock: node => node.type === 'div' && node.props.className === 'mermaid-diagram' ? { serial: ++hosts, replaceChildren() {}, innerHTML: '' } : null }); });
  const diagram = root.root.findAllByType('div').find(node => node.props.className === 'mermaid-diagram');
  const code = root.root.findAllByType('code').find(node => node.props.className === 'language-js');
  await act(async () => root.update(tree('After')));
  assert.equal(root.root.findAllByType('div').find(node => node.props.className === 'mermaid-diagram'), diagram);
  assert.equal(root.root.findAllByType('code').find(node => node.props.className === 'language-js'), code);
  assert.equal(hosts, 1); assert.equal(renders, 1); assert.equal(initializations, 1);
  await act(async () => root.unmount());
});
