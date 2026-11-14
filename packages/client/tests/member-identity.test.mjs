import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, memberIdentityText, parseMemberIdentity } from '../dist/index.js';

const client = reply => {
  const calls = [];
  const sdk = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return reply(...args); } },
  });
  return { sdk, calls };
};

test('member identity is enabled only by the server capability', async () => {
  const fresh = client(() => ({ status: 200, body: { protocol: 1, member_identity: true } })).sdk;
  await fresh.capabilities();
  assert.equal(fresh.supportsMemberIdentity, true);
  const old = client(() => ({ status: 200, body: { protocol: 1 } })).sdk;
  await old.capabilities();
  assert.equal(old.supportsMemberIdentity, false);
});

test('GET /v1/me is read and validated', async () => {
  const { sdk, calls } = client(() => ({ status: 200, body: { auth: 'device', device_id: 'abc', member: 'wangsheng' } }));
  assert.deepEqual(await sdk.memberIdentity(), { auth: 'device', deviceId: 'abc', member: 'wangsheng' });
  assert.equal(calls[0][0], 'GET');
  assert.match(String(calls[0][1]), /\/v1\/me$/);
  const bad = client(() => ({ status: 200, body: { auth: 'owner' } })).sdk;
  await assert.rejects(bad.memberIdentity(), /invalid identity/);
});

test('identity body: three states, invalid values refused', () => {
  assert.deepEqual(parseMemberIdentity({ auth: 'device', device_id: 'abc', member: null }), { auth: 'device', deviceId: 'abc', member: null });
  assert.deepEqual(parseMemberIdentity({ auth: 'admin', device_id: null, member: null }), { auth: 'admin', deviceId: null, member: null });
  for (const bad of [null, 'x', {}, { auth: 'public' }, { auth: 'device', member: 'not a member' }, { auth: 'device', member: 7 }, { auth: 'device', member: 'A'.repeat(33) }])
    assert.equal(parseMemberIdentity(bad), undefined, JSON.stringify(bad));
});

test('identity text: member, unbound and administrator', () => {
  assert.deepEqual(memberIdentityText({ auth: 'device', deviceId: 'a', member: 'Jamie' }).value, 'Jamie');
  const unbound = memberIdentityText({ auth: 'device', deviceId: 'a', member: null });
  assert.equal(unbound.bound, false);
  assert.match(unbound.hint, /read but not send/);
  assert.equal(memberIdentityText({ auth: 'admin', deviceId: null, member: null }).value, 'Administrator token');
});
