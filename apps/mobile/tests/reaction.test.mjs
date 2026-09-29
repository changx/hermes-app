import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { projectTimeline } from '../src/timeline.ts';
import { HermesClient } from '../../../packages/client/dist/index.js';

const message = (clientId, receiptId, ref = 1, thread = 'th') => ({ id: `m${ref}`, ref_seq: ref, role: 'user', text: 'same', thread_id: thread, client_message_id: clientId, receipt_id: receiptId });
const receipt = (id, clientId, state, thread = 'th') => ({ id, client_message_id: clientId, thread_id: thread, state, durable: true });
const record = (status, receiptState) => ({ connectionId: 'conn', threadId: 'th', clientMessageId: 'a', receiptId: status === 'accepted' ? 'ra' : undefined, receiptRefSeq: status === 'accepted' ? 1 : undefined, receiptState, text: 'same', status });
const rows = (messages, recs = [], cache = new Map(), interactions = []) => projectTimeline(messages, null, 'th', undefined, true, recs, cache, interactions);

for (const [processing, label, emoji] of [['running', 'Working', '👀'], ['completed', 'Completed', '✅'], ['failed', 'Failed', '❌'], ['unknown', 'Outcome unknown', '⚠️']]) {
  test(`exact user callback projects ${processing} without inventing a separate message`, () => {
    const result = rows([message('a', 'ra'), { id: 'bot', ref_seq: 2, role: 'assistant', text: 'answer' }], [], new Map([['ra', { ...receipt('ra', 'a', 'unknown'), processing }]]));
    assert.equal(result.length, 2);
    assert.equal(result[0].reaction.label, label);
    assert.equal(result[0].reaction.emoji, emoji);
    assert.equal(result[0].reaction.source, 'agent');
    assert.equal(result[1].reaction, undefined);
  });
}
test('followup handoff is handled without inventing a processing callback; cancel clears', () => {
  for (const state of ['queued', 'running', 'failed', 'interrupted', 'unknown']) {
    for (const processing of [undefined, null, 'interrupted']) {
      const r = { ...receipt('ra', 'a', state), admission: 'followup', handed_off: true, processing };
      assert.equal(rows([message('a', 'ra')], [], new Map([['ra', r]]))[0].reaction, undefined);
    }
  }
  for (const state of ['received', 'completed']) {
    for (const processing of [undefined, null]) {
      const r = { ...receipt('ra', 'a', state), admission: 'followup', handed_off: true, processing };
      assert.equal(rows([message('a', 'ra')], [], new Map([['ra', r]]))[0].reaction?.label, 'Handled');
    }
    const interrupted = { ...receipt('ra', 'a', state), admission: 'followup', handed_off: true, processing: 'interrupted' };
    assert.equal(rows([message('a', 'ra')], [], new Map([['ra', interrupted]]))[0].reaction, undefined);
  }
  assert.equal(rows([message('a', 'ra')])[0].reaction, undefined);
  assert.equal(rows([message('a', 'ra')], [], new Map([['ra', { ...receipt('ra', 'a', 'completed'), processing: null }]]))[0].reaction, undefined);
});
test('pending approval and clarification override only nonterminal matching receipt', () => {
  const approval = { state: 'pending', kind: 'approval', id: 'a', receipt_id: 'ra', thread_id: 'th' };
  const clarify = { ...approval, kind: 'clarify' };
  for (const [kind, label] of [[approval, 'Awaiting approval'], [clarify, 'Awaiting your answer']]) {
    assert.equal(rows([message('a', 'ra')], [], new Map([['ra', { ...receipt('ra', 'a', 'running'), processing: 'running' }]]), [kind])[0].reaction.label, label);
  }
  for (const state of ['completed', 'failed', 'interrupted', 'unknown']) {
    assert.notEqual(rows([message('a', 'ra')], [], new Map([['ra', { ...receipt('ra', 'a', state), processing: 'completed' }]]), [approval])[0].reaction?.label, 'Awaiting approval');
  }
  assert.equal(rows([message('a', 'ra')], [], new Map([['ra', { ...receipt('ra', 'a', 'running'), processing: 'running' }]]), [{ ...approval, receipt_id: 'rb' }])[0].reaction.label, 'Working');
  assert.equal(rows([message('a', 'ra')], [], new Map([['ra', { ...receipt('ra', 'a', 'running'), processing: 'completed' }]]), [approval])[0].reaction.label, 'Completed');
});
test('same text, cross thread, foreign client and receipt mismatch never borrow a reaction or shift key', () => {
  const msgs = [message('a', 'ra'), message('b', 'rb', 2), { id: 'old', ref_seq: 3, role: 'user', text: 'same' }];
  const cold = rows(msgs);
  assert.deepEqual(cold.map(x => x.reaction?.label), [undefined, undefined, undefined]);
  for (const wrong of [receipt('ra', 'b', 'completed'), receipt('ra', 'a', 'completed', 'other'), receipt('wrong', 'a', 'completed')]) {
    const next = rows(msgs, [], new Map([['ra', wrong]]));
    assert.deepEqual(next.map(x => x.key), cold.map(x => x.key));
    assert.equal(next[0].reaction, undefined);
    assert.equal(next[0].reactionSlot, true);
    assert.equal(next[1].reaction, undefined);
  }
  assert.equal(rows([message('a', 'ra')], [record('accepted', 'running')], new Map([['ra', receipt('ra', 'b', 'completed')]])).length, 1);
  assert.equal(rows([message('a', 'ra')], [{ ...record('accepted', 'running'), threadId: 'other' }]).length, 1);
});
test('local status remains honest, acceptance solid before agent completes, then exact optimistic key stays', () => {
  for (const status of ['queued', 'sending', 'ambiguous', 'blocked']) {
    const row = rows([], [record(status)])[0];
    assert.equal(row.status, status); assert.equal(row.reaction, undefined);
    assert.equal(!!row.sendError, status === 'blocked');
  }
  const accepted = rows([], [record('accepted', 'queued')]);
  assert.equal(accepted[0].reaction, undefined);
  assert.equal(accepted[0].status, 'accepted');
  assert.equal(rows([message('a', 'ra')], [record('accepted', 'queued')]).length, 1);
  assert.equal(rows([message('a', 'ra')], [record('accepted', 'queued')])[0].key, accepted[0].key);
  assert.equal(rows([], [{ ...record('accepted', 'queued'), receiptId: undefined }]).length, 0);
});

