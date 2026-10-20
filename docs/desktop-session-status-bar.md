# Desktop Session status bar

Requested by Jamie (2026-10-19): the desktop app needs a place that shows the current Session's connection and Project. The information is important but is not used often. The floating top toolbar was in the way, and two strips at the top left and top right of the Session looked bad.

## Decision

- The Session page has no top toolbar. The timeline starts at the top of the page.
- One status bar is the last row of the Session page, under the composer. It is one line high (30px) and spans the full page width. It has a thin top border, no background block, and small muted text (0.8 × the app text size, so it follows the text size setting).
- Left to right:
  1. **Location** (`nav`, "Session location"): a state dot and the connection name, `›`, then the Project name.
  2. **Tools**: every Session tool as its own icon button (Jamie: fully expanded, no `⋯` menu).
  3. **Labels**: they take the rest of the row (Jamie: labels after the tools, so they get more room).

## Location

- The dot shows the Session connection's state: green online, amber reconnecting, gray offline or connecting, red needs attention. For reconnecting, offline and needs attention, the state text from the sidebar (`connectionHint`) shows after the name.
- The connection name is always shown, also with one connection. A click opens Settings on that connection's page (tooltip "Connection settings"). If Settings is already open, it moves to that page.
- The Project name: a click shows the Project in the main window's sidebar (tooltip "Show in sidebar"). The sidebar opens if it is collapsed, a search is cleared (the search list replaces the Project tree), the Project branch opens, scrolls into view and is marked for 1.6 s.
- The location takes at most 45% of the row. The Project name shrinks first, then the connection name. The dot stays.

## Tools

- One icon button per tool (`role="toolbar"`, "Session tools"), in the former top toolbar order: Mark as todo / Remove todo, Copy link, Export conversation (when the server supports it), Edit labels (with label support), Rename, Archive.
- Names, tooltips, states and actions are unchanged from the top toolbar. The todo flag keeps ⇧⌘L and its rules (see [todo-flag.md](todo-flag.md)) and is disabled while offline.
- Buttons are 24px with 16px icons; the tools never shrink. On a narrow window the labels give up room first, then the location.

## Labels

- Labels stay on one line, in their order, without `todo`. A click searches the sidebar for that label (unchanged; see [desktop-session-search.md](desktop-session-search.md)).
- Labels that do not fit move into a `+N` button. Its tooltip lists them; a click opens a native menu with those labels, and a choice searches for it. Every chip stays in the DOM so its width can be measured; a chip that does not fit is out of the flow, hidden and `inert`. The fit is computed again when the row width or the labels change.

## Implementation

- `src/renderer/session-status-bar.tsx`: `SessionStatusBar` and `StatusLabels`.
- `src/renderer/shell.tsx`: the top toolbar is removed; the status bar is mounted after the composer. The tools call the same functions as before.
- `desktop:context-menu` (used by the `+N` label menu) also accepts a Session tab (not a New chat or Automation tab). Its view coordinates are moved by the tab view's position in the window (`DesktopTabManager.contentOrigin()`). Item validation is unchanged.
- `desktop:open-settings` takes an optional connection id. An unknown id opens Settings without a page request. The Settings window snapshot carries `settingsRequest` (`page`, `nonce`); `SettingsPage` applies each nonce once, after that page exists.
- `desktop:reveal-project` takes a Project id that exists in the snapshot and sends it to the main window (`onRevealProject`). Only the id crosses windows. `NativeWorkspace` opens the sidebar, clears the search and passes the request to `NavigationPanel` (`reveal`).
- Removed: `ToolbarLabels`, the `.session-toolbar` and `.conversation-actions` styles.

## Verification

- `tests/session-status-bar.test.mjs` (replaces `session-toolbar.test.mjs`; production `DesktopShellView` in Chromium): no top toolbar; timeline at the top; bar under the composer, full width, at most 32px high; order location, actions, labels; labels fill the rest; connection name, state, aria names and tooltips; connection and Project clicks; tooltips above the controls and inside the window; every tool as its own button in order, on one line inside the bar, each action; labels search; `+N` at 1100px and 640px with ten labels (shown labels first and in order, hidden ones inert, all on one line inside the bar, dot and every tool visible, location within its share, `+N` menu searches a hidden label); offline state, tools without Export support, Settings without a known connection row; attachment card layout.
- `tests/native-electron.test.mjs` (Electron/Xvfb): a status bar label in Session B searches the main window sidebar; the Project name of Session B clears a sidebar search and reveals Project Beta; the connection name moves the open Settings window to the connection page; a Session page menu rejects invalid items before a popup.
- Updated: `session-menu` (IPC route), `todo-flag`, `session-labels`, `message-toolbar`, `window-focus-composer`, `color-palette`, `default-font-size` tests (selectors).
- Linux only. Mac acceptance is open: look, the `+N` menu position at the bottom of the window, Settings page jump, Project reveal, label overflow with real labels.

## Release

- 2026-10-19: desktop v0.1.98 (authorized by Jamie: "合并发布"). Feature commits `78ca256`, `44cf27c`, `821d9fc`; release commit `7e2adee`, tag `v0.1.98`, pushed atomically with `main`. Linux `desktop:check` on the candidate with Chromium and Electron/Xvfb: 239 tests, 238 pass; the one failure is `browser-window-native`, which fails the same way on unchanged `main` `fac6284`. Mac mini workflow run `39370721739`: 239 tests, 186 pass, 0 fail, 53 skipped; `npm audit` 0 vulnerabilities. The downloaded zip passes its `.sha256` check; Info.plist shows 0.1.98. The ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `dist/renderer/styles.css` are byte-identical to the local build. Releases kept: v0.1.98 and v0.1.97.
- Desktop only: no mobile, shared client or plugin change; Expo and Gateway not restarted.
- Pending: Mac acceptance. Rollback: reinstall v0.1.97.
