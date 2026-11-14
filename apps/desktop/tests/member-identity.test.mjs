import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export { DesktopConnectionService } from './src/main/connection-service.ts'; export { ConnectionIdentity } from './src/renderer/connection-settings.tsx';",
  resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'react', 'react/jsx-runtime', 'react-test-renderer'], jsx: 'automatic', write: false });
const module = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { DesktopConnectionService, ConnectionIdentity } = module.exports;
const React = require('react');
const renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function service(client) {
  const target = new DesktopConnectionService(() => {});
  target.connection = { id: 'conn-key' };
  target.client = client;
  return target;
}

test('member identity service: capability gate and connection check', async () => {
  assert.equal(await service({ supportsMemberIdentity: false }).getMemberIdentity('conn-key'), null);
  const identity = { auth: 'device', deviceId: 'abc', member: 'wangsheng' };
  assert.deepEqual(await service({ supportsMemberIdentity: true, memberIdentity: async () => identity }).getMemberIdentity('conn-key'), identity);
  await assert.rejects(service({ supportsMemberIdentity: true }).getMemberIdentity('other'), /Connection changed/);
});

async function render(result, props = { connectionKey: 'conn-key', online: true }) {
  const calls = [];
  globalThis.window = { hermesDesktop: { getMemberIdentity: async key => { calls.push(key); if (result instanceof Error) throw result; return result; } } };
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(ConnectionIdentity, props)); });
  await renderer.act(async () => {});
  const text = tree.root.findAll(node => typeof node.type === 'string').map(node => node.children.filter(child => typeof child === 'string').join('')).join('|');
  tree.unmount();
  return { text, calls };
}

test('identity row: member, unbound device, administrator token, hidden states', async () => {
  assert.match((await render({ auth: 'device', deviceId: 'a', member: 'wangsheng' })).text, /Speaking as\|wangsheng\|.*Only an administrator can change it/);
  assert.match((await render({ auth: 'device', deviceId: 'a', member: null })).text, /Not linked to a team member\|You can read but not send/);
  assert.match((await render({ auth: 'admin', deviceId: null, member: null })).text, /Administrator token/);
  // Old Hermes (no capability), a failed read and an offline connection show nothing.
  assert.equal((await render(null)).text, '');
  assert.equal((await render(new Error('offline'))).text, '');
  const offline = await render({ auth: 'device', deviceId: 'a', member: 'x' }, { connectionKey: 'conn-key', online: false });
  assert.equal(offline.text, '');
  assert.deepEqual(offline.calls, []);
});
