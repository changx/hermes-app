# Todo flag (desktop and mobile)

Requested by Jamie: a quick todo flag on the Session page. The flag marks the session in the session lists. Other labels are of little use in lists, so the lists no longer show label pills.

## Storage

- The flag is the reserved label `todo` in the existing session labels. No plugin, server or Gateway change.
- Reading ignores case: `todo`, `TODO` and `ToDo` all count. Writing adds `todo`. Removing deletes every case of it and keeps the other labels in order.
- The server allows 10 labels. A session with 10 other labels cannot get the flag. The App shows: "Remove a label first. A session can have up to 10 labels."
- The save uses the normal label save. If the read-back does not match, the App shows "Labels changed on another device. Try again." Other failures show "Could not update the todo flag. Check the connection and try again." No technical detail is shown.
- Shared rules: `packages/client/src/todo.ts` (no runtime imports, so mobile Node tests can load it).

## Desktop

- Session page: the flag button is in the status bar under the composer, the first tool button (since 2026-10-19; see [desktop-session-status-bar.md](desktop-session-status-bar.md)). Before that, it was the first button of the top toolbar. Outline when off, filled orange when on (`aria-pressed`). Tooltip and name: "Mark as todo" or "Remove todo". It is disabled while the connection is offline. It is hidden when the server has no label support.
- Shortcut: ⇧⌘L on macOS, Ctrl+Shift+L elsewhere (the Mail shortcut for Flag). It toggles the flag of the active Session tab, also while the sidebar or a browser pane has focus. The main process catches the key in `before-input-event` and sends `desktop:toggle-todo` to the active Session tab only. The page runs the same action as the button. The shortcut does nothing when the button is unavailable (offline, no label support, a save in progress), when the tab is not active, or when a dialog is open. The button tooltip names the shortcut ("Mark as todo (⇧⌘L)"); Settings › Shortcuts lists it as "Mark or remove todo".
- The status bar label row shows the other labels only.
- Sidebar order from top: New chat, search box, frequent labels, Automations, **Todo**, Recents, Projects.
- The Todo section lists every todo session of any age from every connection: running first, then newest activity. It is hidden when no session is flagged. The header collapses it; the choice is saved on this device (`hermes.sidebar.todo-collapsed`).
- Recents and each Project's session list put running sessions first, then newest activity. Projects keep their recent window, so an old todo session shows only in Todo.
- Rows show an orange flag right of the title. Rows show no label pills. The frequent-labels row leaves out `todo`.
- The row context menu offers "Mark as Todo" or "Remove Todo" after "Rename…". See [desktop-session-menu.md](desktop-session-menu.md).
- Search results keep best-match order. Labels stay on the toolbar (a click searches the label), in search filters and in Edit labels.

## Mobile

- Session page header: a flag button next to Session options, with the same names and messages.
- Recents tab: a Todo section above Recents with the same content and order. Cards show the flag, not label pills. Quick labels leave out `todo`.
- Channel session list: running first, flag on rows, no label pills. Long-press offers "Mark as todo" or "Remove todo".

## Icon

- `scripts/build-work-icons.py` adds a filled `flag` glyph at `U+E016` (`ICONS.flag`). Existing glyphs are unchanged. `assets/work-icons.ttf` is rebuilt; both apps ship it.

## Verification

- Desktop `tests/todo-flag.test.mjs` (Chromium, production components): section order, Todo content and order, Recents and Project running-first order, flag placement and glyph, no pills, row height, frequent labels, context-menu mark and remove, collapse, hidden without todo; toolbar button state, save, label row, failure, stale read-back, 10-label limit, offline, no label support; shortcut mark and remove, tooltip, and no action offline, in a hidden tab, without label support or with a dialog open. `settings-layout.test.mjs` checks the Shortcuts list. The main-process key routing has no automated test; check it on the Mac.
- Updated: `sidebar-recents.test.mjs` (running first), `session-labels.test.mjs` (no row pills, menu), `session-toolbar.test.mjs` (tool order), `font-settings.test.mjs`.
- Mobile `tests/todo-flag.test.mjs` (shared rules, limit equals the server limit, toggle messages), `tests/channel-archive.test.mjs` (row flag, long-press toggle), `tests/recents-search.test.mjs` (Todo section, order).
- Linux only. Mac and iPhone acceptance are pending.

## Release

- 2026-10-12: merged to `main` as `9e66f47` (with the desktop composer focus on app activation, see [desktop-tabs.md](desktop-tabs.md)). Expo restarted on `9e66f47`: iOS and Android manifests 200 (SDK 57), both bundles contain `Mark as todo` and `Remove todo`. Gateway unchanged.
- Desktop v0.1.69 (`a7736f2`): Mac mini workflow run 38233707670: 170 tests, 130 pass, 0 fail, 40 skipped; audit 0; zip uploaded direct at 85.8 Mbps. Downloaded zip passes sha256; Info.plist 0.1.69; arm64; the ASAR contains the todo and focus code. Two newest Releases kept.
- Pending: Mac and iPhone acceptance. Rollback: reinstall v0.1.68; for mobile, revert the commits and restart Expo.
