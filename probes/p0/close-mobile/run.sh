#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${HERMES_BASELINE:=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline}"
: "${HERMES_EXPO_DEPS:=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile}"
export HERMES_BASELINE HERMES_EXPO_DEPS EXPO_NO_TELEMETRY=1 CI=1
node verify-baseline.cjs
available_kib=$(df -Pk "$PWD" | python3 -c 'import sys; print(int(sys.stdin.readlines()[-1].split()[3]))')
if (( available_kib < 20 * 1024 * 1024 )); then echo 'Less than 20 GiB free; refusing dependency install' >&2; exit 2; fi
mkdir -p "$HERMES_EXPO_DEPS"
cp package.json package-lock.json "$HERMES_EXPO_DEPS/"
timeout 90 npm ci --prefix "$HERMES_EXPO_DEPS" --no-audit --no-fund --prefer-offline
if [[ ! -e node_modules ]]; then ln -s "$HERMES_EXPO_DEPS/node_modules" node_modules; fi
if [[ "$(realpath node_modules)" != "$(realpath "$HERMES_EXPO_DEPS/node_modules")" ]]; then
  echo 'Unexpected node_modules; refusing to overwrite it' >&2; exit 3
fi
timeout 90 npm run export:android-js 2>&1 | tee export-android-js.log
timeout 30 npm run test:protocol 2>&1 | tee protocol-test.log
node verify-results.cjs
