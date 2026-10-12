# Desktop sidebar Session menu

Requested by Jamie: redo the context menu of the Session rows in the sidebar (Todo, Recents, Projects and search results).

## Problems in the old menu

- The menu was HTML in the sidebar page. The Session page is a separate native view over the window. The native view hid every part of the menu outside the sidebar, so items were cut off ("Edit la…").
- The menu showed only when the server supported labels. Other rows had no menu.
- It had only "Mark as todo" and "Edit labels". Rename, Copy link and Archive were only on the open Session's toolbar.
- It had no hover, focus or keyboard navigation like a macOS menu, and it did not show which row it was for.

## Design

- The menu is a native macOS menu (Electron `Menu.popup`), the same as the tab menu. It is never cut off and has the normal macOS look, keyboard navigation and dismissal.
- Every Session row opens it: right-click, the Context Menu key or Shift+F10 (the menu opens under the row).
- While the menu shows, the row has a 2 px accent ring (Finder style). A second right-click waits until the open menu closes.
- Items, in order (macOS title case; "…" opens a dialog):
  1. `Rename…`
  2. `Mark as Todo` / `Remove Todo` (only with server label support)
  3. `Edit Labels…` (only with server label support)
  4. separator
  5. `Copy Link`
  6. separator
  7. `Archive…`
- When the row's connection is offline, every item except `Copy Link` is disabled.
- `Rename…` opens the Rename session dialog for that row. The dialog starts with the current title selected. An unchanged title closes the dialog without a request. A failed save keeps the dialog open; the connection's error banner explains it. The Session toolbar's Rename button uses the same dialog.
- `Archive…` asks `Archive "<title>"?` first. An archived Session's tab closes (existing tab sync).
- `Copy Link` copies the `hermesapp://` link of that row's Session.

## Implementation

- `src/renderer/session-menu.ts`: the item list (pure function).
- `src/main/context-menu.ts`: validates renderer items (plain items and separators only; at most 16; ids `[a-z][a-z0-9-]*`; labels up to 80 characters). Roles, accelerators and submenus do not cross IPC.
- IPC `desktop:context-menu` (main window only) shows the menu and resolves with the chosen id or `null`. macOS can report the close before the click, so `null` waits 150 ms.
- `desktop:copy-session-link` accepts a Session id from the main window. A Session page still copies only its own link.
- The HTML menu and its CSS are removed.

## Verification

- `tests/session-menu.test.mjs`: item order and states; main-process validation; IPC is main-window only; no HTML menu. Chromium (production components): menu at the pointer, row ring, one menu at a time, each action on the right row and connection, archive confirm and cancel, offline state, no label support, Shift+F10 position; rename dialog prefill, selection, blank, failure and success.
- Updated: `todo-flag.test.mjs`, `session-labels.test.mjs`, `session-toolbar.test.mjs`.
- Linux: typecheck, build and the full desktop suite pass (176 tests: 171 pass, 0 fail, 5 skipped).
- Pending: Mac acceptance of the native menu (look, position, keyboard, ring, rename and archive from the sidebar).
