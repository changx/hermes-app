import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the actual App send callback: file upload selection must cross the
// durable enqueue boundary before clearing anything visible.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'send') initializer = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(initializer);
const code = ts.transpileModule('globalThis.sendCallback = ' + initializer, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness({ reject = false, uploading = false, switchThread = false } = {}) {
  const events = [], attachments = [{ id: 'att_a', thread_id: 't', state: 'available' }];
  const context = {
    config: { id: 'connection' }, threadId: 't', text: '', composerScope: 'connection:t', currentComposer: { current: 'connection:t' },
    draftAttachments: attachments, attachmentsBusy: uploading,
    Crypto: { randomUUID: () => 'uuid' },
    newSend: (...args) => { events.push(['record', ...args]); return { attachments: args[4], text: args[2] }; },
    outboxRef: { current: { storage: { connectionId: 'connection' }, enqueue: async record => { events.push(['enqueue', record]); if (switchThread) context.currentComposer.current = 'connection:other'; if (reject) throw Error('storage unavailable'); } } },
    timelineRef: { current: { followLatest() { events.push(['follow']); } } },
    setText: callback => events.push(['text', callback('')]),
    setAttachmentDraft: value => events.push(['attachments', value]),
    setAttachmentClearKey: callback => events.push(['clear', callback(3)]),
    run: async fn => { try { await fn(); } catch { events.push(['failed']); } },
  };
  runInNewContext(code, context);
  return { context, events, attachments };
}

test('App submits attachment-only selection and clears only after durable enqueue', async () => {
  const h = harness(); await h.context.sendCallback();
  assert.deepEqual(h.events.map(e => e[0]), ['record', 'enqueue', 'follow', 'text', 'attachments', 'clear']);
  assert.equal(h.events[0][5], h.attachments);
  assert.equal(h.events[1][1].text, '');
  assert.equal(h.events[1][1].attachments, h.attachments);
});
test('App retains draft after durable storage failure and never sends during upload', async () => {
  const fail = harness({ reject: true }); await fail.context.sendCallback();
  assert.deepEqual(fail.events.map(e => e[0]), ['record', 'enqueue', 'failed']);
  const busy = harness({ uploading: true }); await busy.context.sendCallback(); assert.equal(busy.events.length, 0);
});
test('completion after switching threads cannot clear another composer or move its timeline', async () => {
  const h = harness({ switchThread: true }); await h.context.sendCallback();
  assert.deepEqual(h.events.map(e => e[0]), ['record', 'enqueue']);
});
