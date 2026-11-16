import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS_KEY, loadGroups, saveGroups } from '../src/connectionGroupStore.ts';
import { NO_GROUPS, addGroup, assignConnection, setActiveGroup, showsConnection } from '../../../packages/client/src/connectionGroups.ts';

const storage = () => ({ data: new Map(), async getItemAsync(k) { return this.data.get(k) ?? null; },
  async setItemAsync(k, v) { assert.match(k, /^[\w.-]+$/); this.data.set(k, v); } });
const SLOT = 'c'.repeat(24);

test('groups round-trip through SecureStore and are read back before success', async () => {
  const store = storage();
  assert.equal(await loadGroups(store), NO_GROUPS, 'no item is no groups');
  let state = addGroup(NO_GROUPS, 'Work', 'g0000000a');
  state = setActiveGroup(assignConnection(state, SLOT, 'g0000000a'), 'g0000000a');
  await saveGroups(store, state);
  const loaded = await loadGroups(store);
  assert.deepEqual(loaded, state);
  assert.equal(showsConnection(loaded, SLOT), true);
  assert.equal(showsConnection(loaded, 'primary'), false);
  assert.doesNotMatch(store.data.get(GROUPS_KEY), /token|baseUrl/, 'only names and slot IDs are stored');
});

test('damaged or unknown data is an error, never an empty list that a later save would overwrite', async () => {
  for (const raw of ['{', JSON.stringify({ version: 2, state: NO_GROUPS }), JSON.stringify({ version: 1, state: { groups: [], members: { x: 'g1' }, active: null } })]) {
    const store = storage(); store.data.set(GROUPS_KEY, raw);
    await assert.rejects(loadGroups(store));
  }
});

test('a write that reads back differently is not reported as saved', async () => {
  const store = storage(); store.setItemAsync = async () => {};
  await assert.rejects(saveGroups(store, addGroup(NO_GROUPS, 'Home', 'g0000000b')), /could not be saved/);
});
