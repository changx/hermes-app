import test from 'node:test';
import assert from 'node:assert/strict';
import { channelChoices, recentChannel, recentRows } from '../src/recentRows.ts';
import { automationStatus, automationTiming, scheduleLabel } from '../src/automationText.ts';

const now = 2_000_000_000;
const client = (channels, threads) => ({ isCatalogueReady: true, channels: new Map(channels.map(c => [c.id, c])), threads: new Map(threads.map(t => [t.id, t])) });
const thread = (id, project_id, ago, extra = {}) => ({ id, project_id, title: id, last_message_at: now - ago, ...extra });

test('Recents: own Threads of the last 72 hours across connections, running first, then newest', () => {
  const a = client([{ id: 'p', name: 'Research' }], [
    thread('mine', 'p', 60), thread('day-old', 'p', 71 * 3600), thread('old', 'p', 73 * 3600), thread('run', 'p', 10, { origin: 'automation' }),
    thread('replied', 'p', 30, { origin: 'automation', participated: true }), thread('gone', 'p', 5, { archived: true }),
    thread('running-old', 'p', 90 * 3600, { running: true }), thread('orphan', 'x', 1)]);
  const b = client([{ id: 'p', name: 'Research' }], [thread('mine', 'p', 20, { completed_unread: true })]);
  const rows = recentRows([{ slot: 'primary', name: 'home', client: a }, { slot: 'w', name: 'work', client: b }, { slot: 'z', name: 'down', client: null }], now);
  assert.deepEqual(rows.map(r => r.key), ['primary:running-old', 'w:mine', 'primary:replied', 'primary:mine', 'primary:day-old']);
  assert.deepEqual([rows[1].channelName, rows[1].connectionName, rows[1].completedUnread], ['Research', 'work', true]);
});

test('New conversation preselects the channel of the most recent own activity', () => {
  const a = client([{ id: 'p', name: 'Research' }, { id: 'q', name: 'Daily' }], [
    thread('t1', 'p', 600), thread('t2', 'q', 9 * 86400), thread('auto', 'q', 1, { origin: 'automation' })]);
  const b = client([{ id: 'r', name: 'Work' }], [thread('t3', 'r', 3000)]);
  const sources = [{ slot: 'primary', name: 'home', client: a }, { slot: 'w', name: 'work', client: b }];
  const choices = channelChoices(sources);
  assert.deepEqual(choices.map(c => c.key), ['primary:q', 'primary:p', 'w:r']);
  assert.equal(recentChannel(sources, choices).key, 'primary:p', 'an unanswered automation Thread does not count as use');
  assert.equal(recentChannel([{ slot: 'w', name: 'work', client: client([{ id: 'r', name: 'Work' }], []) }], channelChoices([{ slot: 'w', name: 'work', client: client([{ id: 'r', name: 'Work' }], []) }])).key, 'w:r');
  assert.equal(recentChannel([], []), null);
});

test('Automation wording', () => {
  assert.equal(automationStatus({ running: true, enabled: true, state: 'scheduled', failed: true }), 'Running');
  assert.equal(automationStatus({ running: false, enabled: false, state: 'paused', failed: false }), 'Paused');
  assert.equal(automationStatus({ running: false, enabled: false, state: 'completed', failed: false }), 'Finished');
  assert.equal(automationStatus({ running: false, enabled: true, state: 'scheduled', failed: true }), 'Last run failed');
  assert.equal(scheduleLabel('every 1440m'), 'Every day');
  assert.equal(scheduleLabel('every 720m'), 'Every 12 hours');
  assert.equal(scheduleLabel('every 90m'), 'Every 90 minutes');
  assert.equal(scheduleLabel('0 8 * * *'), '0 8 * * *');
  assert.equal(automationTiming({ enabled: false, state: 'paused' }), 'Not run yet');
  assert.match(automationTiming({ enabled: true, state: 'scheduled', nextRunAt: '2026-10-11T08:00:00-07:00' }, new Date('2026-10-11T07:00:00-07:00')), /^Next /);
  assert.match(automationTiming({ enabled: false, state: 'paused', lastRunAt: '2026-10-01T09:22:22-07:00' }), /^Last /);
});
