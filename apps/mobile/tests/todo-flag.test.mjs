import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { hasTodo, isTodoLabel, runningFirst, todoSessions, toggledTodo, withoutTodo, TODO_LABEL_LIMIT, TodoLimitError } from '../../../packages/client/src/todo.ts';
import { setThreadTodo, TODO_FAILURE } from '../src/todoToggle.ts';

test('todo label: any case counts, the app writes `todo`, other labels keep their order', () => {
  assert.ok(isTodoLabel('todo') && isTodoLabel('TODO') && isTodoLabel('ToDo'));
  assert.ok(!isTodoLabel('todos') && !isTodoLabel(' todo') && !isTodoLabel('to do'));
  assert.equal(hasTodo(['a', 'Todo']), true); assert.equal(hasTodo(undefined), false);
  assert.deepEqual(toggledTodo(['a', 'b'], true), ['a', 'b', 'todo']);
  assert.deepEqual(toggledTodo(['TODO', 'a'], true), ['TODO', 'a'], 'already flagged: unchanged');
  assert.deepEqual(toggledTodo(['todo', 'a', 'TODO'], false), ['a']);
  assert.deepEqual(withoutTodo(['x', 'todo', 'y']), ['x', 'y']);
  const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);
  assert.throws(() => toggledTodo(ten, true), TodoLimitError);
  assert.deepEqual(toggledTodo([...ten.slice(0, 9), 'todo'], true).length, 10);
});

test('the todo limit equals the server label limit', async () => {
  const out = await build({ entryPoints: [new URL('../../../packages/client/src/sessionLabels.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', write: false });
  const { MAX_LABELS } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  assert.equal(TODO_LABEL_LIMIT, MAX_LABELS);
});

test('Todo order: running first, then newest activity, any age', () => {
  const rows = [{ id: 'a', title: 'a', lastMessageAt: 10, markers: ['todo'] }, { id: 'b', title: 'b', lastMessageAt: 1, running: true, markers: ['TODO'] },
    { id: 'c', title: 'c', lastMessageAt: 50, markers: ['x'] }, { id: 'd', title: 'd', lastMessageAt: 20, markers: ['todo'] }];
  assert.deepEqual(todoSessions(rows).map(r => r.id), ['b', 'd', 'a']);
  assert.deepEqual([...rows].sort(runningFirst).map(r => r.id), ['b', 'c', 'd', 'a']);
});

test('mobile toggle saves through the label API and reports only user-level failures', async () => {
  const saved = [];
  const client = { threads: new Map([['t', { markers: ['bug'] }]]), saveThreadLabels: async (id, markers) => { saved.push([id, markers]); return { markers }; } };
  assert.equal(await setThreadTodo(client, 't', true), '');
  assert.deepEqual(saved, [['t', ['bug', 'todo']]]);
  client.saveThreadLabels = async () => { throw new Error('HTTP 503 /v1/threads/t/labels'); };
  assert.equal(await setThreadTodo(client, 't', true), TODO_FAILURE, 'no technical detail');
  client.saveThreadLabels = async () => ({ markers: ['bug'] });
  assert.match(await setThreadTodo(client, 't', true), /another device/);
  client.threads.set('full', { markers: Array.from({ length: 10 }, (_, i) => `l${i}`) });
  assert.match(await setThreadTodo(client, 'full', true), /up to 10 labels/);
});
