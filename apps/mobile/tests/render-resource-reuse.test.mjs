import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { RenderResourceBudget, RenderResourceScope } from '../src/renderResourceCache.ts';
import { parseMessageMarkdown, safeLinkUrl } from '../src/messageMarkdown.ts';
import * as tools from '../../../packages/client/src/toolPresentation.ts';
import * as links from '../../../packages/client/src/sessionLinks.ts';
import { compile, loadRenderResources, loadReducedMotion, loadMarkdownEngines } from './render-resource-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => Promise.resolve();

test('public engine scripts are escaped only once per execution environment', () => {
  let math = 0, diagram = 0;
  const engines = loadMarkdownEngines({ KATEX_CSS: '', KATEX_SCRIPT: { replace(pattern, replacement) { math++; return '</script>'.replace(pattern, replacement); } }, MERMAID_SCRIPT: { replace(pattern, replacement) { diagram++; return '</SCRIPT>'.replace(pattern, replacement); } } });
  for (let i = 0; i < 100; i++) { assert.equal(engines.markdownEngineScript('math'), '<\\/script>'); assert.equal(engines.markdownEngineScript('diagram'), '<\\/script>'); }
  assert.equal(math, 1); assert.equal(diagram, 1);
});

test('cache reuses exact inputs, replaces edited content and isolates owners', () => {
  const budget = new RenderResourceBudget(1000, 10), a = new RenderResourceScope(budget), b = new RenderResourceScope(budget);
  let builds = 0; const build = () => ({ serial: ++builds }), size = () => 100;
  a.activate(); b.activate();
  const first = a.read('message:1', ['v1'], build, size);
  assert.equal(a.read('message:1', ['v1'], build, size), first);
  assert.notEqual(a.read('message:1', ['v2'], build, size), first);
  assert.notEqual(b.read('message:1', ['v2'], build, size), a.read('message:1', ['v2'], build, size));
  assert.equal(builds, 3); a.dispose(); b.dispose(); assert.deepEqual(budget.snapshot, { entries: 0, bytes: 0 });
});

test('pages share a global LRU byte/entry budget; oversize results are not retained', () => {
  const budget = new RenderResourceBudget(250, 2), a = new RenderResourceScope(budget), b = new RenderResourceScope(budget);
  a.activate(); b.activate();
  const one = a.read('one', [], () => ({}), () => 100);
  b.read('two', [], () => ({}), () => 100);
  a.read('one', [], () => { throw Error('must hit'); }, () => 100);
  a.read('three', [], () => ({}), () => 100);
  assert.equal(b.snapshot.entries, 0, 'oldest entry evicted across page boundaries');
  assert.equal(a.read('one', [], () => ({}), () => 100), one);
  assert.equal(budget.snapshot.bytes, 200);
  const huge = a.read('huge', [], () => ({}), () => 1000);
  assert.notEqual(a.read('huge', [], () => ({}), () => 1000), huge);
  assert.equal(budget.snapshot.entries, 2);
  a.dispose(); b.dispose();
});

test('abandoned render remains private; activation trims pending caches and destruction disables retention', () => {
  const budget = new RenderResourceBudget(150, 2), a = new RenderResourceScope(budget), b = new RenderResourceScope(budget);
  a.read('first', [], () => ({}), () => 100); b.read('second', [], () => ({}), () => 100);
  assert.equal(budget.snapshot.entries, 0);
  a.activate(); b.activate(); assert.equal(budget.snapshot.bytes, 100); assert.equal(a.snapshot.entries, 0);
  b.dispose(); b.read('late', [], () => ({}), () => 100); assert.equal(b.snapshot.entries, 0); assert.equal(budget.snapshot.bytes, 0);
});

