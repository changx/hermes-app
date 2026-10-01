import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';
import * as toolPresentation from '../../../packages/client/src/toolPresentation.ts';

// Transpile and execute the production component, with the production parser.
// This asserts the native tree and callbacks, not a simulated iPhone layout.
test('server Discord captions are used verbatim without duplicating file paths', () => {
  const h=mount('',{canExpand:true,toolCalls:[{id:'r',name:'read_file',label:'Read file',caption:'Reading a.py L10-12',icon:'📖',detail:'path=/very/long/workspace/src/a.py · offset=10 · limit=3'}]});
  const texts=h.walk(h.render(false)).filter(n=>n.type==='Text').map(n=>n.props.children.flat(Infinity).join('')).join(' ');
  assert.ok(texts.includes('Reading a.py L10-12'));
  assert.ok(!texts.includes('/very/long'));
  const button=h.walk(h.render(false)).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='View file details');
  button.props.onPress();
  assert.ok(h.walk(h.viewer()).find(n=>n.type==='WebView').props.source.html.includes('/very/long/workspace/src/a.py'));
  h.unmount();
});

test('file timeline keeps filename and line context while full article retains the safe path', () => {
  const detail = '/home/hermes/workspace/project/src/tenancy.py · offset=150 · limit=110';
  const h = mount('Checking files', { canExpand: true, toolCalls: [{ id: 'file', name: 'read_file', label: 'Read file', detail }] });
  const flatten = value => Array.isArray(value) ? value.map(flatten).join('') : value && typeof value === 'object' ? flatten(value.children ?? value.props?.children) : String(value ?? '');
  const text = flatten(h.render());
  assert.ok(text.includes('Reading tenancy.py L150-259'));
  assert.ok(!text.includes('/home/hermes/workspace'));
  const details = h.walk(h.render(false)).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'View file details');
  assert.ok(details);
  details.props.onPress();
  const web = h.walk(h.viewer()).find(n => n.type === 'WebView');
  assert.ok(web.props.source.html.includes(detail));
  h.unmount();
});

function mount(text, { canExpand = false, toolCalls, screen = { width: 390, height: 844 }, fontScale = 1, platform = 'ios' } = {}) {
  const copied = [], opened = [], players = [], paused = [];
  const webCalls = [], font = { scale: fontScale };
  const hooks = new Map(), playerBySrc = new Map();
  const appListeners = new Set(), viewerStack = [];
  let scope, index, visited;
  const slot = initial => {
    const cells = hooks.get(scope) || [];
    hooks.set(scope, cells);
    const at = index++;
    return cells[at] ??= { value: initial };
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: Symbol('fragment'), memo: f => f, useMemo: (fn, deps) => {
      const cell = slot(null);
      if (!cell.deps || deps.some((value, i) => value !== cell.deps[i])) { cell.value = fn(); cell.deps = deps; }
      return cell.value;
    },
    useRef: initial => { const cell = slot(initial); return { get current() { return cell.value; }, set current(value) { cell.value = value; } }; },
    useState: initial => { const cell = slot(initial); return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }]; },
    useEffect: (fn, deps) => {
      const cell = slot(null);
      if (!cell.deps || deps.some((value, i) => value !== cell.deps[i])) {
        cell.cleanup?.(); cell.cleanup = fn(); cell.deps = deps;
      }
    },
  };
  const native = {
    Platform: { OS: platform },
    Animated: { Text: 'Animated.Text', Value: class {
      interpolate(config) { return config; }
      setValue() {} stopAnimation() {}
    }, timing: () => ({ start() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    AppState: { addEventListener: (_, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } },
    StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
    useWindowDimensions: () => screen,
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal',
    Linking: { openURL: href => { opened.push(href); return Promise.resolve(); } },
  };
  const modules = { '../../../packages/client/src/toolPresentation': toolPresentation, react: { ...react, default: react }, 'react-native': native,
    './FontSize': { Text: native.Text, AnimatedText: native.Animated.Text, useFontSize: () => font },
    'expo-router': { useIsFocused: () => scope?.startsWith('viewer.') ? Number(scope.split('.')[1].split(':')[0]) === viewerStack.length - 1 : viewerStack.length === 0 },
    './Viewers': { useViewer: () => ({ openViewer: (title, content, onClose) => viewerStack.push({ title, content, onClose }) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 21, bottom: 13, left: 2, right: 3 }) },
    'expo-clipboard': { setStringAsync: value => { copied.push(value); return Promise.resolve(); } },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: (src, setup) => {
      if (playerBySrc.has(src)) return playerBySrc.get(src);
      const player = { src, pause: () => paused.push(src), addListener: (_, listener) => {
        player.status = listener; return { remove: () => { player.status = null; } };
      } }; setup(player); players.push(player); playerBySrc.set(src, player); return player;
    } },
    'react-native-webview': 'WebView',
    './markdownWeb': { renderMarkdownHtml: (kind, source, display, scale) => { webCalls.push({ kind, source, display, scale }); return `<!doctype html><meta charset="utf-8">${kind}:${JSON.stringify(source)}:display=${display}`; } },
    './messageMarkdown': { parseMessageMarkdown, safeLinkUrl: href => { try { const u = new URL(href); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !/[\s\\]/.test(href) ? u.href : null; } catch { return null; } } } };
  const articleOutput = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/articleHtml.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module: articleOutput, exports: articleOutput.exports, require: name => {
    if (name === 'expo-crypto') return { getRandomBytes: count => new Uint8Array(count).fill(42) };
    if (name === '../../../packages/client/src/toolPresentation') return toolPresentation;
    if (name === './markdownRenderer.generated') return { KATEX_CSS: '.katex{}', KATEX_SCRIPT: 'window.katex={}', MERMAID_SCRIPT: 'window.mermaid={}' };
    if (name === './messageMarkdown') return modules[name];
    if (name === './fontScale') return { safeFontScale: value => [0.9, 1, 1.15, 1.3].includes(value) ? value : 1 };
    throw Error(name);
  } });
  modules['./articleHtml'] = articleOutput.exports;
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/MessageContent.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const expand = (element, path = 'root') => {
    if (Array.isArray(element)) return element.flatMap((item, i) => expand(item, `${path}.${i}`));
    if (element === null || element === undefined || typeof element !== 'object') return element == null ? [] : [element];
    if (typeof element.type === 'function') {
      const previous = scope;
      scope = `${path}:${element.type.name}`; index = 0; visited.add(scope);
      const rendered = element.type(element.props);
      scope = previous;
      return expand(rendered, path);
    }
    return [{ ...element, children: expand(element.props?.children, `${path}.children`) }];
  };
  const walk = nodes => nodes.flatMap(node => node && typeof node === 'object' ? [node, ...walk(node.children)] : []);
  const renderOnce = () => {
    visited = new Set();
    const tree = expand({ type: output.exports.MessageContent, props: { text, canExpand, toolCalls } });
    const viewers = viewerStack.map((route, i) => expand(route.content, `viewer.${i}`));
    for (const [path, cells] of hooks) if (!visited.has(path)) {
      cells.forEach(cell => cell.cleanup?.()); hooks.delete(path);
    }
    return { tree, viewers };
  };
  let last;
  const render = (measure = true) => {
    last = renderOnce();
    if (!measure) return last.tree;
    const frames = walk([last.tree, ...last.viewers].flat()).filter(n => n.props.onLayout);
    frames.forEach(n => n.props.onLayout({ nativeEvent: { layout: { width: 320, height: n.props.style.height } } }));
    if (frames.length) last = renderOnce();
    return last.tree;
  };
  return { render, walk, copied, opened, players, paused, webCalls, font, setText: next => { text = next; }, background: () => appListeners.forEach(listener => listener('background')),
    viewer: () => { render(); return last.viewers.at(-1); }, viewerAt: i => { render(); return last.viewers[i]; }, viewers: viewerStack,
    close: () => { const route = viewerStack.pop(); route?.onClose?.(); render(); },
    unmount: () => { for (const cells of hooks.values()) cells.forEach(cell => cell.cleanup?.()); hooks.clear(); } };
}

