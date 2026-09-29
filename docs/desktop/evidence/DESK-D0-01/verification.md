# DESK-D0-01 verification

Status: Done

Verified on Linux before macOS device work. This card establishes the repository and build baseline only; it does not claim that Electron has launched on macOS.

## Locked toolchain

- Node: `24.14.1` (`.nvmrc` and root `engines`)
- npm: `11.11.0` (`packageManager` and root `engines`)
- Electron: `40.10.2`
- React / React DOM: `19.2.3`
- TypeScript: `6.0.3`
- esbuild: `0.28.1`
- `@types/node`: `22.20.0`
- `@types/react`: `19.2.14`
- `@types/react-dom`: `19.2.3`

The root workspace contains `apps/desktop` and `packages/client`. The desktop package resolves `@hermes-app/client@0.1.0` to the local workspace; no client source is copied.

## Clean install and checks

Run from the repository root:

```text
rm -rf node_modules
npm ci --no-audit --no-fund
npm run desktop:check
npm run client:check -- /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
```

Results:

- clean install: passed, 84 packages installed
- desktop TypeScript: passed
- desktop main/preload/renderer build: passed
- desktop baseline test: 1 passed, 0 failed
- shared client suites: 68 passed, 0 failed (24 + 20 + 24)
- `git diff --check`: passed

`package-lock.json` SHA-256 at verification: `80b37778082623e2303b63e5e856eba725cbd89948334351b9eeff319174ab26`.

Generated output is ignored by Git. The build produced main, preload, renderer JavaScript, source maps, HTML and CSS under `apps/desktop/dist/`. Neither `node_modules/` nor `dist/` is committed.

## Not covered

- Electron process launch
- macOS window rendering
- security runtime regression tests
- unsigned `.app` packaging

Those remain in `DESK-D0-02` through `DESK-D0-06`.