function harness() {
  let parses = 0, html = 0, articles = 0, values = 0, added = 0, removed = 0, queried = 0, preference;
  const resources = loadRenderResources(React), Scale = React.createContext(1);
  const viewers = [];
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
    Animated: { Text: 'Text', Value: class { constructor() { values++; } setValue() {} stopAnimation() {} interpolate() { return 'animated'; } }, timing: () => ({ start() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => { queried++; return false; }, addEventListener: (_name, callback) => { added++; preference = callback; return { remove() { removed++; } }; } },
    AppState: { addEventListener: () => ({ remove() {} }) }, Alert: { alert() {} }, Linking: { openURL: async () => {} },
    Image: 'Image', Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView' };
  const modules = { react: React, 'react-native': native, './RenderResources': resources, './reducedMotion': loadReducedMotion(native),
    './FontSize': { Text: 'Text', AnimatedText: 'Text', useFontSize: () => ({ scale: React.useContext(Scale) }) },
    'expo-clipboard': { setStringAsync: async () => {} }, 'expo-router': { useIsFocused: () => true },
    './sessionNavigation': { useSessionNavigation: () => ({ link() {} }) }, '../../../packages/client/src/sessionLinks': links,
    'expo-video': { useVideoPlayer: () => ({}), VideoView: 'Video' }, 'react-native-webview': 'WebView',
    './messageMarkdown': { parseMessageMarkdown: text => { parses++; return parseMessageMarkdown(text); }, safeLinkUrl },
    './markdownWeb': { renderMarkdownHtml: (kind, source, display, scale) => { html++; return `${kind}:${source}:${display}:${scale}:${html}`; } },
    './articleHtml': { ARTICLE_TEXT_LIMIT: 200000, renderArticleHtml: (_blocks, _calls, scale) => { articles++; return { html: `article:${scale}:${articles}`, expansions: [], links: [] }; } },
    '../../../packages/client/src/toolPresentation': tools, './Viewers': { useViewer: () => ({ openViewer: (_title, node) => viewers.push(node) }) } };
  const { MessageContent } = compile('MessageContent.tsx', modules);
  let root;
  const tree = ({ show = true, text = '```mermaid\ngraph TD; A-->B\n```', scale = 1, pending = false, reader = null, second = false, strict = false } = {}) => {
    const body = React.createElement(resources.RenderResourceProvider, {}, show && React.createElement(MessageContent, { resourceId: 'ref:1', text, pending, canExpand: true }),
      second && React.createElement(MessageContent, { resourceId: 'ref:2', text: 'Sending', pending: true }));
    return React.createElement(Scale.Provider, { value: scale }, strict ? React.createElement(React.StrictMode, {}, body) : body, reader);
  };
  return { resources, viewers, get root() { return root; }, get stats() { return { parses, html, articles, values, added, removed, queried }; },
    preference: value => preference(value),
    async render(props) { await act(async () => { if (root) root.update(tree(props)); else root = create(tree(props)); }); },
    async close() { await act(async () => { root?.unmount(); await tick(); }); } };
}

test('actual mobile component reuses parsed content and heavy HTML after row remount; output configuration invalidates only HTML', async () => {
  const h = harness(); await h.render();
  assert.equal(h.stats.parses, 1); assert.equal(h.stats.html, 1); assert.equal(h.stats.values, 0); assert.equal(h.stats.added, 0);
  for (let i = 0; i < 100; i++) await h.render();
  assert.equal(h.stats.parses, 1); assert.equal(h.stats.html, 1);
  await h.render({ show: false }); await h.render();
  assert.equal(h.stats.parses, 1); assert.equal(h.stats.html, 1);
  await h.render({ scale: 1.3 }); assert.equal(h.stats.parses, 1); assert.equal(h.stats.html, 2);
  await h.render({ text: '```mermaid\ngraph TD; C-->D\n```', scale: 1.3 }); assert.equal(h.stats.parses, 2); assert.equal(h.stats.html, 3);
  await h.close(); assert.equal(h.resources.testBudget.snapshot.entries, 0);
});

test('actual diagram reader shares AST/HTML outside the page context and keeps WebView source stable', async () => {
  const h = harness(); await h.render();
  await act(async () => h.root.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'View diagram fullscreen').props.onPress());
  await h.render({ reader: h.viewers[0] }); assert.equal(h.stats.parses, 1); assert.equal(h.stats.html, 1);
  const reader = h.root.root.findAllByType('View').find(node => node.props.onLayout);
  await act(async () => reader.props.onLayout({ nativeEvent: { layout: { width: 300, height: 220 } } }));
  const web = h.root.root.findAllByType('WebView')[0]; assert.ok(web);
  const source = web.props.source;
  await act(async () => web.props.onMessage({ nativeEvent: { data: 'render-ready' } }));
  assert.equal(h.root.root.findAllByType('WebView')[0].props.source, source);
  assert.equal(h.stats.html, 1); await h.close();
});

test('oversize article fallback never constructs suspended math/diagram engine HTML', async () => {
  const h = harness(); const text = 'z'.repeat(200001) + '\n\n```mermaid\ngraph TD; A-->B\n```';
  await h.render({ text }); assert.equal(h.stats.html, 1);
  const rootView = h.root.root.findAllByType('View').find(node => node.props.onTouchStart && node.props.onTouchEnd);
  const event = { nativeEvent: { target: 1, pageX: 20, pageY: 20, touches: [] } };
  await act(async () => { rootView.props.onTouchStart(event); rootView.props.onTouchEnd(event); rootView.props.onTouchStart(event); rootView.props.onTouchEnd(event); });
  assert.equal(h.viewers.length, 1); await h.render({ text, reader: h.viewers[0] });
  assert.equal(h.stats.articles, 0); assert.equal(h.stats.html, 1, 'fallback must not generate a hidden engine document'); await h.close();
});

test('pending rows share one native motion listener and history rows allocate no animation values', async () => {
  const h = harness(); await h.render({ text: 'Sending', pending: true, second: true });
  assert.equal(h.stats.values, 2); assert.equal(h.stats.added, 1); assert.equal(h.stats.queried, 1);
  await act(async () => h.preference(true)); await h.render({ text: 'Sending', pending: false, second: true });
  assert.equal(h.stats.values, 2); assert.equal(h.stats.added, 1);
  await h.close(); assert.equal(h.stats.removed, 1);
});

test('resource provider survives StrictMode replay and releases only on actual removal', async () => {
  const h = harness(); await h.render({ strict: true }); assert.ok(h.resources.testBudget.snapshot.entries > 0);
  await h.render({ strict: true, show: false }); assert.ok(h.resources.testBudget.snapshot.entries > 0);
  await h.close(); assert.equal(h.resources.testBudget.snapshot.entries, 0);
});

test('shared motion reader ignores an older preference query after a newer native event or unsubscribe', async () => {
  let resolve, callback, removed = 0;
  const motion = loadReducedMotion({ AccessibilityInfo: { isReduceMotionEnabled: () => new Promise(yes => { resolve = yes; }), addEventListener: (_name, fn) => { callback = fn; return { remove() { removed++; } }; } } });
  const received = [], off = motion.subscribeReducedMotion(value => received.push(value));
  callback(false); resolve(true); await tick(); assert.deepEqual(received, [true, false]); off(); assert.equal(removed, 1);
  const late = [], end = motion.subscribeReducedMotion(value => late.push(value)); end(); resolve(false); await tick(); assert.deepEqual(late, [true]);
});
