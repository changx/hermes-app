import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmSessionArchive, sessionMenuActions, sessionRowProps } from '../src/sessionMenu.ts';

const noop = () => {};
const base = { toggleTodo: noop, editLabels: noop, archive: noop };

test('Session menu: one item order everywhere; label items only with label support; rename only when given', () => {
  assert.deepEqual(sessionMenuActions({ ...base, labels: true, todo: false, rename: noop }).map(a => a.label), ['Mark as todo', 'Rename session', 'Edit labels', 'Archive session']);
  assert.deepEqual(sessionMenuActions({ ...base, labels: true, todo: true }).map(a => a.label), ['Remove todo', 'Edit labels', 'Archive session']);
  assert.deepEqual(sessionMenuActions({ ...base, labels: false, todo: true, rename: noop }).map(a => a.name), ['rename', 'archive']);
  assert.equal(sessionMenuActions({ ...base, labels: false, todo: false }).at(-1).destructive, true);
});

test('Session row: long press opens the menu; screen-reader actions run the same items; both wait while busy', () => {
  const alerts = [], ran = [];
  const alert = (title, message, buttons) => alerts.push({ title, buttons });
  const actions = sessionMenuActions({ ...base, labels: true, todo: false, toggleTodo: () => ran.push('todo'), archive: () => confirmSessionArchive(alert, () => ran.push('archived')) });
  let busy = false;
  const props = sessionRowProps('Plan', actions, alert, () => busy);
  assert.equal(props.accessibilityHint, 'Open session. Long press for options.');
  assert.deepEqual(props.accessibilityActions.map(a => a.name), ['todo', 'labels', 'archive']);
  props.onLongPress();
  assert.equal(alerts[0].title, 'Plan');
  assert.deepEqual(alerts[0].buttons.map(b => [b.text, b.style]), [['Mark as todo', undefined], ['Edit labels', undefined], ['Archive session', 'destructive'], ['Cancel', 'cancel']]);
  props.onAccessibilityAction({ nativeEvent: { actionName: 'todo' } });
  assert.deepEqual(ran, ['todo']);
  alerts[0].buttons[2].onPress();
  assert.equal(alerts[1].title, 'Archive this session?', 'archive asks first');
  assert.deepEqual(ran, ['todo']);
  alerts[1].buttons.find(b => b.text === 'Archive').onPress();
  assert.deepEqual(ran, ['todo', 'archived']);
  busy = true;
  props.onLongPress(); props.onAccessibilityAction({ nativeEvent: { actionName: 'todo' } });
  assert.equal(alerts.length, 2); assert.deepEqual(ran, ['todo', 'archived']);
});

test('every list of Session rows offers the shared menu', () => {
  const src = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  assert.match(src('ChannelScreens.tsx'), /\{\.\.\.sessionRowProps\(item\.title, sessionActions\(item\), Alert\.alert, \(\) => busy\)\}/, 'Channel list');
  assert.match(src('app/(tabs)/index.tsx'), /onPress=\{\(\) => navigation\.threadOn\(item\.slot, item\.id\)\}\s*\{\.\.\.menu\.rowProps\(/, 'Recents, Todo and search results');
  assert.match(src('app/automations/[automationId].tsx'), /onPress=\{\(\) => navigation\.thread\(item\.id\)\}\s*\{\.\.\.menu\.rowProps\(/, 'Automation conversations');
  // No list keeps a private copy of the menu.
  for (const path of ['ChannelScreens.tsx', 'app/(tabs)/index.tsx', 'app/automations/[automationId].tsx'])
    assert.doesNotMatch(src(path), /'Archive this session\?'/, path);
});
