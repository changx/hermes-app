#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node_modules/.bin/tsc -p packages/client/tsconfig.json
node_modules/.bin/esbuild packages/client/src/index.ts --bundle --format=esm --platform=neutral --outfile=packages/client/dist/index.js
node --test packages/client/tests/*.test.mjs
