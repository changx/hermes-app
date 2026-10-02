import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL('../src/EditorScreens.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;

test('new-topic native input has a bounded flexible slot and an independent non-shrinking footer', async () => {
  let mounts = 0, unmounts = 0;
  function Input(props) {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return React.createElement('Input', props);
  }
  const modules = {
    react: React,
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: x => x } },
    'expo-router': { useIsFocused: () => true, useFocusEffect: cb => React.useEffect(cb, [cb]) },
    'expo-crypto': { randomUUID: () => 'fixture-id' },
    './FontSize': { Text: 'Text', TextInput: Input },
    './Attachments': { AttachmentComposer: 'Attachments' },
    './channel-edits': { channelPatch: () => ({}) },
  };
  const exports = {};
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  let root;
  const client = {};
  await act(async () => { root = create(React.createElement(exports.NewTopicEditor, { client, channelId: 'channel', onCreated() {} })); });
  const input = () => root.root.findByType('Input');
  const first = input();
  const style = Object.assign({}, ...first.props.style);
  assert.equal(style.flex, 1);
  assert.equal(style.minHeight, 0, 'native text must not impose a 180pt floor after the viewport shrinks');
  const area = first.parent.parent;
  assert.equal(area.props.collapsable, false);
  assert.equal(area.props.style.flex, 1);
  assert.equal(area.props.style.minHeight, 0);
  const footer = root.root.findByType('Attachments').parent;
  assert.equal(footer.props.style.flexShrink, 0);
  assert.notEqual(footer, first.parent);
  await act(async () => first.props.onChangeText('后台切换时保留草稿\nsecond line'));
  for (let i = 0; i < 5; i++) {
    await act(async () => root.update(React.createElement(exports.NewTopicEditor, { client, channelId: 'channel', onCreated() {} })));
    assert.equal(input(), first);
    assert.equal(input().props.value, '后台切换时保留草稿\nsecond line');
  }
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
  await act(async () => root.unmount());
  assert.equal(unmounts, 1);
});
