import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/NavigationMotion.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const walk = n => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : [];
const touch = (x, y = 10, count = 1) => ({ nativeEvent: { pageX: x, pageY: y, touches: Array.from({ length: count }, () => ({ pageX: x, pageY: y })) } });
const release = (x, y = 10) => ({ nativeEvent: { pageX: x, pageY: y, touches: [] } });

function mount({ motion = false, pageKey = 'channels', back = () => {} } = {}) {
  const hooks = [], pending = [], subscriptions = {}, animations = [], removed = [];
  let index = 0, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: initial => { const i = index++; return hooks[i] ??= { current: initial }; },
    useState: initial => { const i = index++; hooks[i] ??= { value: initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useEffect: effect, useLayoutEffect: effect,
  };
  function effect(fn, deps) {
    const i = index++, old = hooks[i];
    if (!old || !deps || deps?.some((v, at) => !Object.is(v, old.deps?.[at]))) {
      pending.push(() => { old?.cleanup?.(); const cleanup = fn(); hooks[i] = { deps, cleanup }; });
    }
  }
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
  }
  const animated = { Value, View: 'Animated.View', timing: (value, options) => animation(value, options, 'timing'), spring: (value, options) => animation(value, options, 'spring') };
  function animation(value, options, kind) {
    return { start: cb => { animations.push({ value, options, kind, complete: (finished = true) => { if (finished) value.setValue(options.toValue); cb?.({ finished }); } }); } };
  }
  const native = {
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(motion), addEventListener: (_, callback) => { subscriptions.motion = callback; return { remove() { removed.push('motion'); } }; } },
    Animated: animated, StyleSheet: { create: styles => styles }, View: 'View'
  };
  const output = { exports: {} };
  runInNewContext(code, { module: output, exports: output.exports, require: name => name === 'react' ? { default: react, ...react } : name === 'react-native' ? native : assert.fail(name), setTimeout, clearTimeout });
  const props = { pageKey, direction: 'forward', children: { type: `Page:${pageKey}`, props: {} },
    backPage: { type: 'Previous', props: {} }, canBack: () => true, onBack: back, onSettled: () => {} };
  const render = () => { index = 0; tree = output.exports.NavigationMotion(props); while (pending.length) pending.shift()(); return tree; };
  render();
  return {
    props, animations, removed, render, motion: value => { motion = value; subscriptions.motion(value); render(); },
    page(key, direction, child = { type: `Page:${key}`, props: {} }) { props.pageKey = key; props.direction = direction; props.children = child; render(); render(); },
    nodes: () => walk(tree), edge: () => walk(tree).find(n => n.props?.onStartShouldSetResponderCapture),
    currentX: () => walk(tree).find(n => n.type === 'Animated.View').props.style[1].transform[0].translateX,
    dispose: () => { hooks.forEach(slot => slot?.cleanup?.()); },
  };
}

test('forward slides one live page; no outgoing chat clone or repeated entrance on revisions', () => {
  const h = mount();
  h.page('channel:c', 'forward');
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].options.toValue, 0);
  assert.equal(h.currentX().value, 320);
  assert.ok(!h.nodes().some(n => n.type === 'Page:channels'));
  h.render(); assert.equal(h.animations.length, 1);
  h.animations[0].complete(); h.render();
  assert.ok(!h.nodes().some(n => n.type === 'Page:channels'));
  h.dispose(); assert.deepEqual(h.removed, ['motion']);
});

test('back enters from the left without remounting old chat; stale completions are ignored', () => {
  const h = mount({ pageKey: 'thread:t' });
  h.page('channel:c', 'back');
  assert.equal(h.animations[0].options.toValue, 0);
  assert.equal(h.currentX().value, -80);
  assert.ok(!h.nodes().some(n => n.type === 'Page:thread:t'));
  h.page('channels', 'back');
  h.animations[0].complete(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'Page:channels'));
  h.animations[1].complete(); h.render();
  assert.ok(!h.nodes().some(n => n.type === 'Page:channel:c'));
});

test('changing to reduced motion mid-transition snaps to destination and ignores an old completion', () => {
  const h = mount();
  h.page('channel:c', 'forward');
  assert.ok(!h.nodes().some(n => n.type === 'Page:channels'));
  h.motion(true); h.render();
  assert.equal(h.currentX().value, 0);
  assert.ok(!h.nodes().some(n => n.type === 'Page:channels'));
  h.animations[0].complete(); h.render();
  assert.equal(h.currentX().value, 0);
});

test('edge-only horizontal swipe follows finger and cancel rebounds without navigation or remount', () => {
  let backs = 0; const child = { type: 'Chat', props: { text: 'unsent', attachments: ['file'] } };
  const h = mount({ pageKey: 'thread:t', back: () => { backs++; } });
  h.page('thread:t', 'forward', child);
  const edge = h.edge().props;
  assert.equal(edge.onStartShouldSetResponderCapture(touch(5)), false);
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(7, 35)), false);
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(50, 35)), false, 'vertical start remains native');
  edge.onStartShouldSetResponderCapture(touch(5));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(20)), true);
  edge.onResponderGrant(touch(20)); h.render();
  assert.ok(h.nodes().some(n => n.type === 'Previous'));
  edge.onResponderMove(touch(75)); assert.equal(h.currentX().value, 70);
  edge.onResponderRelease(release(75));
  assert.equal(backs, 0); assert.equal(h.animations.at(-1).kind, 'spring');
  h.animations.at(-1).complete(); h.render();
  assert.equal(backs, 0); assert.equal(h.props.children, child);
  assert.ok(!h.nodes().some(n => n.type === 'Previous'));
});

