import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';

// Transpile and execute the production component, with the production parser.
// This asserts the native tree and callbacks, not a simulated iPhone layout.
function mount(text) {
  let imageStatus;
  const copied = [], opened = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: Symbol('fragment'), memo: f => f, useMemo: f => f(),
    useRef: initial => ({ current: initial }), useEffect: () => {},
    useState: initial => [imageStatus ??= initial, next => { imageStatus = next; }],
  };
  const native = {
    Animated: { Text: 'Animated.Text', Value: class {
      interpolate(config) { return config; }
      setValue() {} stopAnimation() {}
    }, timing: () => ({ start() {} }) },
    AccessibilityInfo: {}, StyleSheet: { create: value => value },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView',
    Linking: { openURL: href => { opened.push(href); return Promise.resolve(); } },
  };
  const modules = { react: { ...react, default: react }, 'react-native': native,
    'expo-clipboard': { setStringAsync: value => { copied.push(value); return Promise.resolve(); } },
    './messageMarkdown': { parseMessageMarkdown } };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/MessageContent.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: output, exports: output.exports, require: name => modules[name] });
  const expand = element => {
    if (Array.isArray(element)) return element.flatMap(expand);
    if (element === null || element === undefined || typeof element !== 'object') return [];
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return [{ ...element, children: expand(element.props?.children) }];
  };
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children)]);
  const render = () => expand(output.exports.MessageContent({ text }));
  return { render, walk, copied, opened };
}

function findStyle(tree, predicate) {
  return tree.find(n => predicate(n.props?.style));
}

test('production table stays bounded, scrolls horizontally and retains inline cells and code copy', () => {
  const text = '| left | **right** |\n|:---|---:|\n| x | [link](https://a.test) |\n\n```js\nconst x = 1;\n```';
  const h = mount(text);
  const nodes = h.walk(h.render());
  const frame = findStyle(nodes, s => s?.maxWidth === '100%' && s?.borderRadius === 6);
  assert.equal(frame?.type, 'View');
  assert.equal(frame.props.style.width, '100%');
  const scrolls = nodes.filter(n => n.type === 'ScrollView');
  assert.equal(scrolls.length, 2);
  for (const scroll of scrolls) {
    assert.equal(scroll.props.horizontal, true);
    assert.equal(scroll.props.style.maxWidth, '100%');
  }
  const cells = nodes.filter(n => n.type === 'View' && n.props.style?.[0]?.width === 156);
  assert.equal(cells.length, 4);
  assert.ok(nodes.some(n => n.type === 'View' && n.props.style?.some?.(s => s?.alignItems === 'flex-end')), 'right-aligned cell');
  assert.ok(nodes.some(n => n.type === 'Animated.Text' && n.props.style?.fontWeight === '700'), 'strong formatting');
  const link = nodes.find(n => n.props.accessibilityRole === 'link');
  link.props.onPress();
  assert.deepEqual(h.opened, ['https://a.test/']);
  nodes.find(n => n.props.accessibilityLabel === '复制代码').props.onPress();
  nodes.find(n => n.props.accessibilityLabel === '复制整条消息').props.onPress();
  assert.deepEqual(h.copied, ['const x = 1;\n', text]);
});

test('real list checkbox tree is inert; ordinary [x] paragraph has no checkbox', () => {
  const h = mount('[x] ordinary\n\n- [x] done\n  - [ ] child\n- plain');
  const nodes = h.walk(h.render());
  const checks = nodes.filter(n => n.props.accessibilityRole === 'checkbox');
  assert.deepEqual(checks.map(n => n.props.accessibilityState.checked), [true, false]);
  assert.ok(checks.every(n => n.props.accessibilityState.disabled && !n.props.onPress));
  assert.equal(nodes.filter(n => n.props.accessibilityRole === 'checkbox').length, 2);
});

test('headings have distinct native sizes and an image inside a link sits outside Text', () => {
  const headings = mount(Array.from({ length: 6 }, (_, i) => `${'#'.repeat(i + 1)} heading`).join('\n\n'));
  const sizes = headings.walk(headings.render()).filter(n => n.type === 'Animated.Text' && n.props.selectable)
    .map(n => n.props.style[0]).map(style => style.at(-1).fontSize);
  assert.deepEqual(sizes, [21, 18, 17, 16, 15, 14]);
  const linked = mount('[before ![alt](https://example.com/x.png) after](https://example.com)');
  const nodes = linked.walk(linked.render());
  assert.equal(nodes.filter(n => n.props.accessibilityRole === 'link').length, 2);
  assert.equal(nodes.filter(n => n.props.accessibilityLabel === '加载图片：alt').length, 1);
});

test('mixed inline image requires tap, keeps geometry on loading/error; unsafe image stays inert', () => {
  const text = 'before **strong ![cat](https://example.com/cat.png) after**';
  const h = mount(text);
  let tree = h.render(), nodes = h.walk(tree);
  const button = nodes.find(n => n.props.accessibilityLabel === '加载图片：cat');
  assert.equal(nodes.filter(n => n.type === 'Image').length, 0);
  assert.equal(button.props.style.height, 168);
  assert.equal(button.props.style.maxWidth, 280);
  assert.equal(button.props.style.width, '100%');
  assert.equal(nodes.filter(n => n.type === 'Animated.Text' && n.props.style?.fontWeight === '700').length, 2);
  const checkNesting = (entries, insideText = false) => {
    for (const n of entries) {
      assert.equal(insideText && ['View', 'Pressable', 'Image'].includes(n.type), false, 'no native View/Image inside Text');
      checkNesting(n.children, insideText || n.type === 'Text' || n.type === 'Animated.Text');
    }
  };
  checkNesting(tree);
  button.props.onPress();
  tree = h.render(); nodes = h.walk(tree);
  const image = nodes.find(n => n.type === 'Image');
  assert.equal(image.props.source.uri, 'https://example.com/cat.png');
  assert.equal(nodes.find(n => n.props.accessibilityLabel === '图片加载中：cat').props.style.height, 168);
  checkNesting(tree);
  image.props.onError();
  nodes = h.walk(h.render());
  assert.equal(nodes.filter(n => n.type === 'Image').length, 0);
  assert.equal(nodes.find(n => n.props.accessibilityLabel?.startsWith('图片加载失败')).props.style.height, 168);
  nodes.find(n => n.props.accessibilityLabel?.startsWith('图片加载失败')).props.onPress();
  h.walk(h.render()).find(n => n.type === 'Image').props.onLoad();
  nodes = h.walk(h.render());
  assert.equal(nodes.find(n => n.type === 'Image').props.accessibilityLabel, 'cat');
  assert.equal(nodes.find(n => n.props.accessibilityLabel === '图片：cat').props.style.height, 168);
  const bad = mount('![unsafe](https://u@example.com/i.png)');
  const badNodes = bad.walk(bad.render());
  const fallback = badNodes.find(n => n.props.accessibilityLabel === '图片不可用：unsafe');
  assert.equal(fallback.props.disabled, true);
  assert.equal(badNodes.filter(n => n.type === 'Image').length, 0);
});