for (const platform of ['ios', 'android']) test(`${platform}: code surfaces use explicit monospace fonts and distinct backgrounds`, () => {
  const h = mount('Prose `inline`\n\n```sh\nprintf single\n```\n\n```text\nii WW\n12 34\n```\n\n    indented\n\n> ordinary quote\n\n```mermaid\nflowchart LR\nA-->B\n```', {
    platform, toolCalls: [{ id: 'cmd', name: 'terminal', label: 'Run command', detail: 'printf tool' }],
  });
  const nodes = h.walk(h.render());
  const style = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
  const font = platform === 'ios' ? 'Menlo' : 'monospace';
  for (const value of ['inline', 'printf single\n', 'ii WW\n12 34\n', 'indented\n', 'printf tool', 'flowchart LR\nA-->B\n']) {
    const node = nodes.find(n => ['Text', 'Animated.Text'].includes(n.type) && n.children.includes(value));
    assert.ok(node, value);
    assert.equal(style(node).fontFamily, font, value);
    if (value === 'inline') assert.equal(style(node).backgroundColor, '#dce5f0');
    else assert.equal(node.props.selectable, true, value);
  }
  const boxes = nodes.filter(n => style(n).backgroundColor === '#e8eef6');
  assert.equal(boxes.length, 4, 'three code boxes and one tool command');
  assert.equal(nodes.filter(n => n.type === 'ScrollView' && n.props.horizontal).length, 3);
  const copies = nodes.filter(n => n.props.accessibilityLabel === 'Copy code');
  copies.forEach(n => n.props.onPress());
  assert.deepEqual(h.copied, ['printf single\n', 'ii WW\n12 34\n', 'indented\n']);
  const prose = nodes.find(n => n.children.includes('ordinary quote'));
  assert.equal(style(prose).fontFamily, undefined);
  h.unmount();
});

function findStyle(tree, predicate) {
  return tree.find(n => predicate(n.props?.style));
}

test('article and inline math receive live device font scale without reparsing message text', () => {
  const h = mount('Paragraph $x^2$ and `code`.\n\n```js\nconst n = 1;\n```', { canExpand: true, fontScale: 1.3 });
  h.render();
  assert.ok(h.webCalls.some(call => call.kind === 'math' && call.scale === 1.3));
  doubleTapArticle(h);
  assert.equal(h.viewers.at(-1).title, 'Message');
  assert.match(h.walk(h.viewer()).find(node => node.type === 'WebView').props.source.html, /:root\{--interface-scale:1\.3\}/);
  h.font.scale = 0.9;
  assert.match(h.walk(h.viewer()).find(node => node.type === 'WebView').props.source.html, /:root\{--interface-scale:0\.9\}/);
  h.close(); h.render();
  assert.ok(h.webCalls.some(call => call.kind === 'math' && call.scale === 0.9));
  h.unmount();
});

function doubleTapArticle(h) {
  const root = h.walk(h.render(false)).find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  const event = { nativeEvent: { target: 42, pageX: 80, pageY: 100, touches: [] } };
  for (let i = 0; i < 2; i++) {
    root.props.onTouchStart(event);
    root.props.onTouchEnd(event);
  }
}

