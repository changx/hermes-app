# Markdown table container width

## Confirmed rule

Jamie confirmed this rule for desktop and mobile, both Session rendering and independent content readers:

- The table's **outer viewport** is no wider than the immediate container's available content width, excluding padding/borders. It must not widen the message, timeline or page.
- A readable inner grid may be wider and scroll horizontally **inside that viewport**. Do not squeeze all columns or clip inaccessible cells to meet the outer limit.
- Recompute through normal layout when the container resizes. Quotes/lists use their reduced local content width, not screen width or an ancestor's full width.
- Preserve original text, every cell, inline formatting, selection and copy. Do not reset deliberate horizontal scroll on ordinary rerenders.

## Implementation

- Desktop: the shared `MessageContent` wraps each semantic table in a width-bounded, keyboard-focusable horizontal scroll region. Table styling belongs to `.message-markdown`, not `.message`, so the same renderer works outside the Session shell without losing its width policy. No new desktop reader route is added; an independent embedding of the existing renderer is verified.
- Mobile native: retain the existing readable 156-point columns and internal horizontal ScrollView. Bound the shared block/root, quote/list and viewer/fallback ancestors; make the scroll viewport explicitly `minWidth:0` and stretch the independent reader's vertical content.
- Mobile full article HTML: explicitly bound article/table sections and the horizontal scroll viewport to their local container, retaining the wider inner grid. Native fallback and single-table reader use the same native table component.
- Client only. No changes to shared protocol, plugin, core, dependencies/lockfiles, running services or authoritative history.

## Verification (isolated candidate, baseline `4a80671`)

- Actual Chromium baseline reproduces overflow at a 240px container: outer scroll width 320px; table width 250px exceeds plain/quote/list parent widths 182/102/142px. Candidate geometry checks show no outer horizontal overflow.
- Chromium exercises production desktop Session markup, independent desktop renderer embedding and production mobile article HTML at 240/320/390/768/1024px and back to 320px. Eight columns, long unbroken tokens, CJK, inline bold/code, quote and list nesting are covered. Every table viewport stays within its parent's content width; all 16 header/body cells remain, and the last cell is reachable by internal scroll. No outer overflow is hidden by the test body.
- Native component regression executes production iOS/Android render trees for Session, independent table viewer and article failure fallback. This is not Yoga/WKWebView or physical-device evidence.
- Desktop TypeScript/build and **107/107 tests** pass, including real Chromium tests (no skips).
- Mobile **404/404 tests**, TypeScript and iOS/Android Expo exports pass. Exports are JS test artifacts, not independent signed phone packages.
- Initial checks failed because reused dependencies lacked desktop Mermaid/shared-client build output and Metro did not resolve the mobile symlink. Isolated locked installs and a shared-client build resolved these prerequisite issues; final runs above succeeded.
- Desktop dependency install audit: zero vulnerabilities. Mobile locked dependencies audit reports 11 moderate and 4 high (Expo CLI / certificate tooling / node-forge dependency chain); unchanged lockfile, no broad upgrades in this layout task. Security follow-up is separate and these findings must not be hidden.
- Private evidence: active profile `workspace/hermes-app/markdown-table-container/` (check/install/export/audit logs, baseline probe/results).

## Remaining gates

Candidate only: no main merge, runtime deployment, desktop release or service restart. Native Mac and iPhone visual/gesture/rotation/keyboard acceptance remains pending; Chromium and mocked-native component results are not substituted for it.

Kanban: `default / t_22892d12`.
