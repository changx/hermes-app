"""Pinned, isolated imports and scratch for the P1 local gate."""
import os
import sys
import tempfile
from pathlib import Path

BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path('/home/hermes/.hermes/profiles/jamie/cache/scratch')
if not BASE.is_dir() or not SCRATCH.is_dir():
    raise RuntimeError('P1 baseline or scratch is unavailable')
sys.path.insert(0, str(ROOT / 'plugins'))
sys.path.insert(0, str(BASE))
os.environ['TMPDIR'] = str(SCRATCH)
tempfile.tempdir = str(SCRATCH)
