import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
  assert.match(channel, /<Pressable[^>]*style=\{s\.backdrop\}[\s\S]*?<KeyboardAvoidingView/);
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

test('editor keyboard avoidance clears while backgrounded and restores only for a visible keyboard', () => {
  const source = ts.createSourceFile('ChannelScreens.tsx', channel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(source) === 'editorKeyboardEnabled'));
  assert.ok(declaration);
  const output = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(output, { module, exports: module.exports });
  const enabled = module.exports.editorKeyboardEnabled;
  assert.equal(enabled(true, 'active', true), true);
  assert.equal(enabled(true, 'inactive', true), false);
  assert.equal(enabled(true, 'background', true), false);
  assert.equal(enabled(true, 'active', false), false);
  assert.equal(enabled(false, 'active', true), false);
  assert.match(channel, /AppState\.addEventListener\('change',[\s\S]*?state === 'active'[\s\S]*?Keyboard\.isVisible\(\)/);
  assert.match(channel, /enabled=\{Platform\.OS !== 'ios' \|\| editorKeyboardEnabled\(visible, appState, keyboardVisible\)\}/);
});

test('channel-list content leaves room for the floating button', () => {
  assert.match(channel, /data=\{channels\}[\s\S]*?contentContainerStyle=\{\[s\.list, \{ paddingBottom: 96 \+ insets\.bottom \}\]\}/);
});
