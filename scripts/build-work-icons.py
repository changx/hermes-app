"""Build the original Hermes App icon font: uv run --with fonttools==4.66.1 scripts/build-work-icons.py.

All glyphs are original line art on a 1000-unit em (ascent 1000, descent 0).
Code points E001/E002 are used by mobile and desktop work toggles; keep them stable.
"""
import math
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

STROKE = 84  # line weight shared by the sidebar glyphs


def polygon(points):
    return [list(points)]


def circle(cx, cy, r, n=40, reverse=False):
    points = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return points[::-1] if reverse else points


def ring(cx, cy, outer, inner, n=40):
    # Opposite winding makes the inner contour a hole.
    return [circle(cx, cy, outer, n), circle(cx, cy, inner, n, reverse=True)]


def bar(x0, y0, x1, y1):
    return [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]


def gear():
    # Six broad teeth and a thin rim keep the outline readable at 16-18px.
    teeth, outer, root, hole = 6, 455, 352, 270
    step = 2 * math.pi / teeth
    points = []
    for i in range(teeth):
        a = i * step + step / 2
        # Each tooth: root -> rise -> flat top -> fall, with a slight taper.
        for offset, radius in ((-0.50, root), (-0.26, root), (-0.18, outer), (0.18, outer), (0.26, root)):
            angle = a + offset * step
            points.append((500 + radius * math.cos(angle), 500 + radius * math.sin(angle)))
    return [points, circle(500, 500, hole, reverse=True), circle(500, 500, 120, 32)]


def compose():
    # Pencil: tip at lower left, body to upper right.
    d = (math.sqrt(0.5), math.sqrt(0.5))
    n = (-d[1] * 66, d[0] * 66)
    tip, start, end = (178, 178), (300, 300), (792, 792)
    body = [(start[0] + n[0], start[1] + n[1]), (end[0] + n[0], end[1] + n[1]), (end[0] - n[0], end[1] - n[1]), (start[0] - n[0], start[1] - n[1])]
    return [[tip, body[0], body[1], body[2], body[3]], bar(150, 108, 520, 108 + STROKE)]


def plus():
    h = STROKE / 2
    return [[(500 - h, 180), (500 - h, 500 - h), (180, 500 - h), (180, 500 + h), (500 - h, 500 + h), (500 - h, 820),
             (500 + h, 820), (500 + h, 500 + h), (820, 500 + h), (820, 500 - h), (500 + h, 500 - h), (500 + h, 180)]]


def more():
    return [circle(x, 500, 62, 24) for x in (220, 500, 780)]


def filter_lines():
    h = STROKE / 2
    return [bar(160, 700 - h, 840, 700 + h), bar(270, 500 - h, 730, 500 + h), bar(390, 300 - h, 610, 300 + h)]


shapes = {
    '.notdef': [],
    'chevronDown': polygon([(200, 610), (270, 680), (500, 450), (730, 680), (800, 610), (500, 310)]),
    'chevronRight': polygon([(390, 800), (320, 730), (550, 500), (320, 270), (390, 200), (690, 500)]),
    'chevronLeft': polygon([(610, 800), (680, 730), (450, 500), (680, 270), (610, 200), (310, 500)]),
    'gear': gear(),
    'compose': compose(),
    'plus': plus(),
    'more': more(),
    'filter': filter_lines(),
}
codes = {'chevronDown': 0xE001, 'chevronRight': 0xE002, 'chevronLeft': 0xE003, 'gear': 0xE010, 'compose': 0xE011, 'plus': 0xE012, 'more': 0xE013, 'filter': 0xE014}

root = Path(__file__).resolve().parents[1]
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(list(shapes))
font.setupCharacterMap({code: name for name, code in codes.items()})
glyphs = {}
for name, contours in shapes.items():
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(tuple(round(v) for v in contour[0]))
        for point in contour[1:]:
            pen.lineTo(tuple(round(v) for v in point))
        pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (1000, glyphs[name].xMin if contours else 0) for name, contours in shapes.items()})
font.setupHorizontalHeader(ascent=1000, descent=0)
font.setupNameTable({'familyName': 'HermesWorkIcons', 'styleName': 'Regular', 'uniqueFontIdentifier': 'HermesWorkIcons-Regular-2', 'fullName': 'HermesWorkIcons Regular', 'psName': 'HermesWorkIcons-Regular', 'version': 'Version 2.0', 'copyright': 'Original Hermes App interface icons.'})
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
