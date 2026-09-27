import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function harness() {
  const cells = [], effects = [], listeners = {}, animations = [];
  let index = 0;
  const slot = initial => cells[index++] ??= { value: initial };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: value => slot({ current: value }).value,
    useState: initial => { const cell = slot(initial); return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useEffect: (fn, deps) => { const cell = slot(null); if (!cell.deps || deps.some((v, i) => v !== cell.deps[i])) {
      effects.push(() => { cell.cleanup?.(); cell.cleanup = fn(); }); cell.deps = deps;
    } },
  };
  const native = {
    View: 'View', Text: 'Text', StyleSheet: { create: s => s },
    Animated: { View: 'Animated.View', Value: class { constructor(v) { this.value = v; } setValue(v) { this.value = v; } stopAnimation() {} },
      timing: (dot, settings) => ({ dot, settings }), sequence: children => ({ children }),
      loop: sequence => { const animation = { sequence, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } }; animations.push(animation); return animation; },
    },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: (_, fn) => { listeners.motion = fn; return { remove() { delete listeners.motion; } }; } },
    AppState: { currentState: 'active', addEventListener: (_, fn) => { listeners.app = fn; return { remove() { delete listeners.app; } }; } },
  };
  const out = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/TypingIndicator.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { module: out, exports: out.exports, require: name => name === 'react' ? { ...react, default: react } : native });
  return { ...out.exports, animations, listeners, render(active, name) { index = 0; const tree = out.exports.TypingIndicator({ active, name }); effects.splice(0).forEach(f => f()); return tree; },
    unmount() { cells.forEach(c => c.cleanup?.()); } };
}

test('running label uses configured name or Agent, matching visible and accessible text', () => {
  const h = harness();
  for (const [name, expected] of [[undefined, 'Agent is running'], ['', 'Agent is running'], ['   ', 'Agent is running'], [' Tuly ', 'Tuly is running'], ['小助手', '小助手 is running']]) {
    const tree = h.render(true, name);
    assert.equal(tree.props.accessibilityLabel, expected);
    assert.equal(tree.props.children[1].props.children[0], expected);
    assert.equal(tree.props.children[1].props.numberOfLines, 1);
  }
  assert.equal(h.render(false, 'Tuly'), null); h.unmount();
});

test('typing derives only from online, current-thread running work, excluding pending interactions', () => {
  const { isAgentTyping } = harness();
  const receipt = { id: 'r', thread_id: 't', state: 'running' };
  assert.equal(isAgentTyping('t', [receipt], [], true), true);
  for (const state of ['queued', 'completed', 'failed', 'interrupted', 'unknown']) assert.equal(isAgentTyping('t', [{ ...receipt, state }], [], true), false);
  assert.equal(isAgentTyping('other', [receipt], [], true), false);
  assert.equal(isAgentTyping('t', [receipt], [], false), false);
  assert.equal(isAgentTyping('t', [receipt], [{ thread_id: 't', receipt_id: 'r', state: 'pending' }], true), false);
  assert.equal(isAgentTyping('t', [receipt], [{ thread_id: 't', receipt_id: 'r', state: 'settled' }], true), true);
});

test('native three-dot scale animation stops on background, reduced motion, inactive state and unmount', async () => {
  const h = harness();
  let tree = h.render(true);
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.accessibilityLabel, 'Agent is running');
  const dots = tree.props.children[0].props.children[0];
  assert.equal(dots.length, 3);
  await Promise.resolve(); h.render(true);
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].started, true);
  const phases = h.animations[0].sequence.children;
  assert.equal(phases.length, 3);
  phases.forEach(phase => {
    assert.deepEqual(Array.from(phase.children, c => c.settings.toValue), [1, 0.6]);
    phase.children.forEach(c => { assert.equal(c.settings.useNativeDriver, true); assert.equal(c.settings.isInteraction, false); });
  });
  h.listeners.app('background'); assert.equal(h.render(true), null);
  assert.equal(h.animations[0].stopped, true);
  h.listeners.app('active'); h.render(true);
  h.listeners.motion(true); tree = h.render(true);
  assert.equal(h.animations[1].stopped, true);
  assert.ok(tree); // Static dots stay visible for reduced motion.
  h.listeners.motion(false); h.render(true);
  assert.equal(h.render(false), null); assert.equal(h.animations[2].stopped, true);
  h.render(true); h.unmount();
  assert.equal(h.animations[3].stopped, true);
  assert.equal(Object.keys(h.listeners).length, 0);
});
