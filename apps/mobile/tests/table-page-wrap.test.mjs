import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const copiedTexts = [];
const native = { Platform: { OS: 'ios' }, StyleSheet: { create: x => x }, View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Image: 'Image', Animated: { Text: 'Text' } };
const modules = {
  react: React, 'react-native': native,
  './FontSize': { Text: 'Text', AnimatedText: 'Text', useFontSize: () => ({ scale: 1 }) },
  'expo-clipboard': {}, 'expo-router': { useIsFocused: () => true },
  './sessionNavigation': { useSessionNavigation: () => ({}) },
  '../../../packages/client/src/sessionLinks': {}, 'expo-video': {},
  'react-native-webview': 'WebView', './messageMarkdown': {}, './markdownWeb': {}, './articleHtml': { ARTICLE_TEXT_LIMIT: 200000, renderArticleHtml: () => ({ html: '<article>Fixture</article>', links: [], expansions: [] }) },
  '../../../packages/client/src/toolPresentation': {}, './Viewers': {}, './RenderResources': { useRenderResources: () => null }, './reducedMotion': {},
  './CopyToast': { copyWithToast: async text => { copiedTexts.push(text); return true; } }, './openLink': { openLink: () => {} },
};
const output = { exports: {} };
// Test-only exports exercise the exact internal production components, not a replica.
const source = readFileSync(new URL('../src/MessageContent.tsx', import.meta.url), 'utf8') + '\nexport { MarkdownTable, ArticleContent };';
new Function('module', 'exports', 'require', ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText)(output, output.exports, name => name in modules ? modules[name] : require(name));
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const cases = [];
for (const platform of ['ios', 'android']) test(`${platform}: native Session and fullscreen tables fit local width and retain all cell text`, async () => {
  native.Platform.OS = platform;
  for (const fullscreen of [false, true]) for (const columns of [1, 2, 4, 8]) {
    const cell = i => ({ children: [{ kind: 'text', text: '中文长内容 unbroken'.repeat(20) + i }], align: i % 2 ? 'right' : 'center' });
    const block = { kind: 'table', header: Array.from({ length: columns }, (_, i) => cell(i)), rows: [Array.from({ length: columns }, (_, i) => cell(i + columns))] };
    let root;
    await act(async () => { root = create(React.createElement(output.exports.MarkdownTable, {
      block, fullscreen, tone: color => ({ color }), allowed: new WeakSet(), onExpand() {}, onInteraction() {},
    })); });
    try {
      assert.equal(root.root.findAllByType('ScrollView').length, 0, 'no horizontal table scroller');
      const viewport = () => root.root.findAllByType('View').find(node => node.props.onLayout);
      const originalTexts = root.root.findAllByType('Text');
      assert.equal(originalTexts.length, columns * 2 + (fullscreen ? 0 : 1));
      for (const width of [180, 240, 320, 390, 768, 320]) {
        await act(async () => viewport().props.onLayout({ nativeEvent: { layout: { width } } }));
        const cells = root.root.findAllByType('View').filter(node => flatten(node.props.style).borderRightWidth === 1);
        assert.equal(cells.length, columns * 2);
        for (const node of cells) {
          const style = flatten(node.props.style);
          assert.equal(style.minWidth, 0);
          assert.equal(style.flexBasis, 0);
          assert.ok(Math.abs(style.width - (width - 1) / columns) < 0.001);
          assert.ok(style.paddingHorizontal * 2 + 1 < style.width);
        }
        const texts = root.root.findAllByType('Text');
        texts.forEach((node, i) => assert.equal(node, originalTexts[i], 'width update retains text components'));
        assert.ok(texts.every(node => node.props.numberOfLines === undefined && node.props.ellipsizeMode === undefined), 'no truncation');
        const grid = root.root.findAllByType('View').find(node => flatten(node.props.style).borderLeftWidth === 1);
        assert.equal(flatten(grid.props.style).width, '100%');
        if (platform === 'ios' && !fullscreen) cases.push({ width, columns, viewport: flatten(viewport().props.style), grid: flatten(grid.props.style), row: flatten(cells[0].parent.props.style), cell: flatten(cells[0].props.style), content: flatten(cells[0].children[0].props.style) });
      }
      const before = flatten(root.root.findAllByType('View').find(node => flatten(node.props.style).borderRightWidth === 1).props.style).width;
      for (const width of [0, -1, Infinity, NaN]) await act(async () => viewport().props.onLayout({ nativeEvent: { layout: { width } } }));
      assert.equal(flatten(root.root.findAllByType('View').find(node => flatten(node.props.style).borderRightWidth === 1).props.style).width, before);
    } finally { await act(async () => root.unmount()); }
  }
  if (platform === 'ios' && process.env.HERMES_TABLE_LAYOUT_CAPTURE) writeFileSync(process.env.HERMES_TABLE_LAYOUT_CAPTURE, JSON.stringify(cases));
});

test('full article WebView failure uses the same bounded native table, without dropping text', async () => {
  const block = { kind: 'table', header: [{ children: [{ kind: 'text', text: 'Title' }] }], rows: [[{ children: [{ kind: 'text', text: 'Full source stays visible' }] }]] };
  let root;
  await act(async () => { root = create(React.createElement(output.exports.ArticleContent, { text: 'Source', blocks: [block], onExpand() {}, tone: color => ({ color }), allowed: new WeakSet() })); });
  try {
    await act(async () => root.root.findByType('WebView').props.onError());
    assert.equal(root.root.findAllByType('WebView').length, 0);
    const viewport = root.root.findAllByType('View').find(node => node.props.onLayout);
    await act(async () => viewport.props.onLayout({ nativeEvent: { layout: { width: 280 } } }));
    const cells = root.root.findAllByType('View').filter(node => flatten(node.props.style).borderRightWidth === 1);
    assert.equal(cells.length, 2);
    assert.ok(cells.every(node => flatten(node.props.style).width === 279));
    assert.ok(root.root.findAllByType('Text').some(node => node.props.children?.props?.nodes?.[0]?.text === 'Full source stays visible'));
    assert.ok(root.root.findAllByType('ScrollView').every(node => !node.props.horizontal));
  } finally { await act(async () => root.unmount()); }
});

test('inline code in a cell copies on tap; inline code inside a link keeps the link', async () => {
  copiedTexts.length = 0;
  let interactions = 0;
  const cell = children => ({ children, align: null });
  const block = { kind: 'table', header: [cell([{ kind: 'text', text: 'Run ' }, { kind: 'code', text: 'npm test' }])],
    rows: [[cell([{ kind: 'link', href: 'https://example.com', children: [{ kind: 'code', text: 'linked' }] }])]] };
  let root;
  await act(async () => { root = create(React.createElement(output.exports.MarkdownTable, {
    block, fullscreen: true, tone: color => ({ color }), allowed: new WeakSet(), onExpand() {}, onInteraction() { interactions++; },
  })); });
  try {
    const code = root.root.findAllByType('Text').find(node => node.props.children === 'npm test');
    assert.equal(code.props.accessibilityRole, 'button');
    await act(async () => code.props.onPress());
    assert.deepEqual(copiedTexts, ['npm test']);
    assert.ok(interactions > 0, 'tap cancels the double-tap expand gesture');
    const linked = root.root.findAllByType('Text').find(node => node.props.children === 'linked');
    assert.equal(linked.props.onPress, undefined);
    assert.equal(linked.parent.parent.props.accessibilityRole, 'link');
  } finally { await act(async () => root.unmount()); }
});
