import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';

// Transpile and execute the production component, with the production parser.
// This asserts the native tree and callbacks, not a simulated iPhone layout.
function mount(text, { canExpand = false } = {}) {
  const copied = [], opened = [], players = [], paused = [];
  const hooks = new Map(), playerBySrc = new Map();
  const appListeners = new Set();
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
    Animated: { Text: 'Animated.Text', Value: class {
      interpolate(config) { return config; }
      setValue() {} stopAnimation() {}
    }, timing: () => ({ start() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    AppState: { addEventListener: (_, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } },
    StyleSheet: { create: value => value },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal',
    Linking: { openURL: href => { opened.push(href); return Promise.resolve(); } },
  };
  const modules = { react: { ...react, default: react }, 'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 21, bottom: 13, left: 2, right: 3 }) },
    'expo-clipboard': { setStringAsync: value => { copied.push(value); return Promise.resolve(); } },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: (src, setup) => {
      if (playerBySrc.has(src)) return playerBySrc.get(src);
      const player = { src, pause: () => paused.push(src), addListener: (_, listener) => {
        player.status = listener; return { remove: () => { player.status = null; } };
      } }; setup(player); players.push(player); playerBySrc.set(src, player); return player;
    } },
    'react-native-webview': 'WebView',
    './markdownWeb': { renderMarkdownHtml: (kind, source, display) => `<!doctype html><meta charset="utf-8">${kind}:${JSON.stringify(source)}:display=${display}` },
    './messageMarkdown': { parseMessageMarkdown } };
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
    const tree = expand({ type: output.exports.MessageContent, props: { text, canExpand } });
    for (const [path, cells] of hooks) if (!visited.has(path)) {
      cells.forEach(cell => cell.cleanup?.()); hooks.delete(path);
    }
    return tree;
  };
  const render = (measure = true) => {
    const tree = renderOnce();
    if (!measure) return tree;
    const frames = walk(tree).filter(n => n.props.onLayout);
    frames.forEach(n => n.props.onLayout({ nativeEvent: { layout: { width: 320, height: n.props.style.height } } }));
    return frames.length ? renderOnce() : tree;
  };
  return { render, walk, copied, opened, players, paused, background: () => appListeners.forEach(listener => listener('background')),
    unmount: () => { for (const cells of hooks.values()) cells.forEach(cell => cell.cleanup?.()); hooks.clear(); } };
}

function findStyle(tree, predicate) {
  return tree.find(n => predicate(n.props?.style));
}

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
  nodes.find(n => n.props.accessibilityLabel === '复制代码').props.onPress();
  nodes.find(n => n.props.accessibilityLabel === '复制整条消息').props.onPress();
  assert.deepEqual(h.copied, ['const x = 1;\n', text]);
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

test('production controls open one safe-area modal for article, table and Mermaid; close releases expanded WebView', () => {
  const text = '开头。\n\n| 第一 | 第二 | 第三 |\n|---|---|---|\n| 甲 | 乙 | 丙 |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n结尾。';
  for (const canExpand of [false, true]) {
    const h = mount(text, { canExpand });
    h.render(); // Mount the inline WebView first; opening must release it.
    const nodes = () => h.walk(h.render(false));
    const button = (entries, label) => {
      const found = entries.find(n => n.props.accessibilityLabel === label);
      assert.ok(found, label); found.props.onPress();
    };
    const modal = () => nodes().find(n => n.type === 'Modal');
    const inside = () => h.walk([modal()]);
    assert.equal(modal().props.visible, false);
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1);
    assert.equal(nodes().some(n => n.props.accessibilityLabel === '全屏查看消息'), canExpand);
    if (canExpand) {
      button(nodes(), '全屏查看消息');
      assert.equal(modal().props.visible, true);
      assert.equal(nodes().filter(n => n.type === 'Modal').length, 1);
      assert.equal(nodes().filter(n => n.type === 'WebView').length, 0, 'underlying WebView is suspended until modal content measures');
      const article = inside();
      const leaves = value => Array.isArray(value) ? value.map(leaves).join('') : value && typeof value === 'object' ? leaves(value.children ?? value.props?.children) : String(value ?? '');
      const words = article.filter(n => n.type === 'Animated.Text').map(n => leaves(n.children)).join('');
      assert.ok(words.includes('开头。') && words.includes('结尾。') && words.includes('甲'));
      assert.ok(article.some(n => n.props.accessibilityLabel === '全屏查看表格'));
      assert.ok(article.some(n => n.props.accessibilityLabel === '全屏查看图表'));
      button(article, '全屏查看表格');
      assert.equal(inside().filter(n => n.type === 'Modal').length, 1, 'switches target rather than nesting dialogs');
      assert.ok(inside().some(n => n.type === 'ScrollView' && n.props.horizontal));
      modal().props.onRequestClose();
      assert.equal(modal().props.visible, false, 'Android back closes same modal');
    }
    button(nodes(), '全屏查看表格');
    assert.ok(inside().some(n => n.type === 'ScrollView' && n.props.horizontal));
    assert.equal(inside().filter(n => n.type === 'View' && n.props.style?.[0]?.width === 156).length, 6);
    button(inside(), '关闭全屏查看');
    assert.equal(modal().props.visible, false);
    button(nodes(), '全屏查看图表');
    let diagram = inside();
    const modalBody = diagram.find(n => n.type === 'View' && Array.isArray(n.props.style) && n.props.style[0]?.backgroundColor === '#fff');
    assert.deepEqual({ ...modalBody.props.style[1] }, { paddingTop: 33, paddingBottom: 25, paddingLeft: 16, paddingRight: 17 });
    const frame = diagram.find(n => n.props.onLayout && n.props.style?.flex === 1);
    assert.ok(frame, 'full-height flex diagram, not fixed 220');
    frame.props.onLayout({ nativeEvent: { layout: { width: 340, height: 610 } } });
    diagram = inside();
    const expanded = diagram.find(n => n.type === 'WebView');
    assert.equal(Object.assign({}, ...expanded.props.style).height, 610);
    assert.equal(Object.assign({}, ...expanded.props.containerStyle).width, 340);
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1, 'never duplicates inline and expanded WebViews');
    button(diagram, '关闭全屏查看');
    assert.equal(modal().props.visible, false);
    assert.equal(nodes().filter(n => n.type === 'WebView').length, 1, 'expanded instance releases; underlying reading resumes');
    h.unmount();
  }
});

