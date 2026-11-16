import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/connectionGroups.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const G = module.exports;

const SLOT_A = 'a'.repeat(24), SLOT_B = 'b'.repeat(24);
const work = 'g0000000a', home = 'g0000000b';
const base = () => {
  let state = G.addGroup(G.NO_GROUPS, ' Work ', work);
  state = G.addGroup(state, 'Home', home);
  state = G.assignConnection(state, SLOT_A, work);
  state = G.assignConnection(state, 'primary', home);
  return state;
};

test('All shows every connection; a group shows only its own; ungrouped connections show only in All', () => {
  let state = base();
  assert.deepEqual(state.groups.map(g => g.name), ['Work', 'Home']);
  for (const slot of [SLOT_A, SLOT_B, 'primary']) assert.equal(G.showsConnection(state, slot), true);
  assert.equal(G.activeGroupName(state), 'All');
  state = G.setActiveGroup(state, work);
  assert.equal(G.activeGroupName(state), 'Work');
  assert.equal(G.showsConnection(state, SLOT_A), true);
  assert.equal(G.showsConnection(state, 'primary'), false);
  assert.equal(G.showsConnection(state, SLOT_B), false, 'an ungrouped connection is not in Work');
});

test('a connection belongs to one group at a time', () => {
  let state = G.assignConnection(base(), SLOT_A, home);
  assert.equal(G.groupOf(state, SLOT_A).name, 'Home');
  state = G.assignConnection(state, SLOT_A, null);
  assert.equal(G.groupOf(state, SLOT_A), undefined);
  assert.throws(() => G.assignConnection(state, SLOT_A, 'g99999999'), /Group unavailable/);
  assert.throws(() => G.assignConnection(state, 'not-a-slot', work), /Connection unavailable/);
});

test('names: trimmed, not empty, unique without case, limited length and characters', () => {
  const state = base();
  assert.throws(() => G.addGroup(state, 'work', 'g0000000c'), /already exists/);
  assert.throws(() => G.addGroup(state, '   ', 'g0000000c'), /Enter a group name/);
  assert.throws(() => G.addGroup(state, 'x'.repeat(41), 'g0000000c'), /40 characters/);
  assert.throws(() => G.addGroup(state, 'a\u202eb', 'g0000000c'), /unsupported characters/);
  assert.equal(G.renameGroup(state, work, 'WORK').groups[0].name, 'WORK', 'a group may change only the case of its own name');
  assert.throws(() => G.renameGroup(state, work, 'home'), /already exists/);
});

test('at most eight groups', () => {
  let state = G.NO_GROUPS;
  for (let i = 0; i < G.MAX_GROUPS; i++) state = G.addGroup(state, `Group ${i}`, `g${String(i).padStart(8, '0')}`);
  assert.throws(() => G.addGroup(state, 'One more', 'gffffffff'), /8 groups/);
});

test('deleting the active group shows All and ungroups its connections', () => {
  let state = G.setActiveGroup(base(), work);
  state = G.removeGroup(state, work);
  assert.equal(state.active, null);
  assert.equal(G.groupOf(state, SLOT_A), undefined);
  assert.equal(G.groupOf(state, 'primary').name, 'Home');
});

test('a removed connection leaves its group; prune drops connections that are no longer saved', () => {
  const state = base();
  assert.equal(G.forgetConnection(state, SLOT_A).members[SLOT_A], undefined);
  assert.equal(G.forgetConnection(state, SLOT_B), state, 'no change keeps the same object');
  assert.deepEqual(Object.keys(G.pruneMembers(state, ['primary']).members), ['primary']);
});

test('stored data is validated, and damaged data is rejected instead of repaired', () => {
  const state = G.setActiveGroup(base(), home);
  assert.deepEqual(G.parseConnectionGroups(JSON.parse(JSON.stringify(state))), state);
  const bad = [null, [], { groups: [], members: {}, active: 'g0000000a' }, { groups: [{ id: 'x', name: 'A' }], members: {}, active: null },
    { groups: [{ id: work, name: ' A' }], members: {}, active: null }, { groups: [{ id: work, name: 'A' }, { id: home, name: 'a' }], members: {}, active: null },
    { groups: [{ id: work, name: 'A' }], members: { [SLOT_A]: home }, active: null }, { groups: [], members: { bad: work }, active: null }];
  for (const value of bad) assert.throws(() => G.parseConnectionGroups(value), /Invalid connection groups/, JSON.stringify(value));
});

test('switcher choices and the unread mark of other groups', () => {
  let state = base();
  const unread = new Set(['primary']);
  assert.deepEqual(G.groupChoices(state, unread).map(c => [c.name, c.active, c.unread]), [['All', true, false], ['Work', false, false], ['Home', false, true]]);
  assert.equal(G.otherGroupUnread(state, unread), false, 'All already lists every connection');
  state = G.setActiveGroup(state, work);
  assert.equal(G.otherGroupUnread(state, unread), true);
  state = G.setActiveGroup(state, home);
  assert.equal(G.otherGroupUnread(state, unread), false, 'the unread result is in the shown group');
  assert.equal(G.otherGroupUnread(G.setActiveGroup(state, work), new Set([SLOT_B])), false, 'an ungrouped connection marks no group');
});
