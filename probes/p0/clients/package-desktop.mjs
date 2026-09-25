import { cp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve('.')
const stage = join(root, '.electron-stage', 'root')
const electron = join(root, 'node_modules/electron/dist')
const home = join(stage, 'opt/hermes-p0-probe')
const app = join(home, 'resources/app')
await mkdir(app, { recursive: true })
await cp(electron, home, { recursive: true })
await cp(join(root, 'dist/renderer'), join(app, 'dist/renderer'), { recursive: true })
await copyFile(join(root, 'desktop/main.cjs'), join(app, 'main.cjs'))
await copyFile('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/LICENSE', join(app, 'LICENSE.hermes-agent'))
await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'hermes-p0-synthetic-probe', version: '0.0.1', main: 'main.cjs' }))
const control = join(stage, 'DEBIAN')
await mkdir(control, { recursive: true })
await writeFile(join(control, 'control'), `Package: hermes-p0-synthetic-probe\nVersion: 0.0.1\nArchitecture: amd64\nMaintainer: Hermes App P0 local probe <local@invalid.example>\nDescription: Disposable synthetic Hermes shared-SDK desktop feasibility probe\n`)
const bin = join(stage, 'usr/bin')
await mkdir(bin, { recursive: true })
await writeFile(join(bin, 'hermes-p0-probe'), '#!/bin/sh\nexec /opt/hermes-p0-probe/electron "$@"\n', { mode: 0o755 })
await execFileSync('dpkg-deb', ['--build', stage, join(root, 'hermes-p0-synthetic-probe_0.0.1_amd64.deb')], { stdio: 'inherit' })
console.log('Local desktop package built (synthetic probe, no deployment/signing).')
