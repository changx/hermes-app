import test from 'node:test';
import assert from 'node:assert/strict';
import { recentRows, todoRows, searchRecentRows } from '../src/recentRows.ts';
import { fillComposer, onComposerFill } from '../src/composerFill.ts';
import { emptySessionQuery } from '../../../packages/client/src/sessionSearch.ts';

// Side chats (docs/side-chat.md): the phone lists none; they open from the anchor mark or Session options.
const now = 2_000_000_000;
const client = threads => ({ isCatalogueReady: true, supportsSessionLabels: true, channels: new Map([['p', { id: 'p', name: 'Research' }]]), threads: new Map(threads.map(t => [t.id, t])) });
const thread = (id, extra = {}) => ({ id, project_id: 'p', title: id, last_message_at: now - 60, markers: ['todo'], ...extra });

test('Recents, Todo and search never list a side chat', () => {
  const c = client([thread('source'), thread('side', { running: true, side_of: { thread_id: 'source', anchor_ref_seq: 4 } })]);
  const sources = [{ slot: 'primary', name: 'home', client: c }];
  assert.deepEqual(recentRows(sources, now).map(r => r.id), ['source']);
  assert.deepEqual(todoRows(sources).map(r => r.id), ['source']);
  assert.deepEqual(searchRecentRows(sources, { ...emptySessionQuery(), text: 'side' }).map(r => r.id), []);
});

test('Send to main adds the text after the draft and tells the mounted source page', () => {
  const drafts = new Map(), seen = [];
  assert.equal(fillComposer('c:source', 'From side chat [S](hermesapp://session/side):\n\nA', drafts), 'From side chat [S](hermesapp://session/side):\n\nA');
  const stop = onComposerFill('c:source', text => seen.push(text));
  drafts.set('c:source', 'My note  \n');
  assert.equal(fillComposer('c:source', 'B', drafts), 'My note\n\nB');
  assert.deepEqual(seen, ['My note\n\nB']);
  stop();
  fillComposer('c:source', 'C', drafts);
  assert.equal(seen.length, 1, 'a closed page no longer listens');
  assert.equal(drafts.get('c:source'), 'My note\n\nB\n\nC', 'the text waits in the draft');
});
