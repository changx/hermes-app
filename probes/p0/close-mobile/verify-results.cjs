const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const baseline = process.env.HERMES_BASELINE || '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'
const shared = path.join(baseline, 'apps/shared/src')
const logs = Object.fromEntries(['export-android-js.log', 'protocol-test.log'].map(name => [name, fs.readFileSync(name, 'utf8')]))
assert.match(logs['export-android-js.log'], /Android Bundled .* index\.js \(\d+ modules\)/)
assert.match(logs['export-android-js.log'], /Exported: dist/)
assert.match(logs['protocol-test.log'], /"status":"PASS"/)
const dir = path.join('dist', '_expo/static/js/android')
const files = fs.readdirSync(dir).filter(x => x.endsWith('.js'))
assert.equal(files.length, 1)
const bundle = fs.readFileSync(path.join(dir, files[0]))
for (const marker of ['JsonRpcRequestChannel', 'JsonRpcGatewayClient', 'Hermes P0 Android native JS export']) assert(bundle.includes(marker), marker)
const sources = ['json-rpc-channel.ts', 'json-rpc-gateway.ts']
const forbidden = []
for (const name of sources) {
  const body = fs.readFileSync(path.join(shared, name), 'utf8')
  const runtimeImports = [...body.matchAll(/^import\s+(?!type\b)(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)].map(x => x[1])
  for (const target of runtimeImports) if (!target.startsWith('./') || /(electron|node:|apps\/desktop)/.test(target)) forbidden.push(`${name}: ${target}`)
}
assert.deepEqual(forbidden, [])
const result = {
  baseline: '2f16a1aa5a35feec496949abdef7ad51aea0e7ef',
  target: 'android', artifactType: 'diagnostic Metro JS export, not APK, not installed or run on device',
  expoVersion: require('./package-lock.json').packages['node_modules/expo'].version,
  reactNativeVersion: require('./package-lock.json').packages['node_modules/react-native'].version,
  bundle: path.join(dir, files[0]), bundleBytes: bundle.length,
  bundleSha256: crypto.createHash('sha256').update(bundle).digest('hex'),
  bundledSdkMarkers: ['JsonRpcRequestChannel', 'JsonRpcGatewayClient'],
  sdkRuntimeImportCheck: 'only relative imports; no Node/Electron/desktop imports in selected upstream SDK modules',
  protocol: '5 synthetic in-memory checks PASS; no plugin protocol or device connection tested',
  export: 'PASS', limitations: ['JS export only', 'no APK/device/keyboard/long-list/push/attachments', 'plugin HTTP/WS differs from upstream TUI JSON-RPC']
}
fs.writeFileSync('results.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
