#!/bin/sh
set -eu
SCRATCH=/home/hermes/.hermes/profiles/jamie/cache/scratch
BASE=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$SCRATCH"
exec env -i PATH="$PATH" LANG=C.UTF-8 TMPDIR="$SCRATCH" HOME="$SCRATCH" \
  HERMES_HOME="$SCRATCH" PYTHONDONTWRITEBYTECODE=1 UV_OFFLINE=1 \
  /home/hermes/.local/bin/uv run --no-project --python "$BASE/.venv/bin/python" "$HERE/probe.py"
