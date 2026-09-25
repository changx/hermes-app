#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
baseline="${HERMES_BASELINE:-${1:-}}"
[[ -n "$baseline" ]] || { echo 'Usage: scripts/p1-regression.sh BASELINE_PATH' >&2; exit 2; }
export HERMES_BASELINE="$baseline"
[[ "$(git -C "$baseline" rev-parse HEAD)" == 2f16a1aa5a35feec496949abdef7ad51aea0e7ef ]] || { echo 'Hermes baseline mismatch' >&2; exit 2; }
[[ -x "$baseline/.venv/bin/python" ]] || { echo 'Pinned baseline venv missing' >&2; exit 2; }
: "${TMPDIR:=/home/hermes/.hermes/profiles/jamie/cache/scratch}"
export TMPDIR UV_OFFLINE=1
mkdir -p "$TMPDIR"
: "${P1_EVIDENCE_DIR:=$(mktemp -d "$TMPDIR/hermes-app-p1-05-regression-XXXXXX")}"
export P1_EVIDENCE_DIR
: "${P105_EVIDENCE_DIR:=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1-05}"
export P105_EVIDENCE_DIR
mkdir -p "$P105_EVIDENCE_DIR"
if [[ ! -x node_modules/.bin/tsc || ! -x node_modules/.bin/esbuild ]]; then
  npm ci --offline --ignore-scripts --no-audit --no-fund
fi
uv run --no-project --offline --python "$baseline/.venv/bin/python" -m pytest -q tests/p1 | tee "$P105_EVIDENCE_DIR/python-tests.log"
uv run --no-project --offline --python "$baseline/.venv/bin/python" tests/p1/history_acceptance_gate.py | tee "$P105_EVIDENCE_DIR/strict-gate.log"
bash scripts/client-check.sh "$baseline" | tee "$P105_EVIDENCE_DIR/client-check.log"
node tests/client/real-gateway.mjs | tee "$P105_EVIDENCE_DIR/client-real.log"
bash scripts/export-client-metro.sh | tee "$P105_EVIDENCE_DIR/metro-export.log"
bash scripts/pack-plugin.sh "$baseline" | tee "$P105_EVIDENCE_DIR/package.log"
printf 'P1_EVIDENCE_DIR=%s\nP105_EVIDENCE_DIR=%s\n' "$P1_EVIDENCE_DIR" "$P105_EVIDENCE_DIR"
