# Markdown table container width

## Current page-width wrapping rule

The latest user requirement supersedes the horizontal-grid policy below. Desktop/mobile Session tables and mobile fullscreen reading must fit the local available content width. Wrap cell text, long tokens, links and inline code without changing the source. Preserve every row, cell, inline format and copy/selection behavior. Quotes, lists and user bubbles use their own available width, not the screen width.

Candidate `fix/table-page-wrap` starts from main `56a6c1b`. Desktop and mobile article HTML use `width:100%; max-width:100%; table-layout:fixed`, zero cell minima and `overflow-wrap:anywhere`; inline code uses `white-space:pre-wrap`. Native Session, standalone table reader and article failure fallback share the production `MarkdownTable`. It uses a bounded View instead of a horizontal ScrollView, distributes columns within the measured local width and reduces cell padding for narrow columns. It has no fixed 156-point column minimum, line count limit or ellipsis. Code blocks and diagrams are unchanged.

Verification:

- Desktop TypeScript/build and 94 tests passed, 0 failed/skipped, including production Chromium and native Linux Electron/Xvfb with controlled transport.
- Mobile TypeScript and 82 tests passed, 0 failed/skipped. Native component checks cover iOS/Android Session/fullscreen tables, 1/2/4/8 columns, local measurement, invalid widths, resize and retained text nodes. A WebView failure exercises the actual article-to-native-table fallback.
- Chromium checks actual desktop Session, standalone embedding, user bubbles and mobile article HTML. Fixtures cover CJK, long words, links, inline code and nested tables. Grid/viewport widths match, cells and source text survive, horizontal offset stays zero and rows grow vertically when narrowed. General/HTML fixtures use 240–1024px; user bubbles use 320–1024px because the older 240px nested fixture leaves less space than one text glyph per column.
- Pinned React Native Yoga passed 24 geometry cases using captured production component styles. The text measurement callback is a fixture, not iPhone/Android native typography.
- iOS and Android Expo JS exports succeeded. Both exact bundles contain the article fixed-width/wrapping CSS and bounded native cell padding. Exports are not independently installable mobile packages.
- Dependency versions and both lockfiles are unchanged. A fresh isolated mobile locked install reports 29 existing audit findings (10 moderate, 19 high); dependency remediation is outside this layout change.

No main merge, runtime deployment, service restart, release or signing operation. Mac/iPhone visual layout, text selection and rotation remain physical-device acceptance gates.

## Historical horizontal-grid policy (superseded)

Jamie explicitly confirmed the distinction between **outer table viewport** and **inner column grid**:

- The outer viewport fills the immediate container's available content width (after padding/borders), and must not widen the message or page.
- The inner grid is **at least as wide as that viewport**. When columns would otherwise leave an unused strip, expand the columns to fill it.
- When readable columns/content need more width, the grid may exceed the viewport and scroll **inside the table**. Do not squeeze columns or force line breaks to fit the visible viewport.
- Apply consistently to desktop/mobile Session content and independent readers. Quote/list nesting uses local content width; normal resize/layout updates use that local width, not screen width.
- Preserve every row/cell, source text, inline formatting, selection and copy. Do not reset deliberate horizontal scroll on ordinary rerenders. Existing natural cell wrapping is not removed; it is not forced by reducing columns to viewport width.

This supersedes candidate `e8d8df6`'s fixed-layout/no-table-scroll interpretation. Candidate `0b94983` bounded only the outer viewport; it did not fix short native grids leaving an unused strip. Neither superseded candidate is published or claimed to meet the final contract.

## Implementation

- Desktop shared `MessageContent`: full-width, bounded, keyboard-focusable horizontal table scroll region. The semantic table uses `width:max-content; min-width:100%` and ordinary auto table layout; readable cell minima remain. Table cells override inherited `overflow-wrap:anywhere` with normal wrapping. No fixed-layout squeezing. The shared renderer has the same policy when independently embedded; no new desktop reader route is added.
- Mobile native Session, independent table reader and article fallback: full-width horizontal ScrollView measures **its own** viewport. Grid width is `max(measured viewport width, column count × 156 + left border)`; the column width distributes that entire grid width across columns after the left border. Retain readable 156-point minimum columns and non-shrinking cells. Small grids expand; wider grids scroll. This restores previous natural cell wrapping rather than forcing all columns to fit the phone width.
- Native layout callbacks reject non-finite/non-positive measurements and avoid identical state updates. Width changes do not remount/key/reset the horizontal scroller or set a `contentOffset`.
- Mobile full article HTML: full-width bounded horizontal viewport, auto/max-content semantic grid with `min-width:100%`, readable cells and normal wrapping. Independent table reader and HTML-load failure fallback use the same native table component.
- Client-only changes. No shared protocol/plugin/core/history/dependency/lockfile/service changes.

## Final verification

- Actual Chromium exercises production desktop Session, independent desktop renderer embedding and production mobile article HTML at 240/320/390/768/1024px then back to 320px. Fixtures include long unbroken tokens, inline code/links/CJK, screenshot-like two-column text, and short two-column tables in prose/quote/list containers. Assertions verify outer viewport equals local available width, grid never narrower than viewport, columns fill the grid, short grids expand, wide grids scroll to the last cell, all cells remain, no outer page overflow, and normal wrapping/auto layout instead of forced anywhere/fixed layout. Body overflow is not hidden by the fixture.
- Production iOS/Android component tests explicitly measure Session, independent table reader and article fallback at multiple local widths for 1/2/3/8 columns; validate column/grid dimensions, non-shrinking readable widths, invalid measurements, resize and absence of horizontal-offset reset.
- Pinned React Native Yoga sources run **50 actual grid geometry cases**, using captured production styles and dimension props returned by the production `MarkdownTable` component: five widths, 1/2/3/4/8 columns, plain/quoted containers. Outer viewport remains bounded and full; inner grid is at least full and columns fill it. Native text measurement is a synthetic fixture; these are Yoga geometry results, not iPhone typography, ScrollView gesture or WKWebView acceptance.
- Desktop TypeScript/build and **107/107 tests** pass, including real Chromium (no skips).
- Mobile TypeScript and **405/405 tests** pass; iOS/Android Expo JS exports succeed and final bundles contain the max-content/min-width HTML grid plus measured native-grid implementation. Exports are not independent signed phone packages.
- The new measurement regression initially exposed its test harness automatically overwriting viewer widths with 320px. Added an explicit no-auto-measure option to that harness, then reran the real production callbacks and full suite successfully; no production workaround for a mock-only fault.
- Unchanged-lock audit from first candidate remains: desktop zero vulnerabilities; mobile 11 moderate / 4 high in Expo CLI/certificate tooling/node-forge chain. No broad upgrades in this layout task; separate security follow-up remains.
- Private evidence: active profile `workspace/hermes-app/markdown-table-container/final-*` logs, `native-styles.*`, `native-layout-cases.json`, `native-layout.*`, `final-native-layout-results.jsonl`. Superseded probe/log evidence retained for traceability.

## Remaining gates

Candidate only: no main merge, runtime deployment, desktop release or service restart. Native Mac/iPhone visual, horizontal gestures, selection, rotation and keyboard acceptance remains pending. Browser/Yoga/component checks do not replace physical-device acceptance. Jamie's screenshot is an issue report, not a final-candidate acceptance result.