test('routed article uses one default-menu WebView, without native paragraph-copy claims', () => {
  const h = mount('# 标题\n\n正文 **重点**\n\n| A | B |\n|---|---|\n|值|内容|', { canExpand: true });
  doubleTapArticle(h);
  const nodes = h.walk(h.viewer());
  assert.equal(h.viewers.at(-1).title, 'Message');
  assert.equal(h.walk(h.render()).filter(n => n.type === 'WebView').length, 0);
  const article = nodes.find(n => n.type === 'WebView');
  assert.ok(article);
  assert.match(article.props.source.html, /<h1>标题<\/h1>[\s\S]*<strong>重点<\/strong>[\s\S]*<table>/);
  assert.equal(article.props.menuItems, undefined);
  assert.equal(article.props.suppressMenuItems, undefined);
  assert.doesNotMatch(article.props.source.html, /user-select:\s*none|preventDefault\(\).*selection|contextmenu|document\.execCommand|clipboard\.writeText/i);
  assert.equal(article.props.onShouldStartLoadWithRequest({ url: 'https://example.com' }), false);
  assert.equal(article.props.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
  assert.equal(nodes.filter(n => n.type === 'Modal').length, 0);
  h.close();
  assert.equal(h.viewers.length, 0);
  assert.equal(h.walk(h.render()).filter(n => n.type === 'WebView').length, 0);
  h.unmount();
});

test('public tool summaries persist in article mode, never interpret command details as Markdown', () => {
  const toolCalls = [{ id: 'c1', name: 'terminal', label: '运行命令', detail: '[literal](https://example.com) && printf "**text**"' }];
  const h = mount('先检查 **项目**。', { canExpand: true, toolCalls });
  const flatten = value => Array.isArray(value) ? value.map(flatten).join('') : value && typeof value === 'object' ? flatten(value.children) : String(value ?? '');
  let nodes = h.walk(h.render());
  assert.equal(nodes.some(n => n.props.accessibilityRole === 'link'), false);
  assert.ok(flatten(h.render()).includes(toolCalls[0].detail));
  assert.equal(nodes.some(n => n.props.accessibilityLabel === '全屏查看消息'), false);
  doubleTapArticle(h);
  nodes = h.walk(h.viewer());
  assert.equal(h.viewers.at(-1).title, 'Message');
  const html = nodes.find(n => n.type === 'WebView').props.source.html;
  assert.match(html, /先检查 <strong>项目<\/strong>。/);
  assert.ok(html.includes('运行命令'));
  assert.ok(html.includes('[literal](https://example.com) &amp;&amp; printf &quot;**text**&quot;'));
  assert.doesNotMatch(html, /<a[^>]+literal/);
  h.close();
  assert.equal(h.viewers.length, 0);
  assert.ok(flatten(h.render()).includes(toolCalls[0].detail));
  h.unmount();
});

test('multiple tool calls use compact spacing but ordinary Markdown code keeps its padding', () => {
  const toolCalls = [
    { id: 'a', name: 'web_extract', label: '阅读网页', detail: 'https://example.com' },
    { id: 'b', name: 'terminal', label: '运行命令', detail: 'git status --short' },
  ];
  const h = mount('', { canExpand: true, toolCalls });
  const nodes = h.walk(h.render());
  const group = nodes.find(n => n.type === 'View' && n.props.onTouchStart && n.props.style?.gap === 4);
  assert.ok(group);
  assert.equal(group.props.style.paddingVertical, 0);
  assert.equal(group.children.length, 2);
  assert.ok(group.children.every(n => n.props.style.gap === 2));
  const labels = nodes.filter(n => n.type === 'Text' && n.props.numberOfLines === 1);
  assert.equal(labels.length, 2);
  assert.ok(labels[0].children.join('').includes('https://example.com'));
  assert.ok(labels.every(n => n.props.ellipsizeMode === 'tail'));
  const details = nodes.filter(n => n.type === 'View' && n.props.style?.backgroundColor === '#e8eef6');
  assert.equal(details.length, 1, 'only terminal commands get a separate block');
  for (const detail of details) {
    const text = detail.children.find(n => n.type === 'Text');
    const style = Object.assign({}, ...text.props.style);
    assert.equal(style.paddingVertical, 4);
    assert.equal(style.padding, 10, 'horizontal text padding remains readable');
    assert.equal(text.props.selectable, true, 'tool text uses the same native menu as prose');
    assert.equal(text.props.numberOfLines, 2);
    assert.equal(text.props.ellipsizeMode, 'tail');
  }
  assert.equal(nodes.some(n => n.props.accessibilityLabel === '复制整条消息'), false);
  assert.equal(nodes.filter(n => n.type === 'Modal').length, 0, 'no invisible toolbar modal');
  const code = mount('```sh\ngit status\n```');
  const codeText = code.walk(code.render()).find(n => n.type === 'Animated.Text' && n.props.selectable);
  const codeStyle = Object.assign({}, ...codeText.props.style);
  assert.equal(codeStyle.padding, 10);
  assert.equal(codeStyle.paddingVertical, undefined);
  h.unmount(); code.unmount();
});

test('production table stays bounded, scrolls horizontally and retains inline cells and code copy', () => {
  const text = '| left | **right** |\n|:---|---:|\n| x | [link](https://a.test) |\n\n```js\nconst x = 1;\n```';
  const h = mount(text);
  const nodes = h.walk(h.render());
  const frame = findStyle(nodes, s => s?.maxWidth === '100%' && s?.minWidth === 0 && s?.overflow === 'hidden');
  assert.equal(frame?.type, 'View');
  assert.equal(frame.props.style.width, '100%');
  assert.equal(frame.props.style.borderWidth, undefined, 'no full-width table outline');
  const grid = findStyle(nodes, s => s?.borderTopWidth === 1 && s?.borderLeftWidth === 1);
  assert.equal(grid.props.style.alignSelf, 'flex-start');
  assert.equal(grid.props.style.width, undefined, 'grid wraps actual columns');
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
  nodes.find(n => n.props.accessibilityLabel === 'Copy code').props.onPress();
  assert.equal(nodes.some(n => n.props.accessibilityLabel === '复制整条消息'), false);
  assert.deepEqual(h.copied, ['const x = 1;\n']);
});

test('tool text uses native copy without an extra window, press responder or saved coordinates', () => {
  const calls = [
    { id: 'a', name: 'web_extract', label: '阅读网页', detail: 'https://example.com/very/long/path/…  https://other.example', arguments: { raw: 'never-copy-this' } },
    { id: 'b', name: 'terminal', label: '运行命令', detail: 'git status --short\n  printf "长命令…"\n# server-truncated' },
  ];
  const screen = { width: 240, height: 200 };
  const h = mount('前言 **可选择**', { canExpand: true, toolCalls: calls, screen });
  const nodes = () => h.walk(h.render(false));
  const group = () => nodes().find(n => n.type === 'View' && n.props.style?.gap === 4);
  const check = () => {
    const children = h.walk([group()]);
    const texts = children.filter(n => n.type === 'Text');
    assert.equal(texts.length, 3);
    assert.ok(texts.every(n => n.props.selectable === true));
    assert.equal(texts[0].children.join(''), `📄 ${calls[0].label} ${calls[0].detail.replace(/\s+/g, ' ')}`);
    assert.equal(texts[2].children.join(''), calls[1].detail, 'full safe command reaches native text, including visually ellipsized lines');
    assert.equal(JSON.stringify(children).includes('never-copy-this'), false);
    assert.ok(children.every(n => n.type !== 'Modal' && n.type !== 'Pressable'));
    assert.ok(children.every(n => !n.props.onPress && !n.props.onLongPress && !n.props.onStartShouldSetResponder));
    assert.ok(children.every(n => n.props.style?.position !== 'absolute'));
    assert.equal(nodes().filter(n => n.type === 'Modal').length, 0);
    assert.equal(h.viewers.length, 0);
    assert.deepEqual(h.copied, [], 'native menu owns copying, not JS clipboard/focus actions');
  };
  check();
  for (let i = 0; i < 2; i++) group().props.onTouchStart({ stopPropagation() {} });
  check();
  screen.width = 390; screen.height = 844;
  check(); // No toolbar position survives a keyboard/viewport change.
  assert.ok(nodes().some(n => n.type === 'Animated.Text' && n.props.selectable));
  h.unmount();
});

test('full article tools remain HTML text, no copy bridge or extra toolbar route', () => {
  const calls = [{ id: 'safe', name: 'terminal', label: '运行命令', detail: 'printf "safe"' }];
  const h = mount('正文\n\n```sh\nprintf ok\n```', { canExpand: true, toolCalls: calls });
  const nodes = () => h.walk(h.render(false));
  doubleTapArticle(h);
  const inside = h.walk(h.viewer());
  assert.equal(h.viewers.at(-1).title, 'Message');
  const web = inside.find(n => n.type === 'WebView');
  assert.match(web.props.source.html, /<pre><code>printf ok\n<\/code><\/pre>/);
  assert.match(web.props.source.html, /<pre>printf &quot;safe&quot;<\/pre>/);
  assert.equal(inside.filter(n => n.type === 'Modal').length, 0);
  web.props.onMessage({ nativeEvent: { data: 'copy:0' } });
  assert.deepEqual(h.copied, []);
  h.close();
  assert.equal(h.viewers.length, 0);
  h.unmount();
});

test('three-column table fits measured phone width, keeps every cell and trailing prose', () => {
  const h = mount('先说：**中文结论。**所以继续。\n\n| 产品 | 收入 | 渠道 |\n|---|---|---|\n| 甲 | 未公开 | 官网 |\n| 乙 | 订阅 | 分享 |\n| 丙 | 积分 | 搜索 |\n\n**最后：**仍需验证。');
  let nodes = h.walk(h.render());
  const cellWidth = n => Object.assign({}, ...n.props.style.filter(Boolean)).width;
  const cells = () => nodes.filter(n => n.type === 'View' && n.props.style?.[0]?.width === 156);
  assert.equal(cells().length, 12);
  assert.equal(cellWidth(cells()[0]) * 3, 468, 'grid stays wider than phone viewport');
  const scroll = nodes.find(n => n.type === 'ScrollView' && n.props.horizontal);
  assert.equal(scroll.props.bounces, false);
  assert.equal(scroll.props.directionalLockEnabled, true);
  assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
  assert.equal(scroll.props.contentOffset, undefined, 'rerenders do not reset deliberate horizontal reading');
  const flattenText = value => Array.isArray(value) ? value.map(flattenText).join('') : value && typeof value === 'object' ? flattenText(value.children ?? value.props?.children) : String(value ?? '');
  const content = flattenText(h.render(false));
  assert.ok(content.includes('中文结论。'));
  assert.ok(content.includes('仍需验证。'));
  for (const value of ['产品', '收入', '渠道', '甲', '未公开', '官网', '乙', '订阅', '分享', '丙', '积分', '搜索']) assert.ok(content.includes(value), value);
  h.unmount();
});

test('article, table and Mermaid push native viewer routes; nested back retains the article', () => {
  const text = '开头。\n\n| 第一 | 第二 | 第三 |\n|---|---|---|\n| 甲 | 乙 | 丙 |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n结尾。';
  for (const canExpand of [false, true]) {
    const h = mount(text, { canExpand });
    h.render();
    const nodes = () => h.walk(h.render(false));
    const inside = () => h.walk(h.viewer());
    const button = (entries, label) => {
      const found = entries.find(n => n.props.accessibilityLabel === label);
      assert.ok(found, label); found.props.onPress();
    };
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1);
    assert.equal(nodes().some(n => n.type === 'Modal'), false);
    if (canExpand) {
      doubleTapArticle(h);
      assert.deepEqual(h.viewers.map(route => route.title), ['Message']);
      assert.equal(nodes().filter(n => n.type === 'WebView').length, 1, 'inline WebView remains mounted on blur');
      const articleBody = inside().find(n => n.type === 'View' && n.props.style?.backgroundColor === '#fff');
      assert.equal(articleBody.props.style.paddingHorizontal, undefined, 'article viewport reaches the side safe-area edges');
      assert.equal(articleBody.props.style.paddingBottom, undefined, 'article viewport reaches the bottom safe-area edge');
      const articleWeb = inside().find(n => n.type === 'WebView');
      assert.match(articleWeb.props.source.html, /body\{padding:4px 16px 36px;/, 'prose keeps its inset inside the document');
      assert.match(articleWeb.props.source.html, /开头。[\s\S]*<td>甲<\/td>[\s\S]*结尾。/);
      assert.match(articleWeb.props.source.html, /data-expand="0"[\s\S]*data-expand="1"/);
      articleWeb.props.onMessage({ nativeEvent: { data: 'expand:0' } });
      assert.deepEqual(h.viewers.map(route => route.title), ['Message', 'Table']);
      assert.equal(inside().filter(n => n.type === 'View' && n.props.style?.[0]?.width === 156).length, 6);
      assert.equal(h.walk(h.viewerAt(0)).filter(n => n.type === 'WebView').length, 1, 'covered article retains its WebView');
      h.close();
      assert.deepEqual(h.viewers.map(route => route.title), ['Message']);
      assert.ok(inside().some(n => n.type === 'WebView'), 'article resumes on native back');
      h.close();
      assert.equal(nodes().filter(n => n.type === 'WebView').length, 1);
    }
    button(nodes(), 'View table fullscreen');
    assert.equal(h.viewers.at(-1).title, 'Table');
    assert.ok(inside().some(n => n.type === 'ScrollView' && n.props.horizontal));
    assert.equal(inside().filter(n => n.type === 'View' && n.props.style?.[0]?.width === 156).length, 6);
    h.close();
    button(nodes(), 'View diagram fullscreen');
    assert.equal(h.viewers.at(-1).title, 'Diagram');
    let diagram = inside();
    const body = diagram.find(n => n.type === 'View' && n.props.style?.backgroundColor === '#fff');
    assert.equal(body.props.style.paddingBottom, 12);
    assert.equal(body.props.style.paddingHorizontal, 14);
    assert.equal(body.props.style.paddingTop, undefined, 'native header owns top inset');
    const frame = diagram.find(n => n.props.onLayout && n.props.style?.flex === 1);
    assert.ok(frame, 'full-height flex diagram, not fixed 220');
    frame.props.onLayout({ nativeEvent: { layout: { width: 340, height: 610 } } });
    diagram = inside();
    const expanded = diagram.find(n => n.type === 'WebView');
    assert.equal(Object.assign({}, ...expanded.props.style).height, 610);
    assert.equal(Object.assign({}, ...expanded.props.containerStyle).width, 340);
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1, 'native stack retains the inline renderer');
    h.close();
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1, 'inline reading resumes');
    h.unmount();
  }
});

