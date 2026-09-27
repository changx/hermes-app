#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
baseline="${HERMES_BASELINE:-${1:-}}"
if [[ -z "$baseline" ]]; then echo 'Set HERMES_BASELINE or pass baseline path' >&2; exit 2; fi
expected=2f16a1aa5a35feec496949abdef7ad51aea0e7ef
actual=$(git -C "$baseline" rev-parse HEAD)
if [[ "$actual" != "$expected" ]]; then echo "Hermes baseline SHA mismatch: $actual" >&2; exit 2; fi
[[ "$(node_modules/.bin/tsc --version)" == 'Version 6.0.3' ]]
[[ "$(node_modules/.bin/esbuild --version)" == '0.28.1' ]]
[[ "$(node -p "require('./node_modules/ws/package.json').version")" == '7.5.13' ]]
node_modules/.bin/tsc -p packages/client/tsconfig.json
node_modules/.bin/esbuild packages/client/src/index.ts --bundle --format=esm --platform=neutral --outfile=packages/client/dist/index.js
node tests/client/unit.test.mjs
node tests/client/reliability.test.mjs
node --test packages/client/tests/*.test.mjs
