"""Generate identical Unicode 17 tables/fixtures without runtime dependencies.

Usage: python3 scripts/build-label-graphemes.py SOURCE_DIRECTORY PLUGIN_WORKTREE
SOURCE_DIRECTORY contains the official Unicode 17 UCD GraphemeBreakProperty,
emoji-data, DerivedCoreProperties, GraphemeBreakTest and Unicode license files.
Downloads are deliberately separate from this generator.
"""
import json
import sys
from pathlib import Path

source, plugin = map(Path, sys.argv[1:])
app = Path(__file__).resolve().parents[1]
tables = {}
for filename in ['GraphemeBreakProperty.txt', 'emoji-data.txt', 'DerivedCoreProperties.txt']:
    for line in (source / filename).read_text().splitlines():
        fields = [s.strip() for s in line.split('#')[0].split(';')]
        if len(fields) < 2:
            continue
        prop = fields[1]
        if filename == 'emoji-data.txt' and prop != 'Extended_Pictographic':
            continue
        if filename == 'DerivedCoreProperties.txt':
            if prop != 'InCB':
                continue
            prop = 'InCB_' + fields[2]
        if prop in ('LV', 'LVT'):
            continue  # Hangul syllables have an exact arithmetic classification.
        span = fields[0].split('..')
        tables.setdefault(prop, []).append([int(span[0], 16), int(span[-1], 16)])
for prop, spans in tables.items():
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    tables[prop] = [n for span in merged for n in span]
license_text = (source / 'license.txt').read_text()
note = 'Generated Unicode 17.0.0 grapheme properties. See scripts/build-label-graphemes.py in Hermes App.\n'
js = '/* ' + note + license_text + '*/\nexport const graphemeRanges: Record<string, readonly number[]> = {\n'
py = '"""' + note + license_text + '"""\nRANGES = {\n'
for prop, values in sorted(tables.items()):
    # Hex ranges are smaller and easier to compare to the UCD.
    data = ','.join(hex(n) for n in values)
    js += f'  {prop}: [{data}],\n'
    py += f'    "{prop}": ({data},),\n'
js += '};\n'
py += '}\n'
(app / 'packages/client/src/graphemeRanges.ts').write_text(js)
(plugin / 'plugins/hermes_app/grapheme_ranges.py').write_text(py)
cases = []
for line in (source / 'GraphemeBreakTest.txt').read_text().splitlines():
    tokens = line.split('#')[0].split()
    if not tokens:
        continue
    groups = []
    group = ''
    for token in tokens:
        if token == '÷':
            if group:
                groups.append(group)
                group = ''
        elif token != '×':
            group += chr(int(token, 16))
    cases.append(groups)
for path in [app / 'packages/client/tests/grapheme-cases.json', plugin / 'tests/p1/grapheme-cases.json']:
    path.write_text(json.dumps(cases, ensure_ascii=True, separators=(',', ':')) + '\n')
print(f'Generated {len(tables)} property tables and {len(cases)} official grapheme cases')
