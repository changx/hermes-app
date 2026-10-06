import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Runs the real CopyToast module with small native stand-ins.
function harness({ clipboardFails = false } = {}) {
  const timers = new Map(); let number = 0; const copied = []; const announced = [];
  const value = () => { let v = 0; return { setValue: next => { v = next; }, stopAnimation() {}, get current() { return v; } }; };
  const Animated = {
    Value: function () { return value(); },
    View: 'AnimatedView',
    timing: (anim, { toValue }) => ({ start: done => { anim.setValue(toValue); done?.({ finished: true }); } }),
  };
  let reduced = false;
  const mocks = {
    react: React,
    'react-native': { View: 'View', Animated, Platform: { OS: 'ios' }, StyleSheet: { create: v => v }, AccessibilityInfo: { announceForAccessibility: t => announced.push(t) } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59 }), useSafeAreaFrame: () => ({ width: 393, height: 852, x: 0, y: 0 }) },
    'expo-router/react-navigation': { getDefaultHeaderHeight: (_frame, _modal, top) => top + 44 },
    'expo-clipboard': { setStringAsync: async text => { if (clipboardFails) throw Error('denied'); copied.push(text); return true; } },
    './FontSize': { Text: 'Text' },
    './reducedMotion': { subscribeReducedMotion: fn => { fn(reduced); return () => {}; } },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/CopyToast.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, require: id => mocks[id], setTimeout: fn => { timers.set(++number, fn); return number; }, clearTimeout: id => timers.delete(id), Error, Promise });
  let root;
  return {
    exports, copied, announced, timers,
    async mount() { await act(async () => { root = create(React.createElement(exports.CopyToast)); }); },
    texts: () => root.root.findAllByType('Text').map(n => n.props.children),
    position: () => root.root.findAllByType('View')[0],
    async flush() { await act(async () => { const all = [...timers.values()]; timers.clear(); for (const fn of all) fn(); }); },
    get json() { return root.toJSON(); },
    async close() { await act(async () => root.unmount()); },
  };
}

test('copying shows "Copied to clipboard" below the navigation bar and hides itself', async () => {
  const h = harness();
  try {
    await h.mount();
    assert.equal(h.json, null);
    await act(async () => { assert.equal(await h.exports.copyWithToast('npm test'), true); });
    assert.deepEqual(h.copied, ['npm test']);
    assert.deepEqual(h.texts(), ['Copied to clipboard']);
    assert.equal(h.position().props.pointerEvents, 'none');
    assert.equal(h.position().props.style[1].top, 59 + 44 + 8); // status bar + nav bar + gap
    assert.deepEqual(h.announced, ['Copied to clipboard']);
    await h.flush();
    assert.equal(h.json, null);
  } finally { await h.close(); }
});

test('a second copy replaces the first toast and restarts its timer', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => { await h.exports.copyWithToast('a'); });
    await act(async () => { await h.exports.copyWithToast('b'); });
    assert.deepEqual(h.copied, ['a', 'b']);
    assert.deepEqual(h.texts(), ['Copied to clipboard']);
    assert.equal(h.timers.size, 1);
  } finally { await h.close(); }
});

test('clipboard failure is reported, never a false success', async () => {
  const h = harness({ clipboardFails: true });
  try {
    await h.mount();
    await act(async () => { assert.equal(await h.exports.copyWithToast('x'), false); });
    assert.deepEqual(h.texts(), ['Could not copy to the clipboard']);
  } finally { await h.close(); }
});
