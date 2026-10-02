import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const provider = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'AppProvider');
const effect = provider.body.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) &&
  n.expression.expression.getText(app) === 'useEffect' && n.getText(app).includes('let foreground'));
assert.ok(effect, 'execute the actual connection-independent provider lifecycle effect');
function compile(source, modules, context = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, ...context, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  return exports;
}
async function harness(editorName = 'NewTopicEditor', initial = 'active') {
  const listeners = new Set(), dismissals = [], aborts = [];
  let inputMounts = 0, attachmentMounts = 0, root;
  const AppState = { currentState: initial, addEventListener(name, callback) {
    assert.equal(name, 'change'); listeners.add(callback); return { remove() { listeners.delete(callback); } };
  } };
  const Keyboard = { dismiss() { dismissals.push(AppState.currentState); } };
  function Input(props) {
    React.useEffect(() => { inputMounts++; }, []);
    return React.createElement('Input', props);
  }
  function Attachments(props) {
    const [items] = React.useState(['fixture local attachment']);
    React.useEffect(() => { attachmentMounts++; props.onSelectionChange?.(items.length); }, []);
    return React.createElement('Attachments', { items }, props.children);
  }
  const editor = compile(readFileSync(new URL('../src/EditorScreens.tsx', import.meta.url), 'utf8'), {
    react: React, 'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: x => x } },
    'expo-router': { useIsFocused: () => true, useFocusEffect: cb => React.useEffect(cb, [cb]) },
    'expo-crypto': { randomUUID: () => 'fixture' }, './FontSize': { Text: 'Text', TextInput: Input },
    './Attachments': { AttachmentComposer: Attachments }, './channel-edits': { channelPatch: () => ({}) },
  })[editorName];
  const Boundary = compile(`export function Boundary({ children }) {
    const pairingTask = React.useRef({ controller: { abort: () => aborts.push(AppState.currentState) } });
    const [, setPairingEpoch] = React.useState(0);
    ${effect.getText(app)}
    return children;
  }`, {}, { React, useEffect: React.useEffect, AppState, Keyboard, aborts }).Boundary;
  await act(async () => { root = create(React.createElement(Boundary, {},
    React.createElement(editor, { client: {}, channelId: 'fixture', onCreated() {} }))); });
  const transition = async state => { AppState.currentState = state; await act(async () => { for (const listener of listeners) listener(state); }); };
  return { root, transition, dismissals, aborts, get inputMounts() { return inputMounts; }, get attachmentMounts() { return attachmentMounts; },
    async close() { await act(async () => root.unmount()); assert.equal(listeners.size, 0); } };
}

test('dismiss once on active->inactive, before background, never auto-open on resume', async () => {
  const h = await harness();
  assert.deepEqual(h.dismissals, []);
  await h.transition('inactive'); assert.deepEqual(h.dismissals, ['inactive']);
  await h.transition('inactive'); await h.transition('background');
  assert.deepEqual(h.dismissals, ['inactive']);
  await h.transition('active'); await h.transition('active');
  assert.deepEqual(h.dismissals, ['inactive']);
  await h.transition('background'); assert.deepEqual(h.dismissals, ['inactive', 'background']);
  await h.transition('active'); await h.transition('inactive');
  assert.deepEqual(h.dismissals, ['inactive', 'background', 'inactive']);
  assert.ok(h.aborts.includes('inactive')); assert.ok(h.aborts.includes('background'));
  await h.close();
});

test('background mount has no synthetic dismissal; first real foreground leave does', async () => {
  const h = await harness('NewTopicEditor', 'background');
  await h.transition('background'); await h.transition('inactive'); assert.deepEqual(h.dismissals, []);
  await h.transition('active'); await h.transition('background'); assert.deepEqual(h.dismissals, ['background']);
  await h.close();
});

for (const name of ['NewTopicEditor', 'NewChannelEditor']) {
  test(`${name} retains Chinese draft, native input identities and local attachments through repeated foreground exits`, async () => {
    const h = await harness(name);
    const inputs = h.root.root.findAllByType('Input');
    await act(async () => { inputs.forEach((input, i) => input.props.onChangeText(`保留草稿${i}\n第二行`)); });
    for (let i = 0; i < 3; i++) {
      await h.transition('inactive'); await h.transition('background'); await h.transition('active');
      h.root.root.findAllByType('Input').forEach((input, index) => {
        assert.equal(input, inputs[index]); assert.equal(input.props.value, `保留草稿${index}\n第二行`);
      });
    }
    assert.equal(h.inputMounts, inputs.length);
    if (name === 'NewTopicEditor') {
      assert.equal(h.attachmentMounts, 1);
      assert.deepEqual(h.root.root.findByType('Attachments').props.items, ['fixture local attachment']);
    }
    assert.equal(h.dismissals.length, 3); await h.close();
  });
}

test('temporary collector and Report UI are removed; form avoidance and editor controls otherwise remain unchanged', () => {
  for (const path of ['../src/App.tsx', '../src/EditorScreens.tsx', '../src/app/new-channel.tsx', '../src/app/channels/[channelId]/new-topic.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /KeyboardCapture|useKeyboardCapture|onDiagnosticLayout|keyboardReport/);
  }
  const form = app.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'FormKeyboardAvoidingView').getText(app);
  assert.match(form, /behavior="padding"/); assert.match(form, /enabled=\{focused && keyboardVisible\}/);
  assert.doesNotMatch(effect.getText(app), /\.focus\(|setText|setIdentity|clear|metrics|screenY|setTimeout/);
});
