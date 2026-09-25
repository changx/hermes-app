import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const baseline = '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'
const revision = '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baseline, encoding: 'utf8' }).trim()
if (actual !== revision) throw new Error(`Hermes baseline changed: ${actual}`)
const out = resolve('dist/renderer')
await mkdir(out, { recursive: true })
const result = await build({
  entryPoints: [resolve('src/renderer.ts')],
  outfile: join(out, 'renderer.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'safari17'],
  metafile: true,
  alias: { '@hermes/shared': join(baseline, 'apps/shared/src/index.ts') },
  logLevel: 'info'
})
const inputs = Object.keys(result.metafile.inputs)
if (!inputs.some(p => p.endsWith('apps/shared/src/json-rpc-gateway.ts')) ||
    !inputs.some(p => p.endsWith('apps/shared/src/json-rpc-channel.ts'))) throw new Error('SDK not bundled')
const forbidden = inputs.filter(p => /(^|\/)(electron|node_modules|apps\/desktop)(\/|$)|(^|\/)node:/.test(p))
if (forbidden.length) throw new Error(`Native dependency leaked: ${forbidden.join(', ')}`)
for (const name of ['index.html', 'style.css']) await copyFile(resolve('src', name), join(out, name))
await writeFile(resolve('dist/bundle-evidence.json'), JSON.stringify({ baseline: revision, inputs, output: result.metafile.outputs, forbidden }, null, 2) + '\n')
console.log(`SDK included: ${inputs.filter(p => p.includes('/apps/shared/')).length} modules; forbidden native inputs: ${forbidden.length}`)
