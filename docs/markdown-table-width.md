# Markdown table container width

## Corrected confirmed rule

Jamie's phone screenshot clarified that limiting an outer scroll viewport is insufficient. The **actual table grid** must fill the immediate container's available content width and must not exceed it. This supersedes the previous fixed 156-point columns / wider internally scrolling grid interpretation, including historical decisions in `m1-full-markdown.md`.

- Apply to desktop and mobile, Session content and independent readers.
- Two-column/small tables fill the available width rather than leaving an unused strip.
- Long text, CJK, inline code and links wrap within cells; row heights grow. Do not widen the grid or rely on horizontal table scrolling or clipping to satisfy the rule.
- Quotes/lists use their local content width after padding/borders, not screen width or an ancestor's full width. Normal layout tracks window/container changes.
- Preserve original text, all rows/cells, inline formatting, selection and copy. Code-block horizontal scrolling is unrelated and stays unchanged.

## Implementation

- Desktop shared `MessageContent`: width-bounded table container and `width:100%; max-width:100%; table-layout:fixed`. Remove the candidate's horizontal scroll region and minimum column widths. Scope table/cell styles to `.message-markdown` so independent embeddings obey the same rule. No new desktop reader route is added.
- Mobile native Session, single-table reader and article fallback: remove table horizontal ScrollView and fixed cell widths; actual grid is 100% of its container. Equal flexible columns use zero flex basis/minimum width; percent horizontal padding scales with the table. Content wraps and rows take their natural height. Bound rich-text content even in aligned cells.
- Mobile full article HTML: fixed-layout full-width grid, no minimum column widths / max-content sizing / horizontal table scrolling; long cell text/code/links wrap. Native fallback and independent table reader share the native component.
- Client only. No shared protocol, plugin, core, dependency/lockfile, running-service or authoritative-history changes.

## Verification

- The original baseline `4a80671` had outer overflow in a real Chromium probe; the first candidate `0b94983` prevented outer overflow but deliberately retained wider grids. That candidate did **not** satisfy the corrected screenshot requirement and is superseded, not retroactively declared correct.
- Chromium checks production desktop Session markup, independent desktop renderer embedding and production mobile article HTML at 240/320/390/768/1024px and back to 320px. Each surface renders two-column screenshot text and four-column long-token/CJK/bold/code/link fixtures in plain prose, quotes and lists. Assertions compare the **actual grid width** to local available content width, confirm all original cells survive, zero horizontal scroll, no cell-content overflow, and increased row height at narrower widths. Body overflow is not hidden by the fixture.
- Native production iOS/Android component regressions cover Session, independent table viewer, article failure fallback and user/assistant parity. Old assertions requiring table horizontal scrolling are replaced with full-grid/flexible-column assertions; code blocks still scroll.
- Real pinned React Native Yoga sources run 40 layout cases using captured production styles: 240/320/390/768/1024px, 2/3/4/8 columns, plain and quoted containers. Grid fills available width and final column stays inside it. Text measurement is a bounded synthetic fixture: this verifies actual Yoga grid geometry, not iPhone native typography or WKWebView.
- Desktop TypeScript/build and **107/107 tests** pass, including actual Chromium (no skips).
- Mobile **404/404 tests**, TypeScript and iOS/Android Expo exports pass. Exports are JS test artifacts, not independent signed phone packages. Both final bundles contain fixed-layout HTML grid and flexible native-cell markers.
- Mobile initial full regression caught one old user/assistant parity assertion requiring both table and code horizontal scrolling; updated it to require only code scrolling and full-width table preservation, then reran all tests.
- Unchanged-lock audit from first candidate: desktop zero vulnerabilities; mobile 11 moderate / 4 high in Expo CLI/certificate tooling/node-forge chain. No broad dependency upgrades in this layout task; separate security follow-up remains.
- Evidence: active profile `workspace/hermes-app/markdown-table-container/fit-*` logs plus `native-styles.*`, `native-layout.*`, `native-layout-results.jsonl`; first-candidate logs retained for traceability.

## Remaining gates

Candidate only: no main merge, runtime deployment, desktop release or service restart. Native Mac and iPhone visual/selection/rotation/keyboard acceptance remains pending; Chromium, Yoga fixture and mocked-native component results are not substituted for device acceptance. The user's screenshot is a real issue report, not a post-fix acceptance result.

Kanban: `default / t_22892d12`.
