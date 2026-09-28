import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute production hooks across pending -> confirmed renders; no fake device/frame claim.
function mount(initialPending, reduced = false) {
  const hooks = [], effects = [], calls = [], values = [];
  let index = 0, motionListener, removed = false;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), memo: f => f,
    useMemo: f => f(),
    useState: value => { const slot = index++; hooks[slot] ??= { value }; return [hooks[slot].value, next => { hooks[slot].value = typeof next === 'function' ? next(hooks[slot].value) : next; }]; },
    useRef: value => { const slot = index++; return hooks[slot] ??= { current: value }; },
    useEffect: (fn, deps) => {
      const slot = index++, previous = hooks[slot];
      if (!previous || deps.some((d, i) => d !== previous.deps[i])) {
        previous?.cleanup?.();
        hooks[slot] = { deps };
        effects.push(() => { hooks[slot].cleanup = fn(); });
      }
    }
  };
  const native = {
    Animated: {
      Text: 'Animated.Text',
      Value: class {
        constructor(v) { this.value = v; values.push(this); }
        interpolate(config) { return { value: this, ...config }; }
        setValue(v) { this.value = v; }
        stopAnimation() { calls.push('stop'); }
      },
      timing: (value, config) => ({ start() { calls.push({ value, config }); } })
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => reduced,
      addEventListener: (_, listener) => { motionListener = listener; return { remove() { removed = true; } }; }
    },
    StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 390, height: 844 }), Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal'
  };
  const modules = { react: { ...react, default: react }, 'react-native': native, 'expo-clipboard': {},
    'expo-router': { useIsFocused: () => true }, './Viewers': { useViewer: () => ({ openViewer() {} }) },
    './FontSize': { Text: native.Text, AnimatedText: native.Animated.Text, useFontSize: () => ({ scale: 1 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: () => ({}) },
    'react-native-webview': { default: 'WebView' }, './markdownWeb': { renderMarkdownHtml: () => '' },
    './messageMarkdown': { parseMessageMarkdown: text => [{ kind: 'paragraph', children: [{ kind: 'text', text }] }] } };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/MessageContent.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
  }).outputText, { module: output, exports: output.exports, require: name => modules[name] });
  const expand = node => {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return [node, ...expand(node.props?.children)];
  };
  const render = pending => {
    index = 0;
    const tree = expand(output.exports.MessageContent({ text: 'hello', pending }));
    while (effects.length) effects.shift()();
    return tree.find(n => n.type === 'Animated.Text').props.style.at(-1).color;
  };
  const initial = render(initialPending);
  return { initial, render, calls, values, motion: value => motionListener(value), animations: () => calls.filter(c => typeof c === 'object'),
    unmount: () => hooks.forEach(h => h.cleanup?.()), removed: () => removed };
}

test('pending stays gray; real confirmation animates the same value to normal without a delay', async () => {
  const h = mount(true);
  await Promise.resolve();
  assert.equal(h.initial.value.value, 0);
  assert.equal(h.initial.outputRange[0], '#93a0b0');
  assert.equal(h.animations().length, 0);
  h.render(true);
  const confirmed = h.render(false);
  assert.equal(confirmed.value, h.initial.value);
  assert.equal(confirmed.outputRange[1], '#172a40');
  const animation = h.animations()[0];
  assert.equal(animation.config.toValue, 1);
  assert.equal(animation.config.duration, 240);
  assert.equal(animation.config.delay, undefined);
  h.render(false);
  assert.equal(h.animations().length, 1, 'reaction/rerender cannot restart fade');
  h.unmount();
  assert.equal(h.removed(), true);
});

test('confirmed history starts solid and never replays sending', () => {
  const h = mount(false);
  assert.equal(h.initial.value.value, 1);
  h.render(false);
  assert.equal(h.animations().length, 0);
});

test('reduce motion snaps to actual state, including a preference change during animation', async () => {
  const h = mount(true, true);
  await Promise.resolve();
  h.render(false);
  assert.equal(h.animations().length, 0);
  assert.equal(h.initial.value.value, 1);
  const live = mount(true);
  await Promise.resolve();
  live.render(false);
  assert.equal(live.animations().length, 1);
  live.motion(true);
  assert.equal(live.initial.value.value, 1);
  live.render(true);
  assert.equal(live.initial.value.value, 0);
});
