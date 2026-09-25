const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const baseline = process.env.HERMES_BASELINE || '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'
const expected = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'
const actual = execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Hermes baseline mismatch: ${actual} != ${expected}`)
for (const name of ['json-rpc-channel.ts', 'gateway-events.ts']) {
  if (!fs.existsSync(path.join(baseline, 'apps/shared/src', name))) throw new Error(`Missing shared SDK ${name}`)
}
console.log(`Hermes shared SDK pinned baseline ${actual}`)
