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

test('new-channel description is bounded, controls do not shrink, and both drafts survive updates and failed creation', async () => {
  let mounts = 0, unmounts = 0, fail = true;
  const calls = [], created = [];
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
    './channel-edits': { channelPatch: (name, description) => ({ name: name.trim(), description: description.trim() }) },
  };
  const exports = {};
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  const client = { async createChannel(...args) {
    calls.push(args); if (fail) throw new Error('fixture failure'); return { id: 'created-channel' };
  } };
  const props = { client, onCreated: id => created.push(id) };
  let root;
  await act(async () => { root = create(React.createElement(exports.NewChannelEditor, props)); });
  const input = label => root.root.findAllByType('Input').find(node => node.props.accessibilityLabel === label);
  const name = input('Channel name'), description = input('Channel description');
  assert.equal(Object.assign({}, ...name.props.style).flexShrink, 0);
  const style = Object.assign({}, ...description.props.style);
  assert.equal(style.flex, 1); assert.equal(style.minHeight, 0);
  const area = description.parent.parent;
  assert.equal(area.props.collapsable, false);
  assert.equal(area.props.style.flex, 1); assert.equal(area.props.style.minHeight, 0);
  const hint = root.root.findAllByType('Text').find(node => node.props.children === 'New topics will use this description. Existing conversations will not change.');
  const footer = hint.parent;
  assert.equal(footer.props.collapsable, false);
  assert.equal(footer.props.style.flexShrink, 0);
  const button = () => root.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Create channel');
  assert.equal(button().props.disabled, true);
  await act(async () => { name.props.onChangeText('频道名称'); description.props.onChangeText('保留频道说明\n第二行'); });
  for (let i = 0; i < 5; i++) {
    await act(async () => root.update(React.createElement(exports.NewChannelEditor, props)));
    assert.equal(input('Channel name'), name); assert.equal(input('Channel description'), description);
    assert.equal(name.props.value, '频道名称'); assert.equal(description.props.value, '保留频道说明\n第二行');
  }
  assert.equal(button().props.disabled, false);
  await act(async () => button().props.onPress());
  assert.equal(name.props.value, '频道名称'); assert.equal(description.props.value, '保留频道说明\n第二行');
  assert.equal(created.length, 0);
  assert.ok(root.root.findAllByType('Text').some(node => node.props.accessibilityRole === 'alert'));
  fail = false;
  await act(async () => button().props.onPress());
  assert.deepEqual(calls, [['频道名称', '保留频道说明\n第二行'], ['频道名称', '保留频道说明\n第二行']]);
  assert.deepEqual(created, ['created-channel']);
  assert.equal(mounts, 2); assert.equal(unmounts, 0);
  await act(async () => root.unmount());
  assert.equal(unmounts, 2);
});
