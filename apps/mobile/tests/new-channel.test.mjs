import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channel = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');

test('Channels uses a safe-area floating new-channel button instead of a top New action', () => {
  assert.match(channel, /accessibilityLabel="New channel"/);
  assert.match(channel, /!channelId && <Pressable[^>]+onPress=\{startCreate\}[^>]+bottom: 18 \+ insets\.bottom/);
  assert.doesNotMatch(channel, /label=\{channelId \? 'Edit' : 'New'\}/);
  assert.match(channel, /\{!!channelId && <Action label="Edit"/);
});

test('new-channel editor uses the shared static-backdrop editor sheet and existing creation path', () => {
  assert.match(channel, /<EditorSheet visible=\{creating\} closeLabel="Close new channel editor"/);
  assert.match(channel, /<Modal visible=\{visible\} transparent animationType="none"/);
  assert.match(channel, /<Pressable[^>]*style=\{s\.backdrop\}[\s\S]*?<View pointerEvents="box-none" style=\{\[s\.keyboardLayer/);
  assert.match(channel, /<Animated\.View style=\{\[s\.composer,[^>]*translateY: sheetOffset/);
  assert.match(channel, /Animated\.timing\(sheetOffset/);
  assert.match(channel, /if \(!visible\) \{[\s\S]*?openingHeight\.current = height;[\s\S]*?sheetOffset\.setValue\(height\)/);
  assert.doesNotMatch(channel, /animation\.start\(\);[\s\S]*?\}, \[height,/);
  assert.match(channel, /accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b"[^>]*autoFocus/);
  assert.match(channel, /accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines \(optional\)" placeholderTextColor="#65758b"[^>]*multiline/);
  assert.match(channel, /description: \{ minHeight: 140, maxHeight: 260, textAlignVertical: 'top' \}/);
  assert.match(channel, /client\.createChannel\(patch\.name, patch\.description\)/);
  assert.match(channel, /setCreating\(false\); onChannel\(made\.id\)/);
});

test('editor writes a bounded keyboard inset and clears it through foreground transitions', () => {
  const source = ts.createSourceFile('ChannelScreens.tsx', channel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(source) === 'editorKeyboardInset'));
  assert.ok(declaration);
  const output = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(output, { module, exports: module.exports });
  const inset = module.exports.editorKeyboardInset;
  const frame = { screenX: 0, screenY: 514, width: 390, height: 330 };
  assert.equal(inset(true, 'active', 844, frame), 330);
  assert.equal(inset(true, 'inactive', 844, frame), 0);
  assert.equal(inset(true, 'background', 844, frame), 0);
  assert.equal(inset(true, 'active', 844, null), 0);
  assert.equal(inset(false, 'active', 844, frame), 0);
  assert.equal(inset(true, 'active', 844, { ...frame, screenY: 600, height: 330 }), 244);
  assert.equal(inset(true, 'active', 844, { ...frame, screenY: 0, height: 330 }), 330);
  assert.match(channel, /Keyboard\.addListener\('keyboardWillShow'/);
  assert.match(channel, /Keyboard\.addListener\('keyboardWillChangeFrame'/);
  assert.match(channel, /Keyboard\.addListener\('keyboardWillHide'/);
  assert.match(channel, /Keyboard\.addListener\('keyboardDidHide'/);
  assert.match(channel, /if \(state !== 'active'\) setKeyboardFrame\(null\)/);
  assert.doesNotMatch(channel, /Keyboard\.(?:isVisible|metrics)\(/);
  assert.match(channel, /style=\{\[s\.keyboardLayer, \{ paddingBottom: Platform\.OS === 'ios'[\s\S]*?editorKeyboardInset\(visible, appState, height, keyboardFrame\) : 0 \}\]\}/);
  assert.doesNotMatch(channel, /<KeyboardAvoidingView/);
  assert.doesNotMatch(channel, /key=\{[^}]*appState|key=\{[^}]*keyboard/);
});

test('shared editor executes frame reset across app lifecycle without remounting its form', async () => {
  const source = ts.createSourceFile('ChannelScreens.tsx', channel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inset = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(source) === 'editorKeyboardInset'));
  const editor = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'EditorSheet');
  assert.ok(inset && editor);
  const output = ts.transpileModule(`${inset.getText(source)}\n${editor.getText(source)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const listeners = new Map();
  let appState = 'active', mounts = 0, unmounts = 0, animations = 0;
  const add = (name, callback) => {
    const values = listeners.get(name) ?? new Set(); values.add(callback); listeners.set(name, values);
    return { remove: () => values.delete(callback) };
  };
  const AppState = {
    get currentState() { return appState; },
    addEventListener: (name, callback) => add(`app:${name}`, callback),
  };
  const Keyboard = {
    addListener: add,
    scheduleLayoutAnimation: () => { animations++; },
  };
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const Animated = { Value, View: 'AnimatedView', timing: () => ({ start() {}, stop() {} }) };
  const module = { exports: {} };
  runInNewContext(output, {
    module, exports: module.exports, React,
    useEffect: React.useEffect, useRef: React.useRef, useState: React.useState,
    useWindowDimensions: () => ({ height: 844 }),
    AppState, Keyboard, Animated, Easing: { out: value => value, cubic: 'cubic' }, Platform: { OS: 'ios' },
    Modal: 'Modal', View: 'View', Pressable: 'Pressable', s: { modalRoot: {}, backdrop: {}, keyboardLayer: {}, composer: {} }, Math,
  });
  const EditorSheet = module.exports.EditorSheet;
  function Form() {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return React.createElement('Input', { value: 'keep this draft' });
  }
  let root;
  await act(async () => { root = create(React.createElement(EditorSheet, {
    visible: true, closeLabel: 'Close', busy: false, bottomInset: 34, reduceMotion: true, onClose() {},
  }, React.createElement(Form))); });
  const padding = () => root.root.findAllByType('View').find(node => node.props.pointerEvents === 'box-none').props.style[1].paddingBottom;
  const emit = async (name, value) => act(async () => { for (const callback of listeners.get(name) ?? []) callback(value); });
  assert.equal(padding(), 0);
  let metrics = { screenX: 0, screenY: 514, width: 390, height: 330 };
  await emit('keyboardWillChangeFrame', { duration: 250, easing: 'keyboard', endCoordinates: metrics });
  assert.equal(padding(), 330);
  appState = 'inactive'; await emit('app:change', appState); assert.equal(padding(), 0);
  appState = 'background'; await emit('app:change', appState); assert.equal(padding(), 0);
  metrics = { ...metrics, screenY: 544, height: 300 };
  await emit('keyboardWillChangeFrame', { duration: 250, easing: 'keyboard', endCoordinates: metrics });
  assert.equal(padding(), 0, 'fresh native frame may arrive before AppState becomes active');
  appState = 'active'; await emit('app:change', appState); assert.equal(padding(), 300);
  await emit('keyboardWillHide', { duration: 250, easing: 'keyboard', endCoordinates: metrics });
  assert.equal(padding(), 0);
  assert.equal(animations, 3);
  assert.deepEqual({ mounts, unmounts }, { mounts: 1, unmounts: 0 });
  await act(async () => root.unmount());
  assert.equal(unmounts, 1);
  assert.ok([...listeners.values()].every(values => values.size === 0));
});

test('channel-list content leaves room for the floating button', () => {
  assert.match(channel, /data=\{channels\}[\s\S]*?contentContainerStyle=\{\[s\.list, \{ paddingBottom: 96 \+ insets\.bottom \}\]\}/);
});
