# Desktop session search

> Since 2026-10-19 the Session page labels are in the bottom status bar, on one line with `+N` for labels that do not fit. A click still searches. See [desktop-session-status-bar.md](desktop-session-status-bar.md).

Requested by Jamie: a toolbar label in a Session page is a search, not an edit. A click lists the sessions with that label in the left sidebar, and several labels can be combined. The sidebar has a search box below New chat. The search box and Cmd+K search in the same way: by keyword and by label.

## Behavior

- **One query, two places.** A query is a keyword plus zero or more exact labels. The sidebar search box and the Cmd+K picker use the same matching (`sessionQueryScore` in `packages/client/src/sessionSearch.ts`). Each place keeps its own query.
- **Labels are AND.** Every selected label must be on the session. Each added label narrows the results. (The removed Projects label filter used OR and had a No labels choice; the search has neither.)
- **Keyword.** The keyword matches the title as before (exact, prefix, substring, Latin transliteration, initials). It also matches label text and, last, the project name. Matching folds case and Latin accent marks. Rank: exact title, exact label, title prefix, label prefix, title substring, label substring, transliteration, project name. Equal ranks keep the sidebar order: running first, then newest activity.
- **Label suggestions.** When the keyword is in an existing label, that label is offered (up to 6). Choosing it adds the label as a chip and clears the keyword. In Cmd+K the labels are the first options in the list (marked "Label"); Enter or a click adds the chip.
- **Chips.** Selected labels show as chips before the keyword. Each chip has a remove button. Backspace in an empty keyword field removes the last chip.
- **Sidebar results.** While a query is active, one flat result list replaces Recents and the Project tree. Rows are the normal session rows with the project name as the tooltip. The list shows 24 rows and adds 24 per Show more. Escape in the box or the × button clears the query and restores the tree. The query stays when the sidebar is collapsed and when the connection changes.
- **Frequent labels.** Below the sidebar search box, one row shows up to 5 labels: the labels on the most listed sessions (every connection that supports labels). A tie goes to the label used most recently (newest session activity), then to name order (`frequentSessionLabels` in `packages/client/src/sessionSearch.ts`). A click adds the label to the sidebar query, like a toolbar label click; the keyword stays. A selected label stays in the row and shows as pressed; a second click removes it. The row is hidden when no listed session has a label.
- **Toolbar label click.** In a Session page, each toolbar label is a button ("Find sessions with this label"). A click sends only the label text through the main process to the main window (`desktop:search-label`). The sidebar opens if the user collapsed it, and the label is added to the sidebar query. A label that is already selected is not added again. The current Session page does not change. Edit labels stays available from the toolbar button and the session context menu.
- **Cmd+K.** Same matching; up to 24 sessions. Session rows show the project name and the labels. Enter opens the highlighted session. Escape closes the picker.
- **One search for the whole window.** Cmd+K and Shift+Cmd+F open the search in the main window from every page: the sidebar, a Session tab, a New chat tab and the browser panel. Each Session tab is its own native view, so the main process catches the shortcut (`before-input-event` in `tab-manager.ts`) and sends `desktop:open-search` with the scope (`all` or `files`) to the main window. The main window takes the keyboard focus, and the open dialog hides the Session view, so the search covers the whole window. A Session page never opens a search of its own. Before this fix, Cmd+K in a Session tab opened the search inside that tab only.

## Focus style

Neither search field shows a blue focus ring. The sidebar box keeps a light gray border; on focus the border gets slightly darker and a soft shadow appears, as in the message composer. In Cmd+K the keyword field has no box; a thin divider separates it from the results. The input's own outline is removed by `.session-query input:focus-visible`, which outranks the global `input:focus-visible` ring.

## Limits

- The sidebar search uses directory metadata only (titles, labels, project names). Cmd+K also searches message text on servers that offer it; see [Session message search](session-message-search.md).
- Label suggestions and chips appear only on connections that support labels.
- If the sidebar is hidden only because the window is narrow and the browser panel is open, a toolbar label click does not close the browser panel. The query is applied and shows when the sidebar is visible.

## Verification

- `apps/desktop/tests/session-search.test.mjs`: matching rules (AND, keyword on title and label text, ranking, suggestions, helpers); and production `DesktopShellView` in Chromium: a label request opens a collapsed sidebar, adds chips without duplicates, narrows by AND, Backspace/× remove chips, keyword plus label, suggestion to chip, result opens its session, Escape restores the tree; Cmd+K label option first, Enter adds a chip, two labels narrow, Backspace removes chips, Enter opens a session.
- `apps/desktop/tests/native-electron.test.mjs` (Electron/Xvfb, `HERMES_TEST_ELECTRON=1`): a click on the status bar label in Session B's own page opens the main window's search with the `bug` chip and Session B in the results. Real Ctrl+K and Ctrl+Shift+F key input in a Session page opens the search in the main window: the search input has the focus, the Session page has no search of its own, and the Session view is hidden until Escape. Without the main-process change, the test fails at the Cmd+K step.
- Updated: `session-labels`, `session-toolbar`, `sidebar-recents`, `sidebar-redesign` tests for the removed filter icon and the new click behavior.

## Release: desktop v0.1.55

Source `50937f4`, release commit `baa19e9`, tag `v0.1.55`. Local checks before the tag: TypeScript and build passed; the focused Chromium tests (10) and the Electron/Xvfb native test passed. The full desktop suite on the candidate had 146 passed, 5 skipped and 1 failure: `mac-control.test.mjs` "cancel stops waiting", which also fails on unchanged v0.1.53 under full-suite load and passes alone. The tag workflow passed its desktop checks on the macOS runner. The downloaded `Hermes-0.1.55-macOS-arm64.zip` passed its SHA-256 check; Info.plist reports 0.1.55; the executable is arm64. All 29 ASAR `dist/` runtime files are byte-identical to the verified local build. Plugin, mobile, Expo and Gateway are unchanged. Real-device acceptance on Jamie's Mac is pending.

## Release: desktop v0.1.56 (focus style)

Fix `08b8d27`, release commit `161cecf`, tag `v0.1.56`. Before the tag: the full desktop suite on the fix had 147 passed, 0 failed, 5 skipped; after the version bump the focused search and sidebar tests (9) passed. Focused Chromium screenshots had no accent-blue pixels in either search field (v0.1.55: 6,579 in the sidebar, 10,111 in Cmd+K). The tag workflow passed its desktop checks on the macOS runner. The downloaded `Hermes-0.1.56-macOS-arm64.zip` passed its SHA-256 check; Info.plist reports 0.1.56; the executable is arm64; all 29 ASAR `dist/` runtime files are byte-identical to the verified build. Plugin, mobile, Expo and Gateway are unchanged. Real-device acceptance on Jamie's Mac is pending.

## Frequent labels (candidate)

Requested by Jamie: show the 5 most used labels below the sidebar search box. Desktop only (the phone has no left sidebar). Verification: `session-search.test.mjs` covers the ranking rule (session count, then most recent use, then name; a label counts once per session; at most five) and, in Chromium with the production workspace, the order, the position between the search box and Recents inside the sidebar, click to search, the pressed state and the second click that restores the tree. The Chromium check fails without the product change. Mac acceptance is pending.
