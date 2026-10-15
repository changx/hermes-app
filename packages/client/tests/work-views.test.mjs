import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseWorkViews, workGroups } from '../src/workPresentation.ts';

const tool = (key, seconds) => ({ key, role: 'assistant', seconds });

test('battery: a new tool row keeps the same group view for earlier rows', () => {
  const first = reuseWorkViews(new Map(), workGroups([tool('a', 1), tool('b', 2)], true));
  const view = first.get('a');
  assert.equal(first.get('b'), view, 'members of one group share one view');
  assert.deepEqual(view, { key: 'a', completion: undefined, label: 'Working', running: true });
  const second = reuseWorkViews(first, workGroups([tool('a', 1), tool('b', 2), tool('c', 3)], true));
  assert.equal(second.get('a'), view); assert.equal(second.get('b'), view); assert.equal(second.get('c'), view);
});

test('battery: completion or a stopped run gives the group a new view', () => {
  const running = reuseWorkViews(new Map(), workGroups([tool('a', 1)], true));
  const stopped = reuseWorkViews(running, workGroups([tool('a', 1)], false));
  assert.notEqual(stopped.get('a'), running.get('a'));
  assert.equal(stopped.get('a').label, 'Work recorded');
  const done = reuseWorkViews(stopped, workGroups([tool('a', 1), { key: 'f', role: 'assistant', kind: 'final', seconds: 61 }], false));
  assert.notEqual(done.get('a'), stopped.get('a'));
  assert.deepEqual(done.get('a'), { key: 'a', completion: 'f', label: 'Worked for 1m 0s', running: false });
  assert.equal(done.has('f'), false);
});
