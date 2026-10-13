import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryPage, gallerySequence } from '../src/gallerySequence.ts';

const a = (id, state = 'available') => ({ id, state });

test('gallery holds every available attachment of the Thread in timeline order', () => {
  const rows = [[a('1'), a('2')], undefined, [a('3', 'pending'), a('4')], [a('2'), a('5')]];
  const { items, index } = gallerySequence(rows, a('4'));
  assert.deepEqual(items.map(item => item.id), ['1', '2', '4', '5']);
  assert.equal(index, 2);
});

test('gallery opens on the tapped attachment even when the timeline no longer holds it', () => {
  const { items, index } = gallerySequence([[a('1')]], a('9'));
  assert.deepEqual(items.map(item => item.id), ['9']);
  assert.equal(index, 0);
});

test('page index follows the offset and stays inside the list', () => {
  assert.equal(galleryPage(0, 390, 4), 0);
  assert.equal(galleryPage(390 * 2 + 100, 390, 4), 2);
  assert.equal(galleryPage(390 * 2 + 300, 390, 4), 3);
  assert.equal(galleryPage(99999, 390, 4), 3);
  assert.equal(galleryPage(-50, 390, 4), 0);
  assert.equal(galleryPage(100, 0, 4), 0);
});
