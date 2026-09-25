const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const baseline = process.env.HERMES_BASELINE || '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'
const scoped = process.env.HERMES_EXPO_DEPS || '/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile'
const esbuild = require(process.env.HERMES_ESBUILD || path.join(scoped, 'node_modules/esbuild'))
async function run() {
  const output = path.join(scoped, 'sdk-protocol-test.cjs')
  const built = await esbuild.build({
    entryPoints: [path.join(baseline, 'apps/shared/src/json-rpc-channel.ts')],
    bundle: true, platform: 'neutral', format: 'cjs', outfile: output, metafile: true
  })
  const inputs = Object.keys(built.metafile.inputs)
  assert(inputs.some(x => x.endsWith('json-rpc-channel.ts')))
  assert(inputs.every(x => !/(^|\/)(electron|node_modules|apps\/desktop)(\/|$)/.test(x)), inputs.join('\n'))
  const { JsonRpcRequestChannel, JsonRpcGatewayError, JSON_RPC_METHOD_NOT_FOUND } = require(output)
  const frames = [], events = [], unhandled = []
  const channel = new JsonRpcRequestChannel({
    requestTimeoutMs: 1000, heartbeatIntervalMs: 0,
    onEvent: event => events.push(event), onUnhandledRequest: req => unhandled.push(req)
  })
  const sink = { send: text => frames.push(JSON.parse(text)) }
  channel.attach(sink)
  const pending = channel.request('session.list', { probe: true })
  assert.equal(frames[0].method, 'session.list')
  channel.handleFrame(JSON.stringify({ jsonrpc: '2.0', id: frames[0].id, result: { ok: true } }))
  assert.deepEqual(await pending, { ok: true })
  channel.handleFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'session.updated', session_id: 'synthetic' } }))
  assert.equal(events.length, 1)
  channel.handleFrame(JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'approval.ask', params: { session_id: 'synthetic' } }))
  assert.equal(unhandled.length, 1)
  assert.equal(frames.at(-1).error.code, JSON_RPC_METHOD_NOT_FOUND)
  const rejected = channel.request('unknown.method')
  channel.handleFrame(JSON.stringify({ id: frames.at(-1).id, error: { code: -32601, message: 'not found' } }))
  await assert.rejects(rejected, e => e instanceof JsonRpcGatewayError && e.code === -32601)
  const lost = channel.request('session.active')
  channel.detach(new Error('disconnected'))
  await assert.rejects(lost, /disconnected/)
  assert.equal(channel.connected, false)
  console.log(JSON.stringify({ status: 'PASS', sdkInputs: inputs, checks: ['request-response', 'event', 'unhandled-server-request', 'typed-error', 'disconnect-pending'], transport: 'synthetic in-memory only', output }))
}
run().catch(e => { console.error(e); process.exitCode = 1 })