test('article bridge accepts only bounded own-message indices and fails back to readable native blocks', () => {
  const text = '[安全链接](https://a.test/)\n\n| A | B |\n|---|---|\n| 一 | 二 |\n\n```mermaid\nflowchart LR\nA-->B\n```';
  const h = mount(text, { canExpand: true, toolCalls: [{ id: 'x', name: 'terminal', label: '运行命令', detail: 'safe' }] });
  doubleTapArticle(h);
  const inside = () => h.walk(h.viewer());
  const web = inside().find(n => n.type === 'WebView');
  for (const prop of ['domStorageEnabled', 'allowFileAccess', 'allowFileAccessFromFileURLs', 'allowUniversalAccessFromFileURLs', 'setSupportMultipleWindows', 'javaScriptCanOpenWindowsAutomatically', 'sharedCookiesEnabled', 'thirdPartyCookiesEnabled']) assert.equal(web.props[prop], false, prop);
  assert.deepEqual(Array.from(web.props.originWhitelist), ['*']);
  for (const data of ['copy:0', 'link:https://evil.test', 'link:1', 'link:01', 'expand:-1', 'expand:999', 'expand:000', 'expand:0;open', 'expand:9999999999']) web.props.onMessage({ nativeEvent: { data } });
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.copied, []);
  assert.ok(inside().some(n => n.type === 'WebView' && n.props.source.html === web.props.source.html));
  web.props.onMessage({ nativeEvent: { data: 'link:0' } });
  assert.deepEqual(h.opened, ['https://a.test/']);
  web.props.onMessage({ nativeEvent: { data: 'expand:1' } });
  assert.deepEqual(h.viewers.map(route => route.title), ['Message', 'Diagram']);
  assert.equal(inside().some(n => n.props.accessibilityLabel === 'Reset zoom'), false);
  assert.ok(inside().some(n => n.props.onLayout && n.props.style?.flex === 1), 'diagram is a child route');
  assert.equal(h.walk(h.viewerAt(0)).filter(n => n.type === 'WebView').length, 1);
  h.close();
  assert.ok(inside().some(n => n.type === 'WebView'), 'parent article survives child back');
  h.close();
  doubleTapArticle(h);
  const failed = inside().find(n => n.type === 'WebView');
  failed.props.onRenderProcessGone();
  assert.equal(inside().some(n => n.type === 'WebView'), false);
  const fallback = inside().find(n => n.type === 'ScrollView' && !n.props.horizontal);
  assert.equal(fallback.props.contentContainerStyle.paddingHorizontal, 14, 'native fallback keeps prose inset inside its scroll content');
  assert.equal(fallback.props.contentContainerStyle.paddingBottom, 28);
  assert.ok(inside().some(n => n.type === 'Text' && n.children.includes('This article could not load. Showing the standard view instead.')));
  assert.ok(inside().some(n => n.type === 'ScrollView' && n.props.horizontal), 'table not dropped on failure');
  h.unmount();
  const huge = mount('文'.repeat(200001), { canExpand: true });
  doubleTapArticle(huge);
  const nodes = huge.walk(huge.viewer());
  assert.equal(nodes.filter(n => n.type === 'WebView').length, 0);
  assert.ok(nodes.some(n => n.type === 'Text' && n.children.includes('This article is too long. Showing the standard view instead.')));
  huge.unmount();
});

