#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../tests/client/mobile"
: "${HERMES_EXPO_DEPS:=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile}"
: "${TMPDIR:=/home/hermes/.hermes/profiles/jamie/cache/scratch}"
export HERMES_EXPO_DEPS TMPDIR EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 CI=1
node -e 'const a=require("./package-lock.json");const b=require(process.env.HERMES_EXPO_DEPS+"/package-lock.json");if(JSON.stringify(a.packages)!==JSON.stringify(b.packages))throw Error("Expo lock mismatch")'
if [[ -L node_modules ]]; then echo 'Mobile node_modules must be independent' >&2; exit 2; fi
if [[ ! -x node_modules/.bin/expo ]]; then npm ci --offline --ignore-scripts --no-audit --no-fund; fi
node_modules/.bin/expo export --platform android --output-dir dist --no-bytecode --no-minify --max-workers 2
bundle=$(find dist -type f -name '*.js' | head -1)
if [[ -z "$bundle" ]]; then echo 'No Android JS bundle' >&2; exit 3; fi
node - "$bundle" <<'JS'
const fs=require('node:fs');const data=fs.readFileSync(process.argv[2],'utf8');
for(const needle of ['Hermes P1 shared client Android JS','/v1/snapshot','/v1/threads/','client_message_id'])if(!data.includes(needle))throw Error('New shared client missing from Metro bundle: '+needle)
console.log('Metro Android JS includes HermesClient, protocol routes, and native view entry: '+process.argv[2])
JS