test('article double tap needs same still text target; movement, cancellation and links do not open it', () => {
  const h = mount('普通文字 [链接](https://example.com)', { canExpand: true });
  const tree = () => h.walk(h.render(false));
  const root = () => tree().find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  const visible = () => tree().find(n => n.type === 'Modal').props.visible;
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
  tap();
  let stopped = false;
  tree().find(n => n.props.accessibilityLabel === '复制整条消息').props.onTouchStart({ stopPropagation() { stopped = true; } });
  root().props.onTouchEnd(event());
  tap(); assert.equal(visible(), false, 'copy breaks the double-tap sequence');
  assert.equal(stopped, true, 'copy does not bubble to article gesture');
  tap(); assert.equal(visible(), true);
  tree().find(n => n.type === 'Modal').props.onRequestClose();
  assert.equal(visible(), false);
  h.unmount();
  const user = mount('普通文字');
  const userTree = user.walk(user.render(false));
  const userRoot = userTree.find(n => n.type === 'View' && n.props.onTouchStart && n.props.onTouchEnd);
  for (let i = 0; i < 2; i++) { userRoot.props.onTouchStart(event()); userRoot.props.onTouchEnd(event()); }
  assert.equal(user.walk(user.render(false)).find(n => n.type === 'Modal').props.visible, false);
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
  assert.equal(nodes.filter(n => n.props.accessibilityLabel === '图片加载中：alt').length, 1);
});

test('video remains a fixed preview until tap, then native controls pause on background and unmount', () => {
  const h = mount('before ![clip](https://example.com/a.mp4) after');
  let tree = h.render(), nodes = h.walk(tree);
  assert.equal(nodes.filter(n => n.type === 'VideoView').length, 0);
  assert.equal(h.players.length, 0, 'no eager player or remote request');
  const play = nodes.find(n => n.props.accessibilityLabel === '播放视频：clip');
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
  assert.ok(nodes.some(n => n.props.accessibilityLabel === '视频加载失败，点按重试：clip'));
  assert.equal(h.players[0].status, null, 'listener cleaned on error');
  h.unmount();
  const bad = mount('![unsafe](https://u@example.com/a.mp4)');
  assert.equal(bad.walk(bad.render()).filter(n => n.type === 'VideoView').length, 0);
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
  const frame = nodes.find(n => n.props.accessibilityLabel === '图片加载中：cat');
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
  const retry = nodes.find(n => n.props.accessibilityLabel?.startsWith('图片加载失败'));
  assert.equal(retry.props.style.height, 168);
  retry.props.onPress();
  nodes = h.walk(h.render());
  assert.equal(nodes.find(n => n.type === 'Image').props.key, 1);
  nodes.find(n => n.type === 'Image').props.onLoad();
  nodes = h.walk(h.render());
  assert.equal(nodes.find(n => n.type === 'Image').props.accessibilityLabel, 'cat');
  assert.equal(nodes.find(n => n.props.accessibilityLabel === '图片：cat').props.style.height, 168);
  checkNesting(tree);
  const bad = mount('![unsafe](https://u@example.com/i.png)');
  const badNodes = bad.walk(bad.render());
  const fallback = badNodes.find(n => n.props.accessibilityLabel === '图片不可用：unsafe');
  assert.equal(fallback.props.disabled, true);
  assert.equal(badNodes.filter(n => n.type === 'Image').length, 0);
});
