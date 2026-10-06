# Desktop tree navigation

Task: desktop-tree-navigation (isolated branch)

Scope: replace permanent Channel/Thread columns with an activity rail and collapsible Channel → Thread tree panel. No mobile, server, credentials or release changes.

Acceptance:
- Channels are expandable parents; Threads are children, sorted by descending last message activity with deterministic ties.
- Initially render at most 24 children active within the trailing 24 hours. Each Load more reveals at most 24 additional children, including older activity. No full list rendered at once.
- Current older Thread stays identifiable in the conversation header, without silently widening the recent activity filter.
- Panel can collapse independently of channel branches; rail and Cmd+K/header switcher remain usable while collapsed.
- Cross-channel switching selects the thread's parent; no draft/send/history semantics changed.
- Narrow layout uses an overlay panel, not hidden unreachable navigation.
- Automated desktop checks pass. Mac visual/interaction acceptance remains separate.

Verification:
- `npm run desktop:check`: typecheck/build and 44 tests passed.
- Shared client typecheck/build plus unit/reliability/package tests: all passed (24, 20 and 24 respectively).
- `npm audit`: 0 vulnerabilities; `git diff --check`: passed.
- `npm run desktop:package:mac`: generated unsigned arm64 Hermes.app on Linux; expected codesign/ASAR integrity warning. This is not Mac launch or UI acceptance.
- Root `client:check` wrapper requires an explicit fixed Hermes baseline and could not run in this checkout; underlying shared client checks above were executed directly.
- Fresh Electron installation raced on the first concurrent test invocation; after installation completed, the full desktop gate was rerun successfully.
- Changes remain on isolated desktop-tree-navigation branch; no deployment or new Release performed.

## Native sidebar indentation and hover candidate

Branch: `fix/sidebar-tree-hover`; card: `t_6cd23e5f`.

The native-sidebar override removed the original child indent and branch border. The existing Session hover used the same color as the sidebar, so it had no visible contrast.

- Restore a 24px child-container inset, 10px internal gutter and 1px branch guide. Actual Session titles sit 17px to the right of Channel titles.
- Give Channel rows and Session rows a visible neutral hover background. Keep selected Sessions blue; retain keyboard focus outlines and existing actions.
- No changes to navigation logic, ordering, mobile, shared protocol, backend or dependencies.
- Regression uses production React and CSS with real Chromium pointer input through DevTools. It failed on the baseline with -14px title indentation and no guide, then passed at 230px and 280px sidebar widths.
- Desktop TypeScript and build passed. Browser-enabled full desktop tests: 37 passed, 1 native Electron test skipped, no failures. Tests cover collapse/reopen, Session click, status retention, labels, drafts, selection and narrow layouts.
- Private computed-style evidence and screenshot: Channel workspace `sidebar-tree-hover/`.
- Candidate only. Not merged or published. Installed macOS visual acceptance remains open.

## Resizable native sidebar candidate

Branch: `feat/sidebar-resize`; card: `t_4295a06a`. This candidate includes the indentation/hover candidate above.

Confirmed behavior:
- Drag the sidebar's right edge to change its width. Default 280px; minimum 200px; maximum 480px. Smaller windows reduce the maximum to leave 360px for the conversation where possible.
- Save only the device-local width preference on release. Window resizing temporarily clamps the layout without replacing the preferred width. Collapse/expand preserves the preference.
- Double-click the edge to reset to 280px. The focusable separator supports Left/Right in 10px steps and Home/End for the current limits.
- Reuse the existing renderer-to-main content-bounds API. Resize retained native views; do not recreate tabs, reload conversation history or change drafts.
- Pointer release/cancel and window blur terminate dragging. A host-window release listener also covers native pointer capture loss at the width limits.
- Storage failures leave resizing usable and explain that the preference could not be saved.

Verification:
- Desktop TypeScript, build and all 40 tests passed with Chromium and native Electron enabled. No skips or failures.
- Linux/Xvfb used real Electron input and production renderers/preload/IPC with controlled transport/storage fixtures. Checked drag to 380px, both limits, native bounds, collapse/expand, window shrink/restore, keyboard change, double-click reset, saved-width restoration after host renderer reload, storage failure, retained native view identity and conversation DOM.
- Previous tree/hover and label/draft regressions still pass. No mobile, backend, protocol, dependency or release changes.
- Private log and native screenshot: Channel workspace `sidebar-resize/`.
- Not merged or published. Full installed-app restart and macOS pointer/visual acceptance remain separate from Linux renderer restoration checks.

This iteration windows already-synchronized thread summaries for display. It does not replace the shared client's synchronization protocol with a server-side 24-hour query; the current list API exposes cursor/limit, not an activity cutoff.

## Multi-connection sidebar redesign

Branch: `feat/desktop-sidebar`. Requested by Jamie (2026-10-06): the sidebar still looked like a single-connection design, the footer showed one server, the Settings entry was an emoji, and text sizes should follow the ChatGPT desktop reference screenshot.

Layout, top to bottom:
- **Actions:** *New chat* and *New project* as icon rows. *New project* moved from the footer and is enabled while any connection is online.
- **Projects** section title, with the label filter icon on the right of the title. Then the flat Project tree across all connections; the Hermes name appears under a Project only when several connections are saved.
- **Footer:** one *Settings* row with a gear icon. The single server name is removed; connections are listed and managed in Settings.

Typography and spacing, measured from the reference (2x screenshot): rows about 31px high, section titles the same size as rows in a muted colour, no uppercase or bold, regular-weight Project names. In this app the sidebar text follows the user's text-size setting (default 16px); rows are 2× the text size.

Icons use the bundled icon font (`assets/work-icons.ttf`, built by `scripts/build-work-icons.py`). New original glyphs: chevron left, gear, compose, plus, more, filter. Existing chevron code points E001/E002 keep their exact outlines, so mobile is unchanged. Icons are hidden from assistive technology; each button keeps its accessible name.

Verification (Linux): desktop TypeScript, build and full suite with Chromium and Electron/Xvfb **101/101**. New Chromium test `sidebar-redesign` renders the production `NativeWorkspace` with two connections and checks: no server in the footer, one Settings action, icon font loaded and used, no emoji/text glyph icons, action order, section title size/colour/weight, row height, connection names under Projects, filter placement, and text-size scaling. Existing tests updated for the moved *New project* button, the renamed font-size selector and the child indentation (Session titles stay 17px right of Project names). The first full run failed two Electron tests on a corrupt Electron download (`resources.pak`); reinstalling Electron fixed both. Mobile tests 106 pass / 1 existing skip and iOS export pass with the rebuilt font. Evidence: Channel workspace `desktop-sidebar/` (`desktop-check.log`, `sidebar-redesign.png`, `sidebar-redesign.json`).

Not verified: Mac window appearance. The reference screenshot and the rendered screenshot were measured by pixel analysis, not reviewed visually in this session.
