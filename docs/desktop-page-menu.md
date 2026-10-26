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

## Cmd+click on a link

Requested by Jamie (2026-10-25): "再给桌面端增加一个 cmd+click 点击链接，用系统浏览器打开的功能。"

- A plain click on a web link opens it in the browser panel of the page (unchanged).
- Cmd+click opens it in the system browser (the Mac's default browser). A middle click does the same.
- This works in the app's own pages (messages, sources, file links) and in web pages inside the browser panel. In the browser panel the pane stays on its page.
- Only `http` and `https` links without a user name or password open. Session links (`hermesapp://`) still open in the app.
- How: Chromium reports Cmd+click (Ctrl+click on Linux and Windows) and a middle click as a `background-tab` window request. `opensInSystemBrowser` and `isSystemBrowserUrl` in `src/main/security.ts`; used by `openWebLink` in `index.ts` and by the browser pane's window-open handler in `browser-sidebar.ts`.

## Window title

Requested by Jamie (2026-10-25): "当前 active 的 session title 显示在 window title bar 上。"

- The main window's title bar shows the title of the active tab: the Session title, "New chat", "New automation", an automation's name or "Automations". With no open tab it shows "Hermes".
- The title follows a rename, a generated title and every tab switch. It is one line, at most 200 characters; macOS shortens it to fit the bar.
- The page's own `<title>` does not replace it (`page-title-updated` is ignored on the main window).
- How: `DesktopTabManager.publish()` sets the title from the active tab of the main-window snapshot (`windowTitle` in `src/main/window-title.ts`).

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

- `tests/page-menu.test.mjs`: menu entries for selection, no selection, text fields, links, long text; web search URL; the Cmd+click rule (disposition and allowed URLs); the window title rule.
- `tests/page-menu-native.test.mjs` (Electron/Xvfb, `HERMES_TEST_ELECTRON=1`): production main process, preload and renderer with real right-click and key input. It checks the menu items and their shortcuts; Copy writes the clipboard; web search opens Google in that tab's browser panel; Find from the menu fills the bar, finds 3 case-insensitive matches including a bold-split word; Cmd+G, Shift+Cmd+G and Enter move and wrap; no results; a new message is counted; Esc clears the highlights; Cmd+F from the main window focuses the bar in the Session page; Cmd+E finds the selection; Shift+Cmd+E searches the web; Search Hermes opens the main window search with the text; the composer gets Cut/Copy/Paste/Select All; sidebar rows keep their own menu; a main-window Find in Page opens in the Session page; Cmd+click and middle click on message links open the system browser, a plain click uses the browser panel; the window title shows the active Session, follows a rename, ignores the page title, and changes for another Session, New chat and no tab. The native popup is captured, because Xvfb cannot click it.
- `tests/browser-sidebar-native.test.mjs`: Cmd+click on a link in a web page in the browser panel opens the system browser, and the pane keeps its page.
- The native Cmd+click and window-title checks fail without the product change (red check run).

## Limits

- External web pages in the browser panel have no page menu and no app find bar.
- The web search engine is Google; there is no setting.
- Shift+Cmd+E is a new app shortcut, not a macOS standard.

## Candidate status

Branch `feat/desktop-page-context-menu` (base `13a4157`, equal to `origin/main`), with the right-click menu, the find bar, Cmd+click and the window title. Full desktop suite with Chromium and Electron on the final tree: 255 tests, 254 passed, 0 skipped, 1 failure: `native-electron` at `CHECK native view tracks drag 380`. That step also fails on the base (2 of 5 runs alone; candidate 1 of 3 alone), so it is not caused by this branch. The previous run of the Cmd+click tree had 254 of 254. Logs: Channel workspace `desktop-page-menu/`.

## Release: desktop v0.1.111

Release commit `c0cadca`, tag `v0.1.111` (feature commits `64809f6`..`0079988`). The first tag run (`40286888805`) passed build and checks on the Mac mini but failed its upload with `TLS handshake timeout` to the GitHub API; it removed its partial draft. The rerun `40287036037` (`workflow_dispatch`, same tag) passed: 255 tests, 198 passed, 0 failed, 57 skipped (Chromium/Electron env tests), audit 0. The downloaded `Hermes-0.1.111-macOS-arm64.zip` passed its SHA-256 check; Info.plist reports 0.1.111; the executable is arm64. All 9 ASAR `dist/` runtime files are byte-identical to the verified local build; the bundles contain `desktop:find`, `desktop:search-web`, `hermes-find-current`, `background-tab` and `page-title-updated`. Plugin, mobile, Expo and Gateway are unchanged (no change under `apps/mobile` or `packages`). Evidence: Channel workspace `desktop-page-menu/release-v0.1.111/`. Rollback: reinstall v0.1.110. Real-device acceptance on Jamie's Mac is pending.