test('streaming rerenders keep the opened article snapshot and route-scoped diagram', () => {
  const h = mount('Start.\n\n```mermaid\nflowchart LR\nA-->B\n```', { canExpand: true });
  doubleTapArticle(h);
  const article = h.walk(h.viewer()).find(n => n.type === 'WebView');
  h.setText('New streamed body.\n\n| X |\n|---|\n| Y |');
  assert.match(h.walk(h.viewer()).find(n => n.type === 'WebView').props.source.html, /Start\./);
  article.props.onMessage({ nativeEvent: { data: 'expand:0' } });
  assert.deepEqual(h.viewers.map(route => route.title), ['Message', 'Diagram']);
  assert.ok(h.walk(h.viewer()).some(n => n.props.onLayout && n.props.style?.flex === 1));
  h.close();
  assert.match(h.walk(h.viewer()).find(n => n.type === 'WebView').props.source.html, /Start\./);
  h.close();
  assert.ok(JSON.stringify(h.render()).includes('New streamed body.'));
  h.unmount();
});

test('article double tap needs same still text target; movement, cancellation and links do not open it', () => {
  const h = mount('普通文字 [链接](https://example.com)', { canExpand: true });
  const tree = () => h.walk(h.render(false));
  const root = () => tree().find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  const visible = () => h.viewers.length > 0;
  const event = (target = 17, x = 40, y = 50) => ({ nativeEvent: { target, pageX: x, pageY: y, touches: [] } });
  const tap = (target = 17, x = 40) => { root().props.onTouchStart(event(target, x)); root().props.onTouchEnd(event(target, x)); };
  tap(); assert.equal(visible(), false, 'one tap does nothing');
  tap(18); assert.equal(visible(), false, 'different target does nothing');
  root().props.onTouchStart(event()); root().props.onTouchMove(event(17, 70)); root().props.onTouchEnd(event());
  assert.equal(visible(), false, 'scroll gesture is not a tap');
  root().props.onTouchStart(event()); root().props.onTouchCancel(); root().props.onTouchEnd(event());
  assert.equal(visible(), false, 'cancelled touch is inert');
  root().props.onTouchStart(event());
  tree().find(n => n.props.accessibilityRole === 'link').props.onPressIn();
  root().props.onTouchEnd(event());
  assert.equal(visible(), false, 'link press takes precedence');
  tap(); assert.equal(visible(), false, 'first tap after link only primes double tap');
  tap(); assert.equal(visible(), true);
  h.close();
  assert.equal(visible(), false);
  h.unmount();
  const user = mount('普通文字');
  const userTree = user.walk(user.render(false));
  const userRoot = userTree.find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  for (let i = 0; i < 2; i++) { userRoot.props.onTouchStart(event()); userRoot.props.onTouchEnd(event()); }
  assert.equal(user.viewers.length, 0);
});

