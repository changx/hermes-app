import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/threadListState.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { isThreadRunning } = module.exports;

test('topic running status follows only an active authoritative receipt', () => {
  const receipt = { id: 'r', thread_id: 'thread', state: 'running', processing: 'running' };
  assert.equal(isThreadRunning('thread', [receipt]), true);
  assert.equal(isThreadRunning('other', [receipt]), false);
  assert.equal(isThreadRunning('thread', [{ ...receipt, state: 'queued' }]), false);
  for (const processing of ['completed', 'failed', 'interrupted', 'unknown']) {
    assert.equal(isThreadRunning('thread', [{ ...receipt, processing }]), false);
  }
  assert.equal(isThreadRunning('thread', [{ ...receipt, processing: null }]), true);
});

test('topic list uses an icon rename action and never marks a topic read', () => {
  const channels = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
  assert.match(channels, /<IconAction label="Rename" ios="square\.and\.pencil" android="edit"/);
  assert.doesNotMatch(channels, /<Action label="Rename"/);
  assert.match(channels, /isThreadRunning\(item\.id, client\.receipts\.values\(\)\)/);
  assert.doesNotMatch(channels, /markRead\(/);
});

test('conversation entry marks the latest ref read only after latest history is located', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(cached\) \{[\s\S]*?if \(!client\.tailIncomplete\.has\(id\)\) markVisibleRead\(client\.threads\.get\(id\)\?\.last_ref \?\? 0\)/);
  assert.match(app, /await client\.historyWindow\(id\);[\s\S]*?setStartRef\([^\n]+\);\n\s*markVisibleRead\(client\.threads\.get\(id\)\?\.last_ref \?\? 0\);/);
  assert.match(app, /const page = await client\.history\(id, cursor, 100\);[\s\S]*?if \(!page\.next_cursor\) \{[\s\S]*?markVisibleRead\(client\.threads\.get\(id\)\?\.last_ref \?\? 0\);/);
  assert.match(app, /onVisibleRef=\{markVisibleRead\}/);
});