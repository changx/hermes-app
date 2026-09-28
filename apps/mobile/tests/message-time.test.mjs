import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatMessageTime, nextMessageTimeUpdate, validTimestampSeconds, absoluteMessageTime, accessibleMessageTime } from '../src/messageTime.ts';
import { newSend, connection } from '../src/send.ts';
import { OutboxStore } from '../src/outbox.ts';
import { projectTimeline } from '../src/timeline.ts';

const id = 'mob_123e4567-e89b-12d3-a456-426614174000';
const config = connection('https://example.test', 'secret', 'conn');

test('relative boundaries, invalid/epoch/future values, local absolute date', () => {
  const now = new Date(2026, 8, 27, 13, 4, 5).getTime();
  for (const [age, label] of [[0, '0s ago'], [5, '5s ago'], [59, '59s ago'], [60, '1m ago'], [719, '11m ago'], [3599, '59m ago'], [3600, '1h ago'], [86399, '23h ago']]) {
    assert.equal(formatMessageTime(now / 1000 - age, now), label);
  }
  assert.equal(formatMessageTime(now / 1000 - 86400, now), absoluteMessageTime(now / 1000 - 86400));
  assert.equal(formatMessageTime(now / 1000 + 500, now), '0s ago');
  assert.equal(formatMessageTime(0, 0), '0s ago');
  assert.equal(validTimestampSeconds(0), true);
  for (const value of [undefined, null, NaN, Infinity, -1, 8.64e12 + 1, '123']) {
    assert.equal(formatMessageTime(value, now), '—');
    assert.equal(nextMessageTimeUpdate(value, now), null);
  }
  assert.equal(nextMessageTimeUpdate(now / 1000 - 59, now), 1000);
  assert.equal(nextMessageTimeUpdate(now / 1000 - 3599, now), 1000);
  assert.equal(nextMessageTimeUpdate(now / 1000 - 86399, now), 1000);
  assert.equal(nextMessageTimeUpdate(now / 1000 - 86400, now), null);
  assert.equal(nextMessageTimeUpdate(8.64e12, now), 2147483647);
});

test('absolute formatting follows device timezone and preserves second/zero padding', () => {
  const script = "import {formatMessageTime,accessibleMessageTime} from './src/messageTime.ts'; console.log(JSON.stringify([formatMessageTime(0,86400000),accessibleMessageTime(0)]))";
  for (const [tz, visible, full] of [
    ['UTC', '01/01 00:00:00', '1970-01-01 00:00:00'],
    ['America/Los_Angeles', '12/31 16:00:00', '1969-12-31 16:00:00'],
    ['Asia/Kolkata', '01/01 05:30:00', '1970-01-01 05:30:00']
  ]) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [visible, full]);
  }
});

function mountClock(seconds, initialMs) {
  let now = initialMs, state, cleanup, effectDeps;
  const timers = new Map(), listeners = new Set(), renders = [];
  let nextId = 0;
  const date = class extends Date { static now() { return now; } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    memo: fn => fn,
    useState: init => { state ??= init(); return [state, value => { if (state !== value) { state = value; renders.push(value); } }]; },
    useEffect: (fn, deps) => { if (!effectDeps || deps.some((value, i) => value !== effectDeps[i])) { cleanup?.(); effectDeps = deps; cleanup = fn(); } }
  };
  const native = { AppState: { currentState: 'active', addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } }, Text: 'Text' };
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/MessageTime.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module: output, exports: output.exports, Date: date,
    require: name => name === 'react' ? { ...react, default: react } : name === 'react-native' ? native : name === './FontSize' ? { Text: native.Text } : name === './messageTime' ? { formatMessageTime, nextMessageTimeUpdate, validTimestampSeconds, accessibleMessageTime } : assert.fail(name),
    setTimeout: (fn, delay) => { const key = ++nextId; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout: key => timers.delete(key) });
  const Component = output.exports.MessageTime;
  const render = () => Component({ seconds });
  const tree = render();
  const advance = ms => {
    const target = now + ms;
    while (true) {
      const earliest = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!earliest || earliest[1].at > target) break;
      now = earliest[1].at; timers.delete(earliest[0]); earliest[1].fn();
    }
    now = target;
  };
  return { tree, render, advance, renders, timers, listeners, updateSeconds: value => { seconds = value; render(); return render(); }, state: value => listeners.forEach(fn => fn(value)), unmount: () => cleanup?.(), time: () => now };
}

