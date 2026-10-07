import test from 'node:test';
import assert from 'node:assert/strict';
import { retryStep, NEW_TOPIC_ATTEMPTS } from '../src/retryStep.ts';

const noWait = async () => {};
const status = code => Object.assign(new Error('HTTP ' + code), { status: code });

test('a stale-connection network failure retries and succeeds without an error', async () => {
  let calls = 0;
  const value = await retryStep(async () => { if (++calls === 1) throw new TypeError('Network request failed'); return 'thread'; }, () => true, noWait);
  assert.equal(value, 'thread');
  assert.equal(calls, 2);
});

test('timeouts, 429 and 5xx retry with backoff; the attempt count is bounded', async () => {
  const waits = []; let calls = 0;
  const failure = status(503);
  await assert.rejects(retryStep(async () => { calls++; throw failure; }, () => true, async ms => { waits.push(ms); }), error => error === failure);
  assert.equal(calls, NEW_TOPIC_ATTEMPTS);
  assert.equal(waits.length, NEW_TOPIC_ATTEMPTS - 1);
  assert.ok(waits.every(ms => ms > 0 && ms <= 30000));
  let timed = 0;
  assert.equal(await retryStep(async () => { if (++timed < 3) throw Object.assign(new Error('HTTP request timed out'), { name: 'TimeoutError' }); return 1; }, () => true, noWait), 1);
  let limited = 0;
  assert.equal(await retryStep(async () => { if (++limited < 2) throw status(429); return 2; }, () => true, noWait), 2);
});

test('permanent failures surface at once and are not repeated', async () => {
  for (const failure of [status(409), status(401), Object.assign(new Error('bad'), { name: 'ProtocolError' }), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
    let calls = 0;
    await assert.rejects(retryStep(async () => { calls++; throw failure; }, () => true, noWait), error => error === failure);
    assert.equal(calls, 1, failure.message);
  }
});

test('a closed composer stops retrying', async () => {
  let calls = 0, alive = true;
  await assert.rejects(retryStep(async () => { calls++; throw new TypeError('Network request failed'); }, () => alive, async () => { alive = false; }));
  assert.equal(calls, 1);
});
