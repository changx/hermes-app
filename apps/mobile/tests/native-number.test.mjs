import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeNumber, fileSize } from '../src/nativeNumber.ts';

test('native Int64 values from Expo SDK 58 become Numbers', () => {
  assert.equal(nativeNumber(388864n), 388864);
  assert.equal(nativeNumber(42), 42);
  assert.equal(nativeNumber(undefined), undefined);
  assert.equal(nativeNumber(null), undefined);
  assert.equal(fileSize({ size: 1048576n }), 1048576);
  assert.equal(fileSize({ size: 7 }), 7);
  assert.equal(typeof fileSize({ size: 5n }), 'number');
});
