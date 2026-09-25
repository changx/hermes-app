#!/bin/sh
# P0 isolated, synthetic history probe; never reads installed profile state.
set -eu
BASE=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
LANE=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/history
mkdir -p "$LANE"
exec env -i HOME="$LANE" HERMES_HOME="$LANE/isolated-home" P0_HISTORY_LANE="$LANE" \
  PATH=/usr/local/bin:/usr/bin:/bin PYTHONPATH="$BASE" \
  "$BASE/.venv/bin/python" "$(dirname "$0")/probe.py"
