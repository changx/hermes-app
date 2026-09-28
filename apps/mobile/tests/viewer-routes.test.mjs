import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { routeId } from '../src/routeId.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL('../src/Viewers.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  esModuleInterop: true,
} }).outputText;

function harness({ failPush = false } = {}) {
  const routes = [], releases = [];
  let sequence = 0, api;
  const Params = React.createContext({});
  const router = { push: route => { if (failPush) throw Error('navigation unavailable'); routes.push(route); } };
  const exports = {};
  runInNewContext(code, { exports, queueMicrotask, require: name => {
    if (name === 'react') return React;
    if (name === 'expo-router') return { Stack: { Screen: () => null }, useRouter: () => router, useLocalSearchParams: () => React.useContext(Params) };
    if (name === 'expo-crypto') return { randomUUID: () => `opaque-${++sequence}` };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === './FontSize') return { Text: 'Text' };
    if (name === './routeId') return { routeId };
    throw Error(name);
  } });
  function Capture() { api = exports.useViewer(); return null; }
  let root;
  const tree = (ids, identity) => React.createElement(React.StrictMode, {},
    React.createElement(exports.ViewerProvider, { key: identity }, React.createElement(Capture), ...ids.map(id =>
      React.createElement(Params.Provider, { key: id, value: { id } }, React.createElement(exports.ViewerScreen)))));
  return {
    routes, releases,
    get api() { return api; }, get root() { return root; },
    async render(ids = [], identity = 'connection-a') {
      await act(async () => { if (root) root.update(tree(ids, identity)); else root = create(tree(ids, identity)); });
    },
    async open(title, content) {
      await act(async () => { api.openViewer(title, content, () => releases.push(title)); });
      return routes.at(-1).params.id;
    },
    async close() { await act(async () => root.unmount()); },
  };
}

test('native viewer routes contain only opaque IDs; nested screens retain real component state until pop', async () => {
  const h = harness();
  let instance, serial = 0;
  function Article() {
    const [id] = React.useState(() => ++serial);
    const [position, scroll] = React.useState(0);
    instance = { id, position, scroll };
    return React.createElement('Article', { id, position });
  }
  await h.render();
  const article = await h.open('Private message', React.createElement(Article));
  assert.equal(Object.keys(h.routes[0].params).join(), 'id');
  assert.equal(h.routes[0].pathname, '/viewer/[id]');
  assert.ok(!JSON.stringify(h.routes).includes('Private message'));
  await h.render([article]);
  const originalId = instance.id;
  await act(async () => instance.scroll(380));
  const table = await h.open('Table', React.createElement('Table'));
  await h.render([article, table]);
  assert.equal(instance.id, originalId);
  assert.equal(instance.position, 380);
  assert.deepEqual(h.releases, []);
  await h.render([article]);
  assert.equal(instance.id, originalId);
  assert.equal(instance.position, 380);
  assert.deepEqual(h.releases, ['Table']);
  assert.equal(h.api.entries.size, 1);
  await h.render([]);
  assert.deepEqual(h.releases, ['Table', 'Private message']);
  assert.equal(h.api.entries.size, 0);
  await h.close();
  assert.deepEqual(h.releases, ['Table', 'Private message']);
});

test('production expanded article stays mounted and retains its scroll state while covered by a child route', async () => {
  const source = ts.createSourceFile('MessageContent.tsx', readFileSync(new URL('../src/MessageContent.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExpandedContent');
  assert.ok(component);
  const Focus = React.createContext(true);
  let serial = 0, article;
  function ArticleContent() {
    const [id] = React.useState(() => ++serial), [scroll, setScroll] = React.useState(0);
    article = { id, scroll, setScroll };
    return React.createElement('Article', { id, scroll });
  }
  const context = { React, ArticleContent, useIsFocused: () => React.useContext(Focus), View: 'View', ScrollView: 'ScrollView',
    MarkdownTable: 'Table', RenderBlock: 'Diagram', styles: {} };
  runInNewContext(ts.transpileModule(component.getText(source) + '\nglobalThis.Expanded = ExpandedContent;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
  const tree = focused => React.createElement(Focus.Provider, { value: focused }, React.createElement(context.Expanded, {
    target: { kind: 'message' }, text: 'article', blocks: [], onExpand() {}, tone: () => ({}), allowed: new WeakSet(),
  }));
  let root;
  await act(async () => { root = create(tree(true)); });
  const id = article.id;
  await act(async () => article.setScroll(380));
  await act(async () => root.update(tree(false)));
  assert.equal(root.root.findAllByType('Article').length, 1);
  await act(async () => root.update(tree(true)));
  assert.equal(article.id, id);
  assert.equal(article.scroll, 380);
  await act(async () => root.unmount());
});

test('identity reset releases active and pending viewer resources once and exposes no old content', async () => {
  const h = harness();
  await h.render();
  const image = await h.open('Image', React.createElement('Image'));
  await h.render([image]);
  await h.open('Pending image', React.createElement('Image'));
  await h.render([], 'connection-b');
  assert.deepEqual(h.releases.sort(), ['Image', 'Pending image']);
  assert.equal(h.api.entries.size, 0);
  await h.render([image], 'connection-b');
  assert.ok(JSON.stringify(h.root.toJSON()).includes('no longer available'));
  await h.close();
  assert.equal(h.releases.length, 2);
});

test('cold or malformed viewer links show a safe unavailable state', async () => {
  const h = harness();
  await h.render(['../file-secret']);
  assert.ok(JSON.stringify(h.root.toJSON()).includes('no longer available'));
  assert.ok(!JSON.stringify(h.root.toJSON()).includes('file-secret'));
  await h.close();
});

test('failed navigation releases the private payload and owned file immediately', async () => {
  const h = harness({ failPush: true });
  await h.render();
  assert.throws(() => h.api.openViewer('Image', React.createElement('Image'), () => h.releases.push('Image')), /navigation unavailable/);
  assert.equal(h.api.entries.size, 0);
  assert.deepEqual(h.releases, ['Image']);
  await h.close();
});

test('route parameter replacement releases the old viewer without destroying the new one', async () => {
  const h = harness();
  await h.render();
  const first = await h.open('First', React.createElement('Image'));
  await h.render([first]);
  const second = await h.open('Second', React.createElement('Image'));
  await h.render([second]);
  assert.deepEqual(h.releases, ['First']);
  assert.equal(h.api.entries.size, 1);
  await h.close();
  assert.deepEqual(h.releases, ['First', 'Second']);
});
