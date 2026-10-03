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

test('session list uses long press and accessible rename actions and never marks a session read', () => {
  const channels = readFileSync(new URL('../src/ChannelScreens.tsx', import.meta.url), 'utf8');
  assert.match(channels, /onLongPress=\{\(\) => sessionMenu\(item\)\}/);
  assert.match(channels, /name: 'rename', label: 'Rename session'/);
  assert.doesNotMatch(channels, /<IconAction label="Rename"/);
  assert.doesNotMatch(channels, /<Action label="Rename"/);
  assert.match(channels, /item\.running === true/);
  assert.doesNotMatch(channels, /markRead\(/);
  assert.match(channels, /unreadDot: \{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#4DA3FF' \}/);
  assert.doesNotMatch(channels, /Completed · Unread/);
});

test('conversation entry awaits scoped opening and reports only a visible completed result', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /await openingTask/);
  assert.match(app, /client\.openConversation\(id, requestedRef\)/);
  assert.doesNotMatch(app, /markRead\(|markVisibleRead|locatedThreads|olderCursors/);
  assert.match(app, /!focused \|\| !foreground \|\| !located/);
  assert.match(app, /visibleRefs\.includes\(result\.result_ref\)/);
  assert.match(app, /markResultRead\(threadId, result\.result_version, result\.result_ref\)/);
});