test('tool touch interrupts prose double tap and scroll never opens toolbar', () => {
  const h = mount('普通文字', { canExpand: true, toolCalls: [{ id: 't', name: 'terminal', label: '运行命令', detail: 'echo safe' }] });
  const nodes = () => h.walk(h.render(false));
  const root = () => nodes().find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  const group = () => nodes().find(n => n.type === 'View' && n.props.style?.gap === 4);
  const event = (x = 40, y = 50) => ({ nativeEvent: { target: 17, pageX: x, pageY: y, touches: [] } });
  const proseTap = () => { root().props.onTouchStart(event()); root().props.onTouchEnd(event()); };
  proseTap();
  let stopped = false;
  group().props.onTouchStart({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  proseTap();
  assert.equal(h.viewers.length, 0, 'tool touch resets prior prose tap');
  root().props.onTouchStart(event()); root().props.onTouchMove(event(40, 90)); root().props.onTouchEnd(event(40, 90));
  assert.equal(nodes().filter(n => n.type === 'Modal').length, 0, 'scroll opens no copy toolbar');
  assert.deepEqual(h.copied, []);
  h.unmount();
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
  assert.equal(nodes.filter(n => n.props.accessibilityLabel === 'Loading image: alt').length, 1);
});

test('video remains a fixed preview until tap, then native controls pause on background and unmount', () => {
  const h = mount('before ![clip](https://example.com/a.mp4) after');
  let tree = h.render(), nodes = h.walk(tree);
  assert.equal(nodes.filter(n => n.type === 'VideoView').length, 0);
  assert.equal(h.players.length, 0, 'no eager player or remote request');
  const play = nodes.find(n => n.props.accessibilityLabel === 'Play video: clip');
  assert.equal(nodes.find(n => n.props.style?.maxWidth === 280 && n.props.style?.backgroundColor === '#162132').props.style.height, 168);
  play.props.onPress();
  nodes = h.walk(h.render());
  const view = nodes.find(n => n.type === 'VideoView');
  assert.equal(view.props.nativeControls, true);
  assert.equal(h.players[0].src, 'https://example.com/a.mp4');
  assert.equal(h.players[0].loop, false);
  assert.equal(typeof h.players[0].play, 'undefined', 'component never starts playback');
  h.background();
  assert.ok(h.paused.length >= 2, 'setup and background pause');
  h.players[0].status({ status: 'error' });
  nodes = h.walk(h.render());
  assert.equal(nodes.filter(n => n.type === 'VideoView').length, 0);
  assert.ok(nodes.some(n => n.props.accessibilityLabel === 'Video failed to load. Tap to retry: clip'));
  assert.equal(h.players[0].status, null, 'listener cleaned on error');
  h.unmount();
  const bad = mount('![unsafe](https://u@example.com/a.mp4)');
  assert.equal(bad.walk(bad.render()).filter(n => n.type === 'VideoView').length, 0);
});

test('pushing a viewer pauses inline video without destroying its native player', () => {
  const h = mount('![clip](https://example.com/a.mp4)\n\n| A |\n|---|\n| B |');
  h.walk(h.render()).find(n => n.props.accessibilityLabel === 'Play video: clip').props.onPress();
  assert.equal(h.walk(h.render()).filter(n => n.type === 'VideoView').length, 1);
  const before = h.paused.length;
  h.walk(h.render()).find(n => n.props.accessibilityLabel === 'View table fullscreen').props.onPress();
  assert.equal(h.viewers.at(-1).title, 'Table');
  assert.equal(h.walk(h.render()).filter(n => n.type === 'VideoView').length, 1);
  assert.ok(h.paused.length > before, 'blur pauses native player');
  h.close();
  assert.equal(h.walk(h.render()).filter(n => n.type === 'VideoView').length, 1);
  h.unmount();
});

test('display math and Mermaid use isolated bounded native WebViews; oversized content falls back', () => {
  const h = mount('before $x^2$ after\n\n$$x^2$$ tail\n\n```mermaid\nflowchart LR\n甲-->乙\n```');
  const nodes = h.walk(h.render());
  const views = nodes.filter(n => n.type === 'WebView');
  assert.equal(views.length, 3);
  assert.ok(views[0].props.source.html.includes('math:"x^2"'));
  assert.ok(views[0].props.source.html.endsWith('display=false'));
  assert.ok(views[1].props.source.html.endsWith('display=true'));
  assert.ok(views[2].props.source.html.includes('diagram:"flowchart LR\\n甲-->乙\\n"'));
  for (const view of views) {
    assert.deepEqual(Array.from(view.props.originWhitelist), ['*'], 'all URLs reach our veto instead of WebView external Linking fallback');
    assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://example.com' }), false);
    assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'file:///etc/passwd' }), false);
    assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
    for (const prop of ['allowFileAccess', 'allowFileAccessFromFileURLs', 'allowUniversalAccessFromFileURLs', 'domStorageEnabled', 'sharedCookiesEnabled', 'thirdPartyCookiesEnabled', 'javaScriptCanOpenWindowsAutomatically', 'setSupportMultipleWindows']) assert.equal(view.props[prop], false, prop);
    const container = Object.assign({}, ...view.props.containerStyle);
    const native = Object.assign({}, ...view.props.style);
    assert.equal(container.width, 320);
    assert.ok([72, 220].includes(container.height));
    assert.equal(container.flex, 0, 'numeric wrapper dimensions');
    assert.equal(native.width, container.width);
    assert.equal(native.height, container.height);
    assert.equal(native.flex, 0);
  }
  assert.ok(nodes.some(n => n.type === 'View' && n.props.style?.height === 72), 'inline math has a compact stable frame');
  views[0].props.onMessage({ nativeEvent: { data: 'render-ready' } });
  assert.equal(h.walk(h.render()).filter(n => n.type === 'WebView').length, 3);
  views[0].props.onMessage({ nativeEvent: { data: 'render-failed' } });
  assert.equal(h.walk(h.render()).filter(n => n.type === 'WebView').length, 2);
  const failedDiagram = h.walk(h.render()).filter(n => n.type === 'WebView').at(-1);
  failedDiagram.props.onContentProcessDidTerminate();
  assert.equal(h.walk(h.render()).filter(n => n.type === 'WebView').length, 1);
  const huge = mount(`$$${'x'.repeat(4100)}$$`);
  assert.equal(huge.walk(huge.render()).filter(n => n.type === 'WebView').length, 0);
  assert.equal(huge.walk(huge.render()).find(n => n.type === 'ScrollView').props.style.height, 220);
});


