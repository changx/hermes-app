"""Strict first-gate assertion. Run after the passing diagnostic suite.

Exit 1 is intentional until a real bounded, stable history implementation passes.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs' / 'p1' / 'evidence'
runner = json.loads((EVIDENCE / 'runner.json').read_text())
compression = {mode: json.loads((EVIDENCE / f'compression-{mode}.json').read_text())
               for mode in ('inplace', 'rotate', 'idle', 'inplace_idle')}
failures = []
if runner['history_status'] != 200:
    failures.append(f"history API status {runner['history_status']} (required 200 with stable bounded page)")
for mode, result in compression.items():
    if not result['canonical_visible_equal']:
        failures.append(f"{mode}: visible sequence {result['before_count']} -> {result['after_count']} changed")
record = {'gate':'P1-01/02','passed':not failures,'failures':failures}
(EVIDENCE/'gate.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False))
if failures:
    raise SystemExit(1)
