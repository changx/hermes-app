import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciledSendNotice } from '../src/sendNotice.ts';

const rejected = 'Sending could not be confirmed. Check your connection permissions or message.';
test('recovered sends clear their stale banner, but remaining failures keep it visible', () => {
  assert.equal(reconciledSendNotice(rejected, [{ status: 'blocked' }]), rejected);
  assert.equal(reconciledSendNotice(rejected, [{ status: 'accepted' }]), '');
  assert.equal(reconciledSendNotice(rejected, []), '');
  assert.equal(reconciledSendNotice('', [{ status: 'blocked' }], rejected), rejected);
});
test('ordinary outbox changes never erase unrelated errors or mask new storage failures', () => {
  for (const notice of [
    'Your received message could not be updated here. Keep your app data.',
    'A received message could not be cleared from this device. Keep your app data.',
    'Could not connect. Contact your admin. Unsent messages are still here.',
    'Could not rename this conversation.'
  ]) {
    assert.equal(reconciledSendNotice(notice, []), notice);
    assert.equal(reconciledSendNotice(rejected, [], notice), notice);
  }
});