test('native diagram waits for measured dimensions and keeps source until render acknowledgement', () => {
  const h = mount('```mermaid\nflowchart TD\nA-->B\n```');
  let nodes = h.walk(h.render(false));
  assert.equal(nodes.filter(n => n.type === 'WebView').length, 0);
  assert.ok(nodes.some(n => n.type === 'Text' && n.props.selectable), 'source visible before native layout');
  const frame = nodes.find(n => n.props.onLayout);
  for (const width of [0, -1, NaN]) frame.props.onLayout({ nativeEvent: { layout: { width, height: 220 } } });
  assert.equal(h.walk(h.render(false)).filter(n => n.type === 'WebView').length, 0);
  const event = { nativeEvent: { layout: { width: 262, height: 220 } } };
  frame.props.onLayout(event);
  event.nativeEvent = null;
  nodes = h.walk(h.render(false));
  const web = nodes.find(n => n.type === 'WebView');
  assert.equal(Object.assign({}, ...web.props.style).width, 262);
  assert.equal(Object.assign({}, ...web.props.containerStyle).height, 220);
  const hasSourceOverlay = () => h.walk(h.render(false)).some(n => n.props.style?.position === 'absolute');
  assert.equal(hasSourceOverlay(), true);
  web.props.onMessage({ nativeEvent: { data: '{"command":"open"}' } });
  assert.equal(hasSourceOverlay(), true, 'unknown messages do nothing');
  web.props.onMessage({ nativeEvent: { data: 'render-ready' } });
  assert.equal(hasSourceOverlay(), false);
  web.props.onMessage({ nativeEvent: { data: 'render-failed' } });
  nodes = h.walk(h.render(false));
  assert.equal(nodes.filter(n => n.type === 'WebView').length, 0);
  assert.ok(nodes.some(n => n.type === 'Text' && n.props.selectable));
});

test('Mermaid script failure retains selectable source as native content', () => {
  const source = 'flowchart LR\n甲-->乙';
  const h = mount(`\`\`\`mermaid\n${source}\n\`\`\``);
  const view = h.walk(h.render()).find(n => n.type === 'WebView');
  view.props.onMessage({ nativeEvent: { data: 'render-failed' } });
  const nodes = h.walk(h.render());
  assert.equal(nodes.filter(n => n.type === 'WebView').length, 0);
  const fallback = nodes.find(n => n.type === 'ScrollView');
  assert.equal(fallback.props.style.height, 220);
  assert.equal(fallback.children.find(n => n.type === 'Text').props.selectable, true);
  for (const callback of ['onError', 'onHttpError', 'onRenderProcessGone']) {
    const next = mount(`\`\`\`mermaid\n${source}\n\`\`\``);
    next.walk(next.render()).find(n => n.type === 'WebView').props[callback]();
    assert.equal(next.walk(next.render()).filter(n => n.type === 'WebView').length, 0, callback);
  }
});

