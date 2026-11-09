import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionHeaderItems } from '../src/sessionHeaderItems.ts';
import { TODO_COLOR } from '../src/todoColor.ts';

test('iOS Session header: native buttons, todo flag first, options last', () => {
  const calls = [];
  const items = sessionHeaderItems({ onPress: () => calls.push('options'), todo: { on: false, busy: false, onPress: () => calls.push('todo') } });
  assert.deepEqual(items.map(i => [i.type, i.label, i.icon.name]), [['button', 'Mark as todo', 'flag'], ['button', 'Session options', 'ellipsis']]);
  items.forEach(i => i.onPress());
  assert.deepEqual(calls, ['todo', 'options']);
});

test('iOS Session header: flagged and busy states', () => {
  const [flag] = sessionHeaderItems({ onPress() {}, todo: { on: true, busy: true, onPress() {} } });
  assert.equal(flag.label, 'Remove todo');
  assert.equal(flag.icon.name, 'flag.fill');
  assert.equal(flag.tintColor, TODO_COLOR);
  assert.equal(flag.disabled, true);
  assert.deepEqual(sessionHeaderItems({ onPress() {} }).map(i => i.label), ['Session options'], 'no label support: no flag');
});

test('Session page uses native header items on iOS, so a button tap does not scroll to the top', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /Platform\.OS === 'ios' \? \{ headerRight: undefined, unstable_headerRightItems: \(\) => sessionHeaderItems\(headerButtons\) \}/);
  assert.match(app, /: \{ headerRight: \(\) => <SessionOptionsButton \{\.\.\.headerButtons\} \/> \}/);
});
