import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CONFIG_KEY, PAIRING_KEY, completePairing, newPairing } from '../src/pairing.ts';
import { INDEX_KEY, MAX_CONNECTIONS, PRIMARY, loadSlots, removeSlot, reserveSlot, serverName, slotIdentity, slotKeys } from '../src/connectionSlots.ts';

const storage = () => ({ data: new Map(), async getItemAsync(k) { return this.data.get(k) ?? null; },
  async setItemAsync(k, v) { assert.match(k, /^[\w.-]+$/); this.data.set(k, v); }, async deleteItemAsync(k) { this.data.delete(k); } });
const pairing = (server, id) => newPairing(server, 'ABCD-EFGH-IJKL-MNOP', 'iPhone', id, randomBytes(44));
const hex = () => randomBytes(12).toString('hex');
const caps = { protocol: 1 };
const ok = pending => async url => url.endsWith('/capabilities') ? new Response(JSON.stringify(caps), { status: 200 }) : new Response('{}', { status: 500 });

test('existing single connection becomes the primary slot without pairing again', async () => {
  const store = storage(), legacy = pairing('https://one.example', 'legacy-id').config;
  store.data.set(CONFIG_KEY, JSON.stringify(legacy));
  const slots = await loadSlots(store);
  assert.deepEqual(slots, [{ slot: PRIMARY, config: legacy, pending: null }]);
  assert.equal(slotIdentity(slots[0]), 'legacy-id');
  assert.equal(store.data.has(INDEX_KEY), false, 'loading alone does not write');
  assert.deepEqual(slotKeys(PRIMARY), { config: CONFIG_KEY, pairing: PAIRING_KEY });
});

test('additional slots pair with their own keys and never touch the primary credential', async () => {
  const store = storage(), legacy = pairing('https://one.example', 'legacy-id').config;
  store.data.set(CONFIG_KEY, JSON.stringify(legacy));
  const slot = await reserveSlot(store, await loadSlots(store), hex);
  assert.notEqual(slot, PRIMARY);
  assert.deepEqual(JSON.parse(store.data.get(INDEX_KEY)), { version: 1, slots: [slot] });
  const pending = pairing('https://two.example', 'second-id');
  const saved = await completePairing(pending, { store, signal: new AbortController().signal, keys: slotKeys(slot), fetcher: ok(pending) });
  assert.deepEqual(saved, pending.config);
  assert.equal(store.data.get(CONFIG_KEY), JSON.stringify(legacy));
  assert.equal(store.data.has(PAIRING_KEY), false);
  const slots = await loadSlots(store);
  assert.deepEqual(slots.map(s => [s.slot, slotIdentity(s)]), [[PRIMARY, 'legacy-id'], [slot, 'second-id']]);
});

test('an interrupted pairing restores as pending and an empty reserved slot is pruned', async () => {
  const store = storage();
  const first = await reserveSlot(store, [], hex);
  assert.equal(first, PRIMARY, 'an empty primary slot is reused first');
  const pending = pairing('https://one.example', 'pending-id');
  store.data.set(PAIRING_KEY, JSON.stringify(pending));
  const loaded = await loadSlots(store);
  const empty = await reserveSlot(store, loaded, hex);
  const slots = await loadSlots(store);
  assert.deepEqual(slots.map(s => [s.slot, s.config, s.pending?.config.id]), [[PRIMARY, null, 'pending-id']]);
  assert.equal(JSON.parse(store.data.get(INDEX_KEY) ?? '{"slots":[]}').slots.includes(empty), false);
});

test('a leftover candidate next to a saved connection is discarded; the connection stays', async () => {
  const store = storage(), saved = pairing('https://one.example', 'kept').config;
  store.data.set(CONFIG_KEY, JSON.stringify(saved));
  store.data.set(PAIRING_KEY, JSON.stringify(pairing('https://one.example', 'other')));
  const [slot] = await loadSlots(store);
  assert.deepEqual(slot, { slot: PRIMARY, config: saved, pending: null });
  assert.equal(store.data.has(PAIRING_KEY), false);
});

test('a damaged slot is reported and does not hide peers', async () => {
  const store = storage(), slot = hex(), peer = pairing('https://two.example', 'peer').config;
  store.data.set(CONFIG_KEY, '{broken');
  store.data.set(INDEX_KEY, JSON.stringify({ version: 1, slots: [slot] }));
  store.data.set(slotKeys(slot).config, JSON.stringify(peer));
  const slots = await loadSlots(store);
  assert.deepEqual(slots.map(s => [s.slot, !!s.damaged, s.config?.id ?? null]), [[PRIMARY, true, null], [slot, false, 'peer']]);
});

test('a damaged index is an error, not an empty list that could be overwritten', async () => {
  const store = storage();
  store.data.set(INDEX_KEY, '{"version":1,"slots":["../x"]}');
  await assert.rejects(loadSlots(store), /could not be read/);
  await assert.rejects(reserveSlot(store, [{ slot: PRIMARY, config: null, pending: null }], hex), /could not be read/);
  assert.equal(store.data.get(INDEX_KEY), '{"version":1,"slots":["../x"]}');
});

test('removing one slot deletes only its keys and index entry', async () => {
  const store = storage(), a = hex(), b = hex();
  store.data.set(CONFIG_KEY, JSON.stringify(pairing('https://one.example', 'p').config));
  store.data.set(INDEX_KEY, JSON.stringify({ version: 1, slots: [a, b] }));
  store.data.set(slotKeys(a).config, JSON.stringify(pairing('https://a.example', 'a').config));
  store.data.set(slotKeys(b).pairing, JSON.stringify(pairing('https://b.example', 'b')));
  await removeSlot(store, a);
  assert.equal(store.data.has(slotKeys(a).config), false);
  assert.deepEqual(JSON.parse(store.data.get(INDEX_KEY)).slots, [b]);
  assert.ok(store.data.has(CONFIG_KEY) && store.data.has(slotKeys(b).pairing));
  await removeSlot(store, PRIMARY);
  assert.equal(store.data.has(CONFIG_KEY), false);
  assert.deepEqual((await loadSlots(store)).map(s => s.slot), [b]);
  await removeSlot(store, b);
  assert.equal(store.data.has(INDEX_KEY), false);
});

test('the slot limit is eight including the primary slot', async () => {
  const store = storage();
  const full = Array.from({ length: MAX_CONNECTIONS }, (_, i) => ({ slot: i ? hex() : PRIMARY, config: null, pending: null }));
  await assert.rejects(reserveSlot(store, full, hex), /eight connections/);
  assert.throws(() => slotKeys('../escape'), /Invalid connection slot/);
  assert.equal(serverName('https://work.example'), 'work.example');
  assert.equal(serverName(null), 'Saved connection');
});