test('actual native time component ticks independently; background pauses, foreground refreshes, unmount cleans', () => {
  const mounted = mountClock(1000, 1059000);
  assert.equal(mounted.tree.props.children[0], '59s ago');
  assert.equal(mounted.tree.props.accessibilityLabel, `Sent ${accessibleMessageTime(1000)}`);
  assert.equal(mounted.timers.size, 1);
  mounted.advance(1000);
  assert.equal(mounted.render().props.children[0], '1m ago');
  assert.equal(mounted.renders.length, 1);
  mounted.state('background'); assert.equal(mounted.timers.size, 0);
  mounted.advance(3600000); assert.equal(mounted.renders.length, 1);
  mounted.state('active'); assert.equal(mounted.render().props.children[0], '1h ago');
  assert.equal(mounted.timers.size, 1);
  mounted.unmount(); assert.equal(mounted.timers.size, 0); assert.equal(mounted.listeners.size, 0);
  mounted.advance(100000); assert.equal(mounted.renders.length, 2);
  const unknown = mountClock(undefined, 1000);
  assert.equal(unknown.tree.props.children[0], '—');
  assert.equal(unknown.tree.props.accessibilityLabel, 'Time unavailable');
  assert.equal(unknown.timers.size, 0); unknown.unmount();
});

test('a newly received authoritative timestamp refreshes against the current clock immediately', () => {
  const mounted = mountClock(undefined, 1000000);
  mounted.advance(7200000);
  assert.equal(mounted.updateSeconds(mounted.time() / 1000 - 5400).props.children[0], '1h ago');
  assert.equal(mounted.listeners.size, 1);
  mounted.unmount();
  assert.equal(mounted.timers.size, 0);
  assert.equal(mounted.listeners.size, 0);
});

test('outbox metadata retains one send time across status changes and cold boots; legacy has no fake time', async () => {
  const data = new Map();
  const storage = { getItemAsync: async key => data.get(key) ?? null, setItemAsync: async (key, value) => { data.set(key, value); }, deleteItemAsync: async key => { data.delete(key); } };
  const record = { ...newSend(config, 'thread', 'original', id), createdAt: 0 };
  const first = new OutboxStore(storage, config);
  await first.enqueue(record);
  await first.update({ ...record, status: 'ambiguous' }, 2, 999);
  await assert.rejects(first.update({ ...record, createdAt: 1 }), /identity/);
  const second = new OutboxStore(storage, config);
  assert.equal((await second.load())[0].createdAt, 0);
  await second.update({ ...second.records[0], status: 'accepted', receiptId: 'r', receiptState: 'queued', receiptRefSeq: 1 });
  const third = new OutboxStore(storage, config);
  assert.equal((await third.load())[0].createdAt, 0);
  assert.equal(projectTimeline([], third.records[0], 'thread', undefined, true)[0].timestamp, 0);
  const metaKey = [...data.keys()].find(key => !key.includes('.part.'));
  const originalMeta = data.get(metaKey);
  const meta = JSON.parse(originalMeta);
  delete meta.createdAt;
  data.set(metaKey, JSON.stringify(meta));
  const legacy = new OutboxStore(storage, config);
  assert.equal((await legacy.load())[0].createdAt, undefined);
  assert.equal(projectTimeline([], legacy.records[0], 'thread', undefined, true)[0].timestamp, undefined);
  for (const bad of [null, '100', -1, 8.64e12 + 1]) {
    data.set(metaKey, JSON.stringify({ ...meta, createdAt: bad }));
    await assert.rejects(new OutboxStore(storage, config).load(), /damaged/);
  }
  data.set(metaKey, originalMeta);
  assert.equal((await new OutboxStore(storage, config).load())[0].createdAt, 0);
});
