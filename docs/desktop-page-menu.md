# Desktop page menu and search shortcuts

Requested by Jamie (2026-10-25): "桌面端需要支持页面内容的右键选项，包括复制，Web 搜索，页内搜索，全局搜索，搜索支持快捷键".

## What the user sees

A right-click in the app's own pages (the main window and every tab page) opens a native menu.

| Where | Menu |
|---|---|
| Selected text | Copy · Search the Web for "…" · Find "…" in Page · Search Hermes for "…" |
| No selection | Find in Page… · Search Hermes… |
| Text field (composer, search fields) | Cut · Copy · Paste · Select All, then the items above |
| Web link | Copy Link first |

- **Copy** copies the selection with its formatting (the page's own copy command).
- **Search the Web** opens a Google search for the selection in the page's browser panel. From the main window it uses the active tab's browser panel. With no tab open, the system browser opens it.
- **Find in Page** opens the find bar in the page, filled with the selection. From the main window it acts on the active tab's page. With no tab open, the item is not shown.
- **Search Hermes** opens the existing whole-window search (Cmd+K), filled with the selection. See [desktop-session-search.md](desktop-session-search.md) and [session-message-search.md](session-message-search.md).
- Menus that the app already had stay unchanged: sidebar Session rows, tabs, the status bar labels. They replace the page menu where they apply.
- The menu shows each item's shortcut.

## Shortcuts

| Keys | Action |
|---|---|
| Cmd+F | Find in page (opens the find bar; again: selects the query) |
| Cmd+G / Shift+Cmd+G | Next / previous match |
| Enter / Shift+Enter in the find bar | Next / previous match |
| Esc in the find bar | Close the find bar |
| Cmd+E | Find the selected text in the page |
| Shift+Cmd+E | Search the web for the selected text |
| Cmd+K | Search Hermes (unchanged) |
| Shift+Cmd+F | Search files (unchanged) |

Cmd+F, Cmd+G and Cmd+E work from the main window too; they act on the active tab's page. Pages in the browser panel (external web sites) keep these keys for themselves.

## Find bar

- A floating bar at the top right of the page: field, "2 of 9" or "No results", previous, next, close.
- Matching ignores case. A match can run across inline formatting (bold, code, links), as in a browser, but not across two blocks.
- All matches are light yellow; the current match is orange and scrolls into view.
- New messages, loaded history and expanded tool output are searched again automatically; the current position stays.
- Reopening the bar keeps the last query and searches again.
- The text inside text fields (the composer) is not searched.
- At most 2,000 matches are counted ("2000+").

## How it works

- `src/main/page-menu.ts`: the menu entries (pure, unit-tested) and the web search URL.
- `src/main/index.ts` `attachPageMenu`: Electron's `context-menu` event on the main window and on every tab page builds the native menu and runs the chosen action. The accelerators are display only (`registerAccelerator: false`). A page whose own DOM handler calls `preventDefault()` (sidebar rows, tabs, status bar labels) gets no page menu.
- `src/main/tab-manager.ts`: Cmd+F/G/E in `before-input-event` send `desktop:find` to the target page and give it the keyboard focus. `openSearch(scope, text)` sends `desktop:open-search` with the optional text.
- IPC `desktop:search-web` (Shift+Cmd+E from the renderer): only the main window and tab pages; the main process builds the URL.
- `src/renderer/find-bar.tsx`: the find bar. It paints matches with the CSS Custom Highlight API (`::highlight(hermes-find)` and `hermes-find-current`), so the page DOM and selection do not change. It is mounted in tab pages only (`index.tsx`).
- Client only: no plugin, protocol or server change.

## Verification

- `tests/page-menu.test.mjs`: menu entries for selection, no selection, text fields, links, long text; web search URL.
- `tests/page-menu-native.test.mjs` (Electron/Xvfb, `HERMES_TEST_ELECTRON=1`): production main process, preload and renderer with real right-click and key input. It checks the menu items and their shortcuts; Copy writes the clipboard; web search opens Google in that tab's browser panel; Find from the menu fills the bar, finds 3 case-insensitive matches including a bold-split word; Cmd+G, Shift+Cmd+G and Enter move and wrap; no results; a new message is counted; Esc clears the highlights; Cmd+F from the main window focuses the bar in the Session page; Cmd+E finds the selection; Shift+Cmd+E searches the web; Search Hermes opens the main window search with the text; the composer gets Cut/Copy/Paste/Select All; sidebar rows keep their own menu; a main-window Find in Page opens in the Session page. The native popup is captured, because Xvfb cannot click it.

## Limits

- External web pages in the browser panel have no page menu and no app find bar.
- The web search engine is Google; there is no setting.
- Shift+Cmd+E is a new app shortcut, not a macOS standard.