test('multitouch, vertical drag and responder termination cannot navigate', () => {
  let backs = 0; const h = mount({ pageKey: 'thread:t', back: () => backs++ });
  let edge = h.edge().props;
  edge.onStartShouldSetResponderCapture(touch(3, 10, 2));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(100)), false);
  edge.onStartShouldSetResponderCapture(touch(3));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(4, 35)), false);
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(130)), false);
  edge.onStartShouldSetResponderCapture(touch(3));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(40)), true);
  edge.onResponderGrant(touch(40)); edge.onResponderMove(touch(90, 10, 2));
  h.animations.at(-1).complete(); h.render();
  edge = h.edge().props; edge.onStartShouldSetResponderCapture(touch(4)); edge.onMoveShouldSetResponderCapture(touch(30));
  edge.onResponderGrant(touch(30)); edge.onResponderTerminate();
  h.animations.at(-1).complete(); h.render();
  assert.equal(backs, 0);
});

test('completed swipe navigates once; blocked form prevents claiming edge; reduced motion skips animations', async () => {
  let backs = 0, allowed = true;
  const h = mount({ pageKey: 'thread:t', back: () => { backs++; h.page('channel:c', 'back'); } });
  h.props.canBack = () => allowed;
  h.render();
  let edge = h.edge().props;
  allowed = false; edge.onStartShouldSetResponderCapture(touch(5)); assert.equal(edge.onMoveShouldSetResponderCapture(touch(50)), false);
  allowed = true; edge.onStartShouldSetResponderCapture(touch(5)); assert.equal(edge.onMoveShouldSetResponderCapture(touch(40)), true);
  edge.onResponderGrant(touch(40)); edge.onResponderMove(touch(150)); edge.onResponderRelease(release(150));
  h.animations.at(-1).complete(); h.render();
  assert.equal(backs, 1);
  assert.equal(h.animations.length, 1, 'settled swipe must not replay a route animation');
  h.motion(true);
  h.page('thread:next', 'forward');
  assert.equal(h.animations.length, 1, 'reduced motion switches pages immediately');
  edge = h.edge().props;
  edge.onStartShouldSetResponderCapture(touch(5)); edge.onMoveShouldSetResponderCapture(touch(40)); edge.onResponderGrant(touch(40)); edge.onResponderRelease(release(150));
  assert.equal(backs, 2, 'gesture stays available without motion');
});

test('back settlement leaves live page interactive and a second back gesture usable', () => {
  let backs = 0;
  const h = mount({ pageKey: 'thread:t', back: () => backs++ });
  h.page('channel:c', 'back'); h.animations.at(-1).complete(); h.render();
  const page = h.nodes().find(n => n.type === 'Animated.View');
  assert.notEqual(page.props.pointerEvents, 'none');
  assert.equal(page.props.style[1].transform[0].translateX.value, 0);
  const edge = h.edge().props;
  edge.onStartShouldSetResponderCapture(touch(4));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(50)), true);
  edge.onResponderGrant(touch(50)); edge.onResponderRelease(release(160));
  h.animations.at(-1).complete(); h.render();
  assert.equal(backs, 1); assert.equal(h.currentX().value, 0);
  h.page('thread:next', 'forward');
  assert.equal(h.currentX().value, 320, 'a declined parent back cannot skip the next entrance');
  h.dispose();
});

test('ancestor responder ignores center gestures; no overlay steals vertical edge scrolling', () => {
  const h = mount(), edge = h.edge().props;
  assert.ok(!h.nodes().some(n => n.props?.style?.width === 24));
  edge.onStartShouldSetResponderCapture(touch(100));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(240)), false);
  edge.onStartShouldSetResponderCapture(touch(4));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(4, 80)), false);
  // Simulate safe-area/landscape offset: pageX is measured relative to the root.
  edge.ref.current = { measureInWindow: callback => callback(40) };
  edge.onLayout({ nativeEvent: { layout: { width: 400 } } });
  edge.onStartShouldSetResponderCapture(touch(50));
  assert.equal(edge.onMoveShouldSetResponderCapture(touch(90)), true);
  h.dispose();
});

test('multitouch start cancels immediately, cleanup prevents stale navigation, reduced cancel does not spring', async () => {
  let backs = 0;
  const h = mount({ back: () => backs++ }), edge = h.edge().props;
  edge.onStartShouldSetResponderCapture(touch(4)); edge.onResponderGrant(touch(40));
  edge.onResponderStart(touch(50, 10, 2));
  edge.onResponderRelease(release(200));
  assert.equal(backs, 0); h.animations.at(-1).complete(); h.render();
  edge.onStartShouldSetResponderCapture(touch(4)); edge.onResponderGrant(touch(40)); edge.onResponderRelease(release(200));
  h.dispose(); h.animations.at(-1).complete(); assert.equal(backs, 0);
  const reduced = mount({ motion: true }); await Promise.resolve();
  const r = reduced.edge().props;
  r.onStartShouldSetResponderCapture(touch(4)); r.onResponderGrant(touch(40)); r.onResponderRelease(release(50));
  assert.equal(reduced.animations.length, 0); reduced.dispose();
});
