import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProjects, orderProjects, projectUnreadCounts, unreadCountDescription, unreadCountLabel } from '../src/projectDirectory.ts';

test('Project count is the number of sessions with an unread completed result', () => {
  const counts = projectUnreadCounts([
    { projectId: 'a', completedUnread: true },
    { projectId: 'a', completedUnread: true },
    { projectId: 'a', completedUnread: false },
    { projectId: 'a' },
    { projectId: 'b', completedUnread: true },
    { projectId: 'b', completedUnread: true, archived: true },
  ]);
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
  assert.equal(counts.get('c'), undefined);
});

test('sessions of an unlisted Project do not create a count', () => {
  const counts = projectUnreadCounts([{ projectId: 'gone', completedUnread: true }, { projectId: 'a', completedUnread: true }], ['a']);
  assert.deepEqual([...counts], [['a', 1]]);
});

test('reading one session decreases its Project count only by one', () => {
  const sessions = [{ projectId: 'a', completedUnread: true }, { projectId: 'a', completedUnread: true }];
  assert.equal(projectUnreadCounts(sessions).get('a'), 2);
  sessions[0] = { ...sessions[0], completedUnread: false };
  assert.equal(projectUnreadCounts(sessions).get('a'), 1);
  sessions[1] = { ...sessions[1], completedUnread: false };
  assert.equal(projectUnreadCounts(sessions).get('a'), undefined);
});

test('count labels are compact and accessible', () => {
  assert.equal(unreadCountLabel(3), '3');
  assert.equal(unreadCountLabel(100), '99+');
  assert.equal(unreadCountDescription(0), '');
  assert.equal(unreadCountDescription(1), '1 session with an unread result');
  assert.equal(unreadCountDescription(4), '4 sessions with unread results');
});

test('Projects from all connections use one flat order: name, connection, then ID', () => {
  const rows = orderProjects([
    { id: 'w:2', name: 'research', connectionName: 'Work' },
    { id: 'p:1', name: 'Daily', connectionName: 'Personal' },
    { id: 'w:1', name: 'Hermes App', connectionName: 'Work' },
    { id: 'p:2', name: 'Research', connectionName: 'Personal' },
    { id: 'l:1', name: 'Project 10', connectionName: 'Lab' },
    { id: 'l:2', name: 'Project 9', connectionName: 'Lab' },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['p:1', 'w:1', 'l:2', 'l:1', 'p:2', 'w:2']);
  assert.equal(compareProjects({ id: 'b', name: 'X' }, { id: 'a', name: 'X' }) > 0, true);
});
