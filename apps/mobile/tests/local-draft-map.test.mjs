import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDraftMap } from '../../../packages/client/src/localDraftMap.ts';

test('local draft map notifies only badge changes and preserves exact unsent text', () => {
  const drafts = new LocalDraftMap(value => !!value.trim());
  let updates = 0;
  const unsubscribe = drafts.subscribe(() => updates++);
  drafts.set('a:t', ' \n ');
  assert.equal(drafts.hasDraft('a:t'), false);
  assert.equal(updates, 0);
  drafts.set('a:t', ' hello\n');
  assert.equal(updates, 1);
  drafts.set('a:t', 'new text');
  assert.equal(updates, 1);
  assert.equal(drafts.get('a:t'), 'new text');
  drafts.set('b:t', 'different connection');
  assert.equal(updates, 2);
  drafts.delete('a:t');
  assert.equal(updates, 3);
  assert.equal(drafts.hasDraft('b:t'), true);
  drafts.delete('missing');
  assert.equal(updates, 3);
  drafts.clear();
  assert.equal(updates, 4);
  drafts.clear();
  assert.equal(updates, 4);
  unsubscribe();
  drafts.set('a:t', 'no subscriber');
  assert.equal(updates, 4);
  assert.equal(drafts.getSnapshot(), 5);
});

test('attachments count as drafts, including selected/uploading items', () => {
  const drafts = new LocalDraftMap(value => value.items.length > 0);
  drafts.set('a:t', { items: [], files: [] });
  assert.equal(drafts.hasDraft('a:t'), false);
  drafts.set('a:t', { items: [{ state: 'uploading' }], files: [] });
  assert.equal(drafts.hasDraft('a:t'), true);
  drafts.set('a:t', { items: [], files: [] });
  assert.equal(drafts.hasDraft('a:t'), false);
});
