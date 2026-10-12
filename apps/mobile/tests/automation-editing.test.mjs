import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { automationThreadState, confirmAutomationDelete, loadAutomationRows, mergeAutomationRows, runStarted, AUTOMATION_PAGE } from '../src/automationRows.ts';

const job = (id, extra = {}) => ({ id, name: `Job ${id}`, schedule: 'every 60m', state: 'scheduled', enabled: true, running: false,
  failed: false, targets: [{ channelId: 'p_a', mode: 'new' }], threadCount: 0, unreadCount: 0, controls: [], ...extra });

function pagedClient(all) {
  const calls = [];
  return { calls, client: { hasCapabilities: true, supportsAutomations: true, supportsAutomationsPaged: true,
    automations: async () => { throw Error('paged servers use automationsPage'); },
    automationsPage: async ({ limit, after, channel }) => {
      calls.push({ limit, after, channel });
      const start = after ? Number(after) : 0;
      const rows = all.filter(j => !channel || j.targets.some(t => t.channelId === channel));
      return { automations: rows.slice(start, start + 2), nextAfter: start + 2 < rows.length ? String(start + 2) : null };
    } } };
}

test('pages of several connections merge until every connection is complete', async () => {
  const a = pagedClient([job('1'), job('2'), job('3')]), b = pagedClient([job('9', { running: true })]);
  const sources = [{ slot: 'A', name: 'Home', client: a.client }, { slot: 'B', name: 'Work', client: b.client }];
  const first = await loadAutomationRows(sources);
  assert.deepEqual(first.rows.map(r => r.key), ['B:9', 'A:1', 'A:2']);  // running first
  assert.deepEqual([...first.cursors], [['A', '2']]);
  assert.equal(a.calls[0].limit, AUTOMATION_PAGE);
  const next = await loadAutomationRows(sources, { cursors: first.cursors });
  assert.equal(b.calls.length, 1);  // a complete connection is not asked again
  const merged = mergeAutomationRows(first.rows, next.rows);
  assert.deepEqual(merged.map(r => r.key), ['B:9', 'A:1', 'A:2', 'A:3']);
  assert.equal(next.cursors.size, 0);
});

test('older servers return every job at once; the channel filter applies locally', async () => {
  const client = { hasCapabilities: true, supportsAutomations: true, supportsAutomationsPaged: false,
    automations: async () => [job('1'), job('2', { targets: [{ channelId: 'p_b', mode: 'new' }] })] };
  const all = await loadAutomationRows([{ slot: 'A', name: 'Home', client }]);
  assert.equal(all.rows.length, 2); assert.equal(all.cursors.size, 0);
  const one = await loadAutomationRows([{ slot: 'A', name: 'Home', client }], { channel: 'p_b' });
  assert.deepEqual(one.rows.map(r => r.job.id), ['2']);
  const paged = pagedClient([job('1'), job('5', { targets: [{ channelId: 'p_b', mode: 'new' }] })]);
  await loadAutomationRows([{ slot: 'A', name: 'Home', client: paged.client }], { channel: 'p_b' });
  assert.equal(paged.calls[0].channel, 'p_b');
});

test('a connection that is not ready or fails gives a short note, the others still list', async () => {
  const ok = pagedClient([job('1')]);
  const result = await loadAutomationRows([
    { slot: 'A', name: 'Home', client: ok.client }, { slot: 'B', name: 'Old', client: { hasCapabilities: true, supportsAutomations: false } },
    { slot: 'C', name: 'Down', client: { ...ok.client, automationsPage: async () => { throw Error('offline'); } } },
    { slot: 'D', name: 'Wait', client: null }]);
  assert.deepEqual(result.rows.map(r => r.key), ['A:1']);
  assert.deepEqual(new Map(result.notes.map(n => [n.key, n.text])), new Map([
    ['B', 'Automations are not available on this connection yet.'], ['C', 'Could not load automations. Pull down to try again.'],
    ['D', 'Connecting…']]));
});

test('Starting… ends when the job runs or reports a new run', () => {
  const before = { running: false, lastRunAt: '2026-10-12T01:00:00' };
  assert.equal(runStarted(before, before), false);
  assert.equal(runStarted(before, { running: true, lastRunAt: before.lastRunAt }), true);
  assert.equal(runStarted(before, { running: false, lastRunAt: '2026-10-12T04:00:00' }), true);
  assert.equal(runStarted({ running: false }, { running: false, lastRunAt: '2026-10-12T04:00:00' }), true);
});

test('produced Threads show live Running and unread state like the channel list', () => {
  assert.deepEqual(automationThreadState({ completedUnread: false }, { running: true, completed_unread: false }), { running: true, unread: false });
  assert.deepEqual(automationThreadState({ completedUnread: true }, { running: false, completed_unread: false }), { running: false, unread: false });
  assert.deepEqual(automationThreadState({ completedUnread: true }, undefined), { running: false, unread: true });
  const detail = readFileSync(new URL('../src/app/automations/[automationId].tsx', import.meta.url), 'utf8');
  assert.match(detail, /automationThreadState\(item, client\.threads\.get\(item\.id\)\)/);
  assert.match(detail, /extraData=\{revision\}/);
  assert.match(detail, /<Text style=\{s\.runningText\}>Running<\/Text>/);
});

test('screens use the editing API only behind its capabilities', () => {
  const src = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const detail = src('app/automations/[automationId].tsx');
  assert.match(detail, /client\.supportsAutomationControls && job\.controls\.includes/);
  assert.match(detail, /client\.supportsAutomationEditors && automationChangeable\(job\) && <Action label="Edit in conversation"/);
  assert.match(detail, /can\('delete'\) && <Action label=/);
  assert.match(detail, /confirmAutomationDelete\(job\.name, \(\) => void deleteJob\(\), Alert\.alert\)/);
  assert.match(detail, /await client\.getThread\(thread\.id\)/);  // hydrate before opening
  assert.match(src('app/(tabs)/automations.tsx'), /canCreate && <HeaderIcon label="New automation"/);
  assert.match(src('app/new-thread.tsx'), /automationEditor=\{automation\}/);
  assert.match(src('NewTopicComposer.tsx'), /automationEditor \? \{ automationEditor: true \} : \{\}/);
  assert.match(src('app/channels/[channelId].tsx'), /client\?\.supportsAutomations && <HeaderIcon label="Automations"/);
  assert.match(src('app/_layout.tsx'), /channels\/\[channelId\]\/automations/);
});

test('Delete asks first and names the job; only the destructive button deletes', () => {
  const shown = [], removed = [];
  confirmAutomationDelete('Morning digest', () => removed.push('job'), (title, message, buttons) => shown.push({ title, message, buttons }));
  assert.equal(shown.length, 1);
  assert.equal(removed.length, 0);  // nothing happens before the answer
  assert.equal(shown[0].title, 'Delete this automation?');
  assert.match(shown[0].message, /"Morning digest" will not run again\. Its conversations stay\./);
  assert.deepEqual(shown[0].buttons.map(b => [b.text, b.style]), [['Cancel', 'cancel'], ['Delete', 'destructive']]);
  shown[0].buttons[0].onPress?.();
  assert.equal(removed.length, 0);
  shown[0].buttons[1].onPress();
  assert.deepEqual(removed, ['job']);
});
