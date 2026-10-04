import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { SessionOpenMeasurement, timingReport } from '../src/sessionTiming.ts';
import { compile } from './render-resource-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('timing uses monotonic phase boundaries, records overlapping requests without adding them to total', () => {
  let now = 0;
  const trace = new SessionOpenMeasurement('tap', () => now);
  now = 80; trace.mark('page-mounted'); now = 100; trace.observe({ stage: 'open-start' });
  now = 300; trace.observe({ stage: 'watch-ready' }); trace.observe({ stage: 'history-start' });
  trace.observe({ request: 'history', edge: 'start', sequence: 1 });
  trace.observe({ request: 'catalogue', edge: 'start', sequence: 2 });
  now = 700; trace.observe({ request: 'catalogue', edge: 'end', sequence: 2 });
  now = 900; trace.observe({ request: 'history', edge: 'end', sequence: 1 });
  now = 950; trace.observe({ stage: 'history-ready', rows: 30 }); trace.observe({ stage: 'state-start' });
  now = 1450; trace.observe({ stage: 'state-ready' }); trace.observe({ stage: 'open-ready' });
  now = 1460; trace.mark('ui-ready'); now = 1530; trace.mark('visible-rows');
  const text = timingReport(trace.result);
  assert.match(text, /Total \(tap to callback\): 1530 ms/);
  assert.match(text, /History ready to UI release: 510 ms/);
  assert.match(text, /History response to local merge complete: 50 ms/);
  assert.match(text, /After UI release to callback: 70 ms/);
  assert.match(text, /history: 1 request\(s\), 600 ms/); assert.match(text, /catalogue: 1 request\(s\), 400 ms/);
  assert.match(text, /Most elapsed time was before UI release/);
  assert.match(text, /not add them to total/); assert.match(text, /Not a pixel-paint/);
  now = 6000; trace.mark('visible-rows'); trace.observe({ stage: 'history-ready', rows: 90 });
  assert.equal(timingReport(trace.result), text, 'completed sample never changes on live updates');
});

test('client presentation dominance, empty, failed and cancelled outcomes are distinct', () => {
  let now = 0; const clock = () => now;
  const trace = new SessionOpenMeasurement('page', clock);
  now = 20; trace.mark('ui-ready'); now = 1000; trace.mark('visible-rows');
  assert.match(timingReport(trace.result), /page acquisition/); assert.match(timingReport(trace.result), /after UI release; inspect client presentation/);
  for (const outcome of ['empty-frame', 'cancelled', 'failed']) {
    const sample = new SessionOpenMeasurement('page', clock); sample.mark(outcome);
    assert.ok(!timingReport(sample.result).includes('Most elapsed time'));
    assert.match(timingReport(sample.result), outcome === 'empty-frame' ? /no message-render measurement/ : /Incomplete sample/);
  }
});

test('measurement switch is build opt-in, can be disabled, and retains no completed navigation sample for a new page', () => {
  for (const available of [false, true]) {
    const source = { SessionOpenMeasurement };
    const config = compile('sessionTimingSwitch.ts', { './sessionTiming': source }, '', { process: { env: { EXPO_PUBLIC_SESSION_TIMING: available ? '1' : '0' } } });
    config.beginSessionTiming('internal-thread-id');
    const trace = config.sessionTimingForPage('internal-thread-id');
    assert.equal(!!trace, available);
    if (trace) {
      trace.mark('visible-rows'); assert.ok(!JSON.stringify(trace.result).includes('internal-thread-id'));
      assert.notEqual(config.sessionTimingForPage('internal-thread-id'), trace);
      config.setSessionTimingEnabled(false); assert.equal(config.sessionTimingForPage('next'), null);
      config.setSessionTimingEnabled(true); assert.ok(config.sessionTimingForPage('next'));
    } else {
      config.setSessionTimingEnabled(true); assert.equal(config.sessionTimingForPage('next'), null);
    }
  }
});

test('actual temporary panel displays numeric results, copies them and hides without changing the sample', async () => {
  const copied = [], enabled = [];
  const panel = compile('SessionTimingPanel.tsx', {
    react: React,
    'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: value => value } },
    'expo-clipboard': { setStringAsync: async text => copied.push(text) }, './FontSize': { Text: 'Text' },
    './sessionTiming': { SessionOpenMeasurement, timingReport },
    './sessionTimingSwitch': { SESSION_TIMING_AVAILABLE: true, isSessionTimingEnabled: () => true, setSessionTimingEnabled: value => enabled.push(value) },
  });
  const trace = new SessionOpenMeasurement('tap');
  trace.mark('open-start'); trace.mark('history-start'); trace.observe({ stage: 'history-ready', rows: 1 }); trace.mark('ui-ready');
  let root;
  await act(async () => { root = create(React.createElement(panel.SessionTimingPanel, { measurement: trace, active: true })); });
  await act(async () => trace.mark('visible-rows'));
  const json = JSON.stringify(root.toJSON()); assert.match(json, /Total/); assert.match(json, /After UI release/);
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Show timing details' }).props.onPress());
  assert.equal(root.root.findByType('Modal').props.visible, true);
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Copy timing result' }).props.onPress());
  assert.deepEqual(copied, [timingReport(trace.result)]);
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Hide timing result' }).props.onPress());
  assert.equal(root.toJSON(), null); assert.equal(copied[0], timingReport(trace.result));
  await act(async () => root.unmount());
  await act(async () => { root = create(React.createElement(panel.SessionTimingControl)); });
  await act(async () => root.root.findByType('Pressable').props.onPress());
  assert.deepEqual(enabled, [false]); await act(async () => root.unmount());
});
