import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ModelConfirmationRequired, ProtocolError, isRetryableError } from '../dist/index.js';

const fixture = (respond) => {
  const calls = [];
  const client = new HermesClient({
    token: () => 'synthetic-device',
    socket: { connect: async () => { throw Error('no socket expected'); } },
    http: { request: async (...args) => { calls.push(args); return respond(args); } },
  });
  return { client, calls };
};
const thread = { id: 'th_clienttopic123', project_id: 'p_one', title: 'New topic', archived: false };

test('new-topic Thread creation sends the stable client identity without inventing a local title', async () => {
  const { client, calls } = fixture(() => ({ status: 201, body: { thread } }));
  assert.deepEqual(await client.createThread('p_one', 'New topic', 'th_clienttopic123'), thread);
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][1], '/v1/channels/p_one/threads');
  assert.deepEqual(calls[0][3], { title: 'New topic', client_thread_id: 'th_clienttopic123' });
});

test('a Thread model choice is sent only when chosen, and the stored model must match its provider', async () => {
  const choice = { provider: 'anthropic', model: 'sonnet' };
  const { client, calls } = fixture(() => ({ status: 201, body: { thread, model: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } }));
  assert.deepEqual(await client.createThread('p_one', 'New topic', 'th_clienttopic123', choice), thread);
  assert.deepEqual(calls[0][3], { title: 'New topic', client_thread_id: 'th_clienttopic123', model: choice });
  await client.createThread('p_one', 'New topic', 'th_clienttopic123', choice, true);
  assert.deepEqual(calls[1][3].model, { ...choice, confirm_selection: true });

  const other = fixture(() => ({ status: 201, body: { thread, model: { provider: 'openai-codex', model: 'gpt-6-luna' } } }));
  await assert.rejects(other.client.createThread('p_one', 'New topic', 'th_clienttopic123', choice), ProtocolError);
});

test('a native warning stops creation with a non-retryable confirmation request', async () => {
  const choice = { provider: 'openrouter', model: 'vendor/free' };
  const { client } = fixture(() => ({ status: 200, body: { confirmation_required: true, warning: 'This provider trains on your data.', ...choice } }));
  const error = await client.createThread('p_one', 'New topic', 'th_clienttopic123', choice).catch(e => e);
  assert.ok(error instanceof ModelConfirmationRequired);
  assert.equal(error.warning, 'This provider trains on your data.');
  assert.deepEqual(error.choice, choice);
  assert.equal(isRetryableError(error), false);

  const mismatch = fixture(() => ({ status: 200, body: { confirmation_required: true, warning: 'x', provider: 'other', model: 'vendor/free' } }));
  const wrong = await mismatch.client.createThread('p_one', 'New topic', 'th_clienttopic123', choice).catch(e => e);
  assert.ok(wrong instanceof ProtocolError && !(wrong instanceof ModelConfirmationRequired));
});

test('the thread_model capability gates the choice', async () => {
  const caps = (extra) => fixture(() => ({ status: 200, body: { protocol: 1, ...extra } })).client;
  const old = caps({});
  await old.capabilities();
  assert.equal(old.supportsThreadModel, false);
  const current = caps({ thread_model: true });
  await current.capabilities();
  assert.equal(current.supportsThreadModel, true);
});

test('the new-Thread model list starts with the primary model and filters the rest', async () => {
  const { threadModelOptions, threadModelLabel, threadModelRequest } = await import('../dist/index.js');
  const settings = { scope: 'connected-default', provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { id: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
    { id: 'openai-codex', name: 'OpenAI Codex', models: ['gpt-6-luna'] }] };
  const rows = threadModelOptions(settings);
  assert.deepEqual(rows.map(r => [r.label, r.detail, r.choice]), [
    ['Default (claude-opus-5-5)', 'Primary model', null],
    ['claude-sonnet-5-5', 'Anthropic', { provider: 'anthropic', model: 'claude-sonnet-5-5' }],
    ['gpt-6-luna', 'OpenAI Codex', { provider: 'openai-codex', model: 'gpt-6-luna' }]]);
  assert.deepEqual(threadModelOptions(settings, 'codex').map(r => r.label), ['Default (claude-opus-5-5)', 'gpt-6-luna']);
  assert.equal(threadModelLabel(null, null), 'Default model');
  assert.equal(threadModelLabel(settings, null), 'Default (claude-opus-5-5)');
  assert.equal(threadModelLabel(settings, rows[2].choice), 'gpt-6-luna');
  assert.equal(threadModelRequest(settings, { provider: 'anthropic', model: 'claude-opus-5-5' }), undefined);
  assert.deepEqual(threadModelRequest(settings, rows[1].choice), rows[1].choice);
  assert.equal(threadModelRequest(settings, null), undefined);
});
