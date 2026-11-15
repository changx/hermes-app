import test from 'node:test';
import assert from 'node:assert/strict';


test('keyboard trace uploads only after typing, without the text, and throttles', async () => {
  globalThis.__reports = [];
  const trace = await import('../src/keyboardTrace.ts');
  trace.resetKeyboardTrace();
  trace.keyboardTrace('text', { len: 1 });
  assert.equal(trace.uploadKeyboardTrace('hide', 50000), false, 'no reporter, no upload');
  trace.resetKeyboardTrace();
  trace.setKeyboardTraceReporter((...args) => globalThis.__reports.push(args));
  trace.keyboardTrace('keyboardWillShow', { y: 520.33333, h: 336 });
  assert.equal(trace.uploadKeyboardTrace('hide', 100000), false, 'no typing, no upload');
  trace.keyboardTrace('text', { len: 3, lines: 1 });
  trace.keyboardTrace('kcStart', { h: 0, p: 1 });
  assert.equal(trace.uploadKeyboardTrace('hide', 200000), true);
  assert.equal(globalThis.__reports.length, 1);
  const [message, detail] = globalThis.__reports[0];
  assert.equal(message, 'keyboard-trace hide');
  const rows = detail.split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row[1]), ['keyboardWillShow', 'text', 'kcStart']);
  assert.equal(rows[0][2].y, 520.3);
  assert.deepEqual(Object.keys(rows[1][2]), ['len', 'lines']);
  trace.keyboardTrace('text', { len: 4, lines: 1 });
  assert.equal(trace.uploadKeyboardTrace('hide', 205000), false, 'throttled');
  assert.equal(trace.uploadKeyboardTrace('hide', 216000), true);
  for (let i = 0; i < 400; i++) trace.keyboardTrace('text', { len: i });
  assert.equal(trace.keyboardTraceEntries().length, 240);
});