test('installed WebView navigation wrapper never opens external apps with actual renderer props', async () => {
  const h = mount('$$x$$');
  const props = h.walk(h.render()).find(n => n.type === 'WebView').props;
  const output = { exports: {} }, attempted = [], decisions = [];
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL('../node_modules/react-native-webview/src/WebViewShared.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source + '\nexport { createOnShouldStartLoadWithRequest };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: output, exports: output.exports, require: name => {
    if (name === 'escape-string-regexp') return require(name);
    if (name === 'react-native') return { Linking: { canOpenURL: async url => { attempted.push(url); return true; }, openURL: async url => attempted.push(url) } };
    return {};
  } });
  const handler = output.exports.createOnShouldStartLoadWithRequest((allowed, url) => decisions.push([url, allowed]), props.originWhitelist, props.onShouldStartLoadWithRequest);
  for (const url of ['about:blank', 'https://example.com', 'file:///private/test', 'javascript:alert(1)', 'mailto:someone@example.com']) handler({ nativeEvent: { url, lockIdentifier: 1 } });
  await Promise.resolve();
  assert.deepEqual(attempted, []);
  assert.deepEqual(decisions.map(item => item[1]), [true, false, false, false, false]);
});

test('article WebView wrapper rejects all external navigation without Linking fallback', async () => {
  const h = mount('[外链](https://example.com)', { canExpand: true });
  doubleTapArticle(h);
  const props = h.walk(h.viewer()).find(n => n.type === 'WebView').props;
  const output = { exports: {} }, attempted = [], decisions = [];
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL('../node_modules/react-native-webview/src/WebViewShared.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source + '\nexport { createOnShouldStartLoadWithRequest };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: output, exports: output.exports, require: name => {
    if (name === 'escape-string-regexp') return require(name);
    if (name === 'react-native') return { Linking: { canOpenURL: async url => { attempted.push(url); return true; }, openURL: async url => attempted.push(url) } };
    return {};
  } });
  const handler = output.exports.createOnShouldStartLoadWithRequest((allowed, url) => decisions.push([url, allowed]), props.originWhitelist, props.onShouldStartLoadWithRequest);
  for (const url of ['about:blank', 'https://example.com', 'file:///private/test', 'javascript:alert(1)', 'mailto:a@example.com']) handler({ nativeEvent: { url, lockIdentifier: 1 } });
  await Promise.resolve();
  assert.deepEqual(attempted, []);
  assert.deepEqual(decisions.map(item => item[1]), [true, false, false, false, false]);
  h.unmount();
});

test('formula budget is shared across inline, nested list, table and display content without losing text', () => {
  const h = mount('**before $a$ after**\n\n- nested $b$\n\n| math |\n|---|\n| $c$ |\n\n$$d$$\n\n```mermaid\nflowchart LR\nA-->B\n```');
  const tree = h.render(), nodes = h.walk(tree);
  assert.equal(nodes.filter(n => n.type === 'WebView').length, 3);
  const text = nodes.filter(n => n.type === 'Text').flatMap(n => n.props.children).join(' ');
  assert.match(text, /d/);
  assert.match(text, /flowchart LR/);
  assert.equal(nodes.filter(n => n.type === 'Animated.Text' && n.props.style?.fontWeight === '700').length, 2);
  const nested = (entries, inText = false) => entries.forEach(n => {
    if (!n || typeof n !== 'object') return;
    assert.equal(inText && ['View', 'WebView', 'ScrollView'].includes(n.type), false);
    nested(n.children, inText || n.type === 'Text' || n.type === 'Animated.Text');
  });
  nested(tree);
});

test('mixed inline image loads automatically, keeps geometry on loading/error/retry; unsafe image stays inert', () => {
  const text = 'before **strong ![cat](https://example.com/cat.png) after**';
  const h = mount(text);
  let tree = h.render(), nodes = h.walk(tree);
  const frame = nodes.find(n => n.props.accessibilityLabel === 'Loading image: cat');
  assert.equal(nodes.filter(n => n.type === 'Image').length, 1);
  assert.equal(frame.props.style.height, 168);
  assert.equal(frame.props.style.maxWidth, 280);
  assert.equal(frame.props.style.width, '100%');
  assert.equal(nodes.filter(n => n.type === 'Animated.Text' && n.props.style?.fontWeight === '700').length, 2);
  const checkNesting = (entries, insideText = false) => {
    for (const n of entries) {
      if (!n || typeof n !== 'object') continue;
      assert.equal(insideText && ['View', 'Pressable', 'Image', 'VideoView', 'WebView'].includes(n.type), false, 'no native media inside Text');
      checkNesting(n.children, insideText || n.type === 'Text' || n.type === 'Animated.Text');
    }
  };
  checkNesting(tree);
  const image = nodes.find(n => n.type === 'Image');
  assert.equal(image.props.source.uri, 'https://example.com/cat.png');
  image.props.onError();
  tree = h.render(); nodes = h.walk(tree);
  assert.equal(nodes.filter(n => n.type === 'Image').length, 0);
  const retry = nodes.find(n => n.props.accessibilityLabel?.startsWith('Image failed to load. Tap to retry'));
  assert.equal(retry.props.style.height, 168);
  retry.props.onPress();
  nodes = h.walk(h.render());
  assert.equal(nodes.find(n => n.type === 'Image').props.key, 1);
  nodes.find(n => n.type === 'Image').props.onLoad();
  nodes = h.walk(h.render());
  assert.equal(nodes.find(n => n.type === 'Image').props.accessibilityLabel, 'cat');
  assert.equal(nodes.find(n => n.props.accessibilityLabel === 'Image: cat').props.style.height, 168);
  checkNesting(tree);
  const bad = mount('![unsafe](https://u@example.com/i.png)');
  const badNodes = bad.walk(bad.render());
  const fallback = badNodes.find(n => n.props.accessibilityLabel === 'Image unavailable: unsafe');
  assert.equal(fallback.props.disabled, true);
  assert.equal(badNodes.filter(n => n.type === 'Image').length, 0);
});
