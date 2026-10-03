import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileOutbox, OutboxStore } from '../src/outbox.ts';
import { connection, newSend } from '../src/send.ts';
import { projectTimeline } from '../src/timeline.ts';
import { failedMessageId, confirmFailedMessageDelete } from '../src/failedMessageActions.ts';

const config = connection('https://example.test', 'test-only', 'delete-test');
const draft = n => newSend(config, 'thread', 'original', `mob_123e4567-e89b-12d3-a456-${String(n).padStart(12, '0')}`);
class Store {
  data = new Map(); fail;
  async getItemAsync(k) { return this.data.get(k) ?? null; }
  async setItemAsync(k, v) { if (this.fail?.('set', k)) throw Error('storage unavailable'); this.data.set(k, v); }
  async deleteItemAsync(k) { if (this.fail?.('delete', k)) throw Error('storage unavailable'); this.data.delete(k); }
}
const make = store => {
  const sdk = { sends: [], receipts: new Map(), messages: new Map(), supportsLatest: true,
    async send(...args) { this.sends.push(args); throw Object.assign(Error('rejected'), { status: 403 }); },
    async getReceipt() { throw Error('must not read remote'); }, async historyTail() { throw Error('must not read remote'); } };
  const updates = [];
  const box = new MobileOutbox(new OutboxStore(store, config), sdk, rows => updates.push(rows));
  return { box, sdk, updates };
};
const row = { key: 'local:message-id', role: 'user', text: 'original', optimistic: true, status: 'blocked' };

test('only failed local user rows offer deletion; server rows and other states do not', () => {
  assert.equal(failedMessageId(row), 'message-id');
  for (const patch of [{ role: 'assistant' }, { optimistic: false }, { refSeq: 10 }, { key: 'ref:10' }, { key: 'local:' },
    ...['queued', 'sending', 'ambiguous', 'accepted'].map(status => ({ status }))]) {
    assert.equal(failedMessageId({ ...row, ...patch }), undefined);
  }
});

test('explicit delete confirmation preserves the message until final Delete', () => {
  const alerts = [], removed = [];
  const alert = (...args) => alerts.push(args);
  confirmFailedMessageDelete(row, id => removed.push(id), alert);
  assert.equal(alerts[0][2][0].style, 'cancel');
  assert.deepEqual(removed, []);
  assert.equal(alerts[0][0], 'Delete this message?');
  assert.deepEqual(removed, []);
  alerts[0][2][1].onPress();
  assert.deepEqual(removed, ['message-id']);
  confirmFailedMessageDelete({ ...row, status: 'accepted' }, () => assert.fail(), alert);
  assert.equal(alerts.length, 1);
});

test('confirmed delete removes durable text and timeline, survives cold load, makes no network calls', async () => {
  const store = new Store(), { box, sdk, updates } = make(store), item = draft(1);
  await box.start(); await box.storage.enqueue({ ...item, status: 'blocked' });
  await box.storage.enqueue({ ...draft(2), status: 'blocked' });
  const before = projectTimeline([], null, 'thread', undefined, true, box.records);
  assert.equal(failedMessageId(before[0]), item.clientMessageId);
  await box.deleteFailed('thread', item.clientMessageId);
  assert.equal(box.records.length, 1);
  assert.equal(updates.at(-1).length, 1);
  assert.equal(projectTimeline([], null, 'thread', undefined, true, box.records).length, 1);
  assert.equal(sdk.sends.length, 0);
  await box.deleteFailed('thread', item.clientMessageId); // idempotent
  await box.stop();
  const next = make(store); await next.box.start();
  assert.deepEqual(next.box.records.map(r => r.clientMessageId), [draft(2).clientMessageId]);
  await next.box.stop();
});

test('storage refuses foreign thread, changed state and accepted record without altering data', async () => {
  const store = new Store(), { box } = make(store), item = draft(3);
  await box.start(); await box.storage.enqueue({ ...item, status: 'blocked' });
  const initial = [...store.data];
  await assert.rejects(box.deleteFailed('other-thread', item.clientMessageId));
  assert.deepEqual([...store.data], initial);
  for (const status of ['queued', 'sending', 'ambiguous', 'accepted']) {
    await box.storage.update({ ...item, status });
    await assert.rejects(box.deleteFailed('thread', item.clientMessageId));
    assert.equal(box.records.length, 1);
  }
  await box.stop();
});

test('failed deletion commit retains original; interrupted cleanup recovers on cold load', async () => {
  for (const phase of ['commit', 'cleanup']) {
    const store = new Store(), { box } = make(store), item = draft(4);
    await box.start(); await box.storage.enqueue({ ...item, status: 'blocked' });
    store.fail = (verb, key) => phase === 'commit' ? verb === 'set' : verb === 'delete' && key.includes('.part.');
    await assert.rejects(box.deleteFailed('thread', item.clientMessageId), /storage unavailable/);
    assert.equal(box.records[0].text, 'original');
    await box.stop(); store.fail = null;
    const next = make(store); await next.box.start();
    assert.equal(next.box.records.length, phase === 'commit' ? 1 : 0);
    if (phase === 'commit') await next.box.deleteFailed('thread', item.clientMessageId);
    assert.equal(store.data.size, 0);
    await next.box.stop();
  }
});

test('deleting attachment-bearing record removes only local descriptors', async () => {
  const store = new Store(), { box, sdk } = make(store);
  const item = { ...draft(5), status: 'blocked', attachments: [{ id: 'att_test', thread_id: 'thread', name: 'file.txt', mime: 'text/plain', size: 3, state: 'available' }] };
  await box.start(); await box.storage.enqueue(item);
  await box.deleteFailed('thread', item.clientMessageId);
  assert.equal(store.data.size, 0); assert.equal(sdk.sends.length, 0);
  await box.stop();
});
