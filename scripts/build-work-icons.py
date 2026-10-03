"""Build the original two-glyph work-toggle font: uv run --with fonttools==4.66.1 scripts/build-work-icons.py."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[1]
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(['.notdef', 'chevronDown', 'chevronRight'])
font.setupCharacterMap({0xE001: 'chevronDown', 0xE002: 'chevronRight'})
shapes = {
    '.notdef': [],
    'chevronDown': [(200, 610), (270, 680), (500, 450), (730, 680), (800, 610), (500, 310)],
    'chevronRight': [(390, 800), (320, 730), (550, 500), (320, 270), (390, 200), (690, 500)],
}
glyphs = {}
for name, points in shapes.items():
    pen = TTGlyphPen(None)
    if points:
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (1000, min(x for x, _ in points) if points else 0) for name, points in shapes.items()})
font.setupHorizontalHeader(ascent=1000, descent=0)
font.setupNameTable({'familyName': 'HermesWorkIcons', 'styleName': 'Regular', 'uniqueFontIdentifier': 'HermesWorkIcons-Regular-1', 'fullName': 'HermesWorkIcons Regular', 'psName': 'HermesWorkIcons-Regular', 'version': 'Version 1.0', 'copyright': 'Original Hermes App work-toggle chevrons.'})
font.setupOS2(sTypoAscender=1000, sTypoDescender=0, usWinAscent=1000, usWinDescent=0)
font.setupPost()
# Stable timestamps make the checked-in font reproducible.
font.font['head'].created = 2082844800
font.font['head'].modified = 2082844800
font.font.recalcTimestamp = False
path = root / 'assets/work-icons.ttf'
path.parent.mkdir(parents=True, exist_ok=True)
font.save(path)
print(f'Built {path}: {path.stat().st_size} bytes')
