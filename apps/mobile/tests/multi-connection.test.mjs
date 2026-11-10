import test from 'node:test';
import assert from 'node:assert/strict';
import { removedConnectionRoutes, routeSlot } from '../src/routeOwnership.ts';

test('removing a connection drops only its routes and keeps peer route keys', () => {
  const state = { index: 5, routes: [
    { key: 'home', name: '(tabs)' },
    { key: 'pa', name: 'channels/[channelId]', params: { channelId: 'p', connection: 'primary' } },
    { key: 'ta', name: 'threads/[threadId]', params: { threadId: 't', connection: 'primary' } },
    { key: 'pb', name: 'channels/[channelId]', params: { channelId: 'p', connection: 'b'.repeat(24) } },
    { key: 'vb', name: 'viewer/[id]', params: { id: 'viewer-b' } },
    { key: 'tb', name: 'threads/[threadId]', params: { threadId: 't', connection: 'b'.repeat(24) } },
  ] };
  const next = removedConnectionRoutes(state, new Set(['b'.repeat(24)]), id => id === 'viewer-b');
  assert.deepEqual(next.routes.map(route => route.key), ['home', 'pa', 'ta']);
  assert.equal(next.index, 2, 'focus moves to the nearest remaining page');
  assert.equal(next.routes[2], state.routes[2], 'kept routes are the same objects, so screens stay mounted');
});

test('focused peer page stays focused; no change returns null', () => {
  const state = { index: 1, routes: [{ key: 'b', name: 'threads/[threadId]', params: { threadId: 't', connection: 'b'.repeat(24) } }, { key: 'a', name: 'threads/[threadId]', params: { threadId: 't' } }] };
  const next = removedConnectionRoutes(state, new Set(['b'.repeat(24)]));
  assert.deepEqual(next.routes.map(route => route.key), ['a']);
  assert.equal(next.index, 0);
  assert.equal(removedConnectionRoutes(state, new Set(['c'.repeat(24)])), null);
  assert.equal(routeSlot({ name: 'threads/[threadId]', params: { threadId: 't' } }), 'primary', 'older routes belong to the primary slot');
  assert.equal(routeSlot({ name: 'connection' }), null);
  assert.equal(routeSlot({ name: 'automations/[automationId]', params: { automationId: 'j', connection: 'b'.repeat(24) } }), 'b'.repeat(24));
});

test('an emptied stack falls back to the home route', () => {
  const next = removedConnectionRoutes({ index: 0, routes: [{ key: 'x', name: 'settings/connection', params: { connection: 'primary' } }] }, new Set(['primary']));
  assert.deepEqual(next.routes, [{ name: '(tabs)' }]);
  assert.equal(next.index, 0);
});

test('removing a connection pops its settings page but keeps the shared settings pages', () => {
  const b = 'b'.repeat(24);
  const state = { index: 2, routes: [{ key: 'home', name: '(tabs)' }, { key: 'settings', name: 'settings/index' }, { key: 'conn', name: 'settings/connection', params: { connection: b } }] };
  const next = removedConnectionRoutes(state, new Set([b]));
  assert.deepEqual(next.routes.map(route => route.key), ['home', 'settings']);
  assert.equal(next.index, 1, 'the user lands on the Settings list');
  assert.equal(routeSlot({ name: 'settings/font-size' }), null);
  assert.equal(routeSlot({ name: 'settings/add-connection' }), null);
});

import { projectRows } from '../src/projectRows.ts';

const client = (channels, threads, ready = true) => ({ isCatalogueReady: ready, channels: new Map(channels.map(c => [c.id, c])), threads: new Map(threads.map(t => [t.id, t])) });
const runtime = (slot, name, c, extra = {}) => ({ slot, name, client: c, status: 'online', failed: false, loading: false, damaged: false, ...extra });

test('one flat Project list across connections with per-Project unread counts', () => {
  const a = client([{ id: 'p', name: 'Research' }, { id: 'q', name: 'Daily' }], [
    { id: 't1', project_id: 'p', completed_unread: true }, { id: 't2', project_id: 'p', completed_unread: true }, { id: 't3', project_id: 'p', completed_unread: true, archived: true }, { id: 't4', project_id: 'q' }]);
  const b = client([{ id: 'p', name: 'Research' }], [{ id: 't1', project_id: 'p', completed_unread: true }]);
  const { rows, pending } = projectRows([runtime('primary', 'personal.example', a), runtime('b'.repeat(24), 'work.example', b)]);
  assert.deepEqual(rows.map(r => [r.name, r.connectionName, r.unread, r.id, r.slot]), [
    ['Daily', 'personal.example', 0, 'q', 'primary'],
    ['Research', 'personal.example', 2, 'p', 'primary'],
    ['Research', 'work.example', 1, 'p', 'b'.repeat(24)],
  ]);
  assert.equal(new Set(rows.map(r => r.key)).size, 3, 'equal raw IDs on two servers stay distinct');
  assert.deepEqual(pending, []);
});

test('a connection that is down keeps its last known Projects and counts with a hint', () => {
  const a = client([{ id: 'p', name: 'Research' }], [{ id: 't', project_id: 'p', completed_unread: true }]);
  const { rows } = projectRows([runtime('primary', 'one', a, { status: 'retrying' })]);
  assert.deepEqual(rows.map(r => [r.unread, r.issue]), [[1, 'Reconnecting']]);
  const quiet = projectRows([runtime('primary', 'one', a, { status: 'suspended' })]).rows[0];
  assert.equal(quiet.issue, undefined, 'a normal background pause is not shown');
});

test('connections without a directory appear as pending rows, never as fake Projects', () => {
  const { rows, pending } = projectRows([
    runtime('primary', 'loading.example', client([], [], false), { loading: true, status: 'connecting' }),
    runtime('b'.repeat(24), 'pairing.example', null, { status: 'pairing' }),
    runtime('c'.repeat(24), 'broken.example', null, { status: 'blocked' }),
  ]);
  assert.deepEqual(rows, []);
  assert.deepEqual(pending.map(p => [p.connectionName, p.text]), [['loading.example', 'Loading projects…'], ['pairing.example', 'Pairing'], ['broken.example', 'Needs attention']]);
});

test('an online connection whose first directory walk is still running shows loading, not unavailable', () => {
  const { rows, pending } = projectRows([
    runtime('primary', 'walking.example', client([], [], false), { loading: false, status: 'online' }),
    runtime('b'.repeat(24), 'stopped.example', client([], [], false), { loading: false, status: 'suspended' }),
  ]);
  assert.deepEqual(rows, []);
  assert.deepEqual(pending.map(p => [p.connectionName, p.text]), [['walking.example', 'Loading projects…'], ['stopped.example', 'Projects unavailable']]);
});

test('removing a connection also pops its Passwords & Logins and API keys pages', () => {
  const b = 'b'.repeat(24);
  const state = { index: 4, routes: [{ key: 'home', name: '(tabs)' }, { key: 'settings', name: 'settings/index' },
    { key: 'conn', name: 'settings/connection', params: { connection: b } }, { key: 'vault', name: 'settings/vault', params: { connection: b } },
    { key: 'keys', name: 'settings/env-keys', params: { connection: b } }] };
  assert.equal(routeSlot(state.routes[4]), b);
  assert.equal(routeSlot(state.routes[3]), b);
  const next = removedConnectionRoutes(state, new Set([b]));
  assert.deepEqual(next.routes.map(route => route.key), ['home', 'settings']);
});
