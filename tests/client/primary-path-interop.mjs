import assert from 'node:assert/strict';
import { HermesClient, HttpError } from '../../packages/client/dist/index.js';
import { nativeTransport } from '../../apps/mobile/src/transport.ts';
// Real plugin HTTP + shared SDK: bind, readback, AGENTS.md source, rejection and unbind.
const [base, cid, token, repo, outside] = process.argv.slice(2);
const transport = nativeTransport(base);
const client = new HermesClient({ ...transport, token: () => token });
await client.capabilities();
const info = async c => (await c.listChannels()).find(x => x.id === cid);
assert.equal(client.supportsChannelPrimaryPath, true);
assert.equal((await info(client)).bound_primary_path, null);
const bound = await client.updateChannel(cid, { primary_path: repo });
assert.equal(bound.bound_primary_path, repo);
assert.equal(bound.description, 'Short summary', 'a folder change keeps the context');
const second = new HermesClient({ ...transport, token: () => token });
assert.equal((await info(second)).bound_primary_path, repo);
const rules = await client.workspace.getAgents(cid);
assert.equal(rules.content, 'Repository rules from the primary folder\n');
await assert.rejects(client.updateChannel(cid, { primary_path: outside }), e => e instanceof HttpError && e.status === 400);
assert.equal((await info(second)).bound_primary_path, repo, 'a rejected folder changes nothing');
const made = await client.createChannel('Second', '', repo).then(() => null, e => e);
assert.ok(made instanceof HttpError && made.status === 409, 'another channel cannot take the same folder');
assert.equal((await client.listChannels()).some(c => c.name === 'Second'), false);
const cleared = await client.updateChannel(cid, { primary_path: null });
assert.equal(cleared.bound_primary_path, null);
await assert.rejects(client.workspace.getAgents(cid), e => e instanceof HttpError && e.status === 404);
console.log(JSON.stringify({ real_plugin_http: true, native_transport: true, bound: true, agents_from_primary: true,
  outside_rejected: true, duplicate_rejected: true, unbound: true }));
