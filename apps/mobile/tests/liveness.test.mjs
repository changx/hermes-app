import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const load = () => {
  const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const receiptState = {}; runInNewContext(transpile('../src/receiptState.ts'), { exports: receiptState });
  const exports = {}; runInNewContext(transpile('../src/liveness.ts'), { exports, setTimeout, clearTimeout, require: id => { if (id === './receiptState') return receiptState; throw Error(id); } });
  return exports;
};
const { needsFastLiveness, ActivityWindow, LIVENESS_MS, IDLE_LIVENESS_MS, LIVE_BACKOFF_MS, ACTIVITY_WINDOW_MS } = load();

test('phone timing keeps the 10 s active budget and the server 30 s idle heartbeat', () => {
  assert.equal(LIVENESS_MS, 10_000);
  assert.equal(IDLE_LIVENESS_MS, 30_000);
  assert.deepEqual([...LIVE_BACKOFF_MS], [200, 500, 1000, 2000, 5000, 10_000, 20_000]);
  assert.equal(ACTIVITY_WINDOW_MS, 120_000);
});

test('fast liveness while a send, a run or recent use is pending', () => {
  const quiet = { records: [], threads: [{ running: false }], receipts: [{ state: 'completed' }] };
  assert.equal(needsFastLiveness(quiet, false), false);
  assert.equal(needsFastLiveness(quiet, true), true);
  for (const status of ['queued', 'sending', 'ambiguous', 'accepted']) assert.equal(needsFastLiveness({ ...quiet, records: [{ status }] }, false), true, status);
  assert.equal(needsFastLiveness({ ...quiet, records: [{ status: 'blocked' }] }, false), false, 'a failed send waits for the user');
  assert.equal(needsFastLiveness({ ...quiet, threads: [{ running: true }] }, false), true);
  assert.equal(needsFastLiveness({ ...quiet, receipts: [{ state: 'running' }] }, false), true);
  assert.equal(needsFastLiveness({ ...quiet, receipts: [{ state: 'running', processing: 'completed' }] }, false), false, 'terminal processing is not a run');
});

test('activity window reports only open and close, with one timer', () => {
  let now = 0, changes = 0; const timers = new Map(); let id = 0;
  const window = new ActivityWindow(() => changes++, () => now, 1000, { set: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; }, clear: key => timers.delete(key) });
  const run = to => { for (;;) { const due = [...timers].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn(); } now = to; };
  assert.equal(window.active, false);
  window.note(); assert.equal(window.active, true); assert.equal(changes, 1); assert.equal(timers.size, 1);
  for (let t = 100; t <= 900; t += 100) { now = t; window.note(); }
  assert.equal(changes, 1, 'repeated touches do not re-evaluate'); assert.equal(timers.size, 1);
  run(1500); assert.equal(window.active, true); assert.equal(changes, 1);
  run(1900); assert.equal(window.active, false); assert.equal(changes, 2); assert.equal(timers.size, 0);
  window.note(); assert.equal(changes, 3); window.stop(); assert.equal(timers.size, 0);
});