// Load the production helper without Node resolving its TS-only SDK import.
const module = { exports: {} };
class ProtocolError extends Error {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/receiptHydration.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: () => ({ ProtocolError }), AbortController, Map, JSON });
const { VisibleReceiptHydrator } = module.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
test('cold visible window is bounded at 30 identities, max three in flight; no render-loop replay', async () => {
  const calls = [], pending = [];
  const source = { receipts: new Map(), getReceipt: (id, signal) => { calls.push({ id, signal }); const d = deferred(); pending.push(d); return d.promise; } };
  const h = new VisibleReceiptHydrator();
  const msgs = Array.from({ length: 45 }, (_, i) => message(`c${i}`, `r${i}`, i + 1));
  h.update(source, 'th', msgs, 1); h.update(source, 'th', msgs, 1);
  assert.equal(calls.length, 3); assert.equal(calls[0].id, 'r15');
  for (let i = 0; i < 30; i++) { pending[i].resolve(receipt(calls[i].id, `c${i + 15}`, 'completed')); await tick(); }
  assert.equal(calls.length, 30);
  h.update(source, 'th', msgs, 1); assert.equal(calls.length, 30);
  h.cancel();
});
test('window cancellation invalidates stale replies, 404 never repeats, transient retries on reconnect', async () => {
  const pending = [], calls = [];
  const source = { receipts: new Map(), getReceipt: (id, signal) => { const d = deferred(); pending.push(d); calls.push({ id, signal }); return d.promise; } };
  const h = new VisibleReceiptHydrator();
  h.update(source, 'th', [message('a', 'ra')], 1);
  h.update(source, 'other', [message('z', 'rz')], 1);
  assert.equal(calls[0].signal.aborted, true);
  pending[0].resolve(receipt('ra', 'a', 'completed')); await tick();
  pending[1].reject(Object.assign(new Error('gone'), { status: 404 })); await tick();
  h.update(source, 'other', [message('z', 'rz')], 2); assert.equal(calls.length, 2);
  h.update(source, 'th', [message('a', 'ra')], 2); assert.equal(calls.length, 3);
  pending[2].reject(new TypeError('offline')); await tick();
  h.update(source, 'th', [message('a', 'ra')], 2); assert.equal(calls.length, 3);
  h.update(source, 'th', [message('a', 'ra')], 3); assert.equal(calls.length, 4);
  pending[3].resolve(receipt('ra', 'wrong', 'completed')); await tick();
  h.update(source, 'th', [message('a', 'ra')], 4); assert.equal(calls.length, 4);
  h.cancel();
});
test('real SDK canceled getReceipt cannot mutate cache from a late transport response', async () => {
  const d = deferred();
  const sdk = new HermesClient({ token: () => 'secret', http: { request: async () => d.promise }, socket: { connect() {} } });
  const abort = new AbortController();
  const p = sdk.getReceipt('ra', abort.signal);
  abort.abort();
  d.resolve({ status: 200, body: { receipt: receipt('ra', 'a', 'completed') } });
  await assert.rejects(p);
  assert.equal(sdk.receipts.has('ra'), false);
});
