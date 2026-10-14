# Desktop browser: built-in sidebar or separate windows

Status: implemented on branch `feat/desktop-browser-window`, verified on Linux/Xvfb. macOS acceptance is pending.

## Confirmed requirements (Jamie, 2026-10-07)

- The built-in browser can be a separate window. A switch moves it between the sidebar and separate windows.
- Each Session has its own separate window.
- A separate window never takes focus.

## Behavior

- The switch is a button in the browser toolbar: "Open in separate window" in the sidebar, "Show in sidebar" in a window. The choice is saved on this device (`browser-window.json` in the app data folder) and applies to all Sessions.
- Switching moves the open pages. The same page object moves between windows, so nothing reloads. Page state, history, logins and Agent control are kept.
- Window mode: every Session with an open browser has its own window. The main window shows no browser sidebar; the conversation uses the full width. The tab strip button "Browser" opens or closes the active Session's window.
- New windows are shown with `showInactive()`. Agent actions, attachment previews and links open or update a window without focusing it.
- Closing a window (close button or Cmd/Ctrl+W in it) closes that Session's browser, like the sidebar's close button. The conversation tab stays. Workspace shortcuts do not act from a separate window.
- The last window size and position are saved. More windows cascade by 28px and stay on a screen.
- The window title is the page title. Sign-in popups use the Session's window as parent. Handoff requests flash the window that holds the page.
- A focused separate window counts as the user's current Session for Agent device selection.

## Security

- The window's toolbar is a separate renderer with the standard preload. It receives only its own browser state, no conversation data.
- Its IPC is limited to snapshot, open address, bounds, back/forward/reload/stop/close, Agent control buttons and the mode switch. Every other channel is refused. Actions always target the window's own Session.
- Web pages keep the existing isolation (separate partition per Project, no app API).

## Verification

- `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 xvfb-run -a npm run desktop:check`: 134 passed, 0 skipped.
- New Electron test `browser-window-native` (production main/preload/renderers, fixture transport): switch in both directions from the real toolbar buttons, same page object, no network reload, live page and form state and history kept, no focus taken by either window, one window per Session, cascade, toolbar Back acts on its own Session while another tab is active, Agent snapshot and screenshot in a window, refused non-browser IPC, no conversation content in the window, Ctrl+W and window close release only that browser, remembered size, saved mode. Stable in three runs.
- Not verified: macOS window focus and Spaces/full-screen behavior, real pointer feel. Linux/Xvfb focus checks are not macOS proof.

## Quit with a browser window open

Jamie (2026-10-13): one Cmd+Q, or one click on Quit Hermes in the app menu, closed the windows but did not quit the app. A second request quit it.

- Cause: the browser window's `close` handler called `event.preventDefault()` and then destroyed the window itself. On macOS, quit closes the newest window first, which is the browser window. Electron treats a prevented close as a cancelled quit (`Browser::OnWindowCloseCancelled`), so the other windows still closed but `will-quit` never came. On macOS, `window-all-closed` does not quit the app.
- Linux hides the defect: quit closes the main window first, which removes the browser windows, and `window-all-closed` quits again.
- Fix: the browser window's `close` handler no longer prevents the close. It detaches the page view and releases the Session's browser, and the window closes normally. Ctrl+W in the window and the close button behave as before.
- Test: `browser-window-native` checks that a browser window close is not prevented, and that one `app.quit()` with a separate browser window open reaches `will-quit` without `window-all-closed`. Without the fix, the close check fails.
- Mac mini (Electron 44.4.5, macOS 26, production main code with the test fixture, one `app.quit()`): before the fix, the browser window close was prevented, all windows closed, and the app stayed running with no windows. After the fix, `will-quit` came 222 ms after the quit request. With the browser in the sidebar and no separate window, the app quit at once before the fix too.

Release v0.1.81 (2026-10-13, authorized by Jamie: "合并发布"): fix `04bd4c1`, release commit `ac57dc7`, tag `v0.1.81`. Candidate `desktop:check` on Linux with Chromium and Electron/Xvfb: 196 passed, 0 failed. Mac mini workflow run `38501624124`: 196 tests, 148 pass, 0 fail, 48 skipped; `npm audit` 0 vulnerabilities. The downloaded zip passes its `.sha256` check; Info.plist shows 0.1.81. The ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `dist/renderer/styles.css` are byte-identical to the local build, and the browser window `close` handler in the package has no `preventDefault`. Releases kept: v0.1.81 and v0.1.80. No mobile, plugin, Expo or Gateway change. Quit on Jamie's Mac is not checked yet.

## Graceful shutdown

Jamie (2026-10-13, after v0.1.82): Cmd+Q still closed the window without quitting, and after reopening, nothing in the window worked. Jamie then asked for a graceful shutdown.

Cause of the unusable window: the old quit code closed the connection service when the quit started. If any window then refused to close (Electron cancels the whole quit then), the app kept running with a closed connection. A reopened window rendered, but a Session row click opened nothing. Which window refused on Jamie's Mac is not known; any refusing window or page `beforeunload` (for example a sign-in popup) has this effect.

The app now runs one ordered quit sequence (`src/main/shutdown.ts`, called from `before-quit` in `src/main/index.ts`) for every quit request: Cmd+Q, the app menu, and macOS logout or restart. Electron's own window closing on quit is not used. Steps, each with a time limit:
1. Stop new work (1 s): Agent browser control and Mac control stop; no new outbox send starts. A message sent now stays in the durable outbox and is sent after the next start.
2. Settle and save (sends up to 3 s): sends already in progress finish; queued draft, outbox and credential writes complete.
3. Close windows the normal way: helper windows first (Settings, Session card, separate browser windows, popups; limit 1.5 s), then the main window with its tabs and pages (limit 2 s). Pages get their unload events. A page's "leave this page?" refusal is ignored during quit (`will-prevent-unload`). A window still open at its limit is destroyed.
4. Close connections: the Hermes live connections and the browser-control connection close, and the app waits up to 1 s for their WebSocket close handshakes (`src/main/socket-registry.ts`).
5. Quit. With no windows left, nothing can cancel it.

While the sequence runs, no window is reopened (Dock click, session links). The main window tears down its tabs and Session card in `closed`, not `close`, so a refused close leaves working tabs. The main process prints one `[shutdown]` line with each step's time and outcome; it has no user content.

Tests:
- `quit-native` (production main code with the test fixture, Electron/Xvfb, real clicks): a helper window that refuses to close is destroyed at its limit and the quit finishes; a popup page with `beforeunload` closes at once; a send in progress finishes before the connection closes; a main window that refuses once is destroyed at its limit and the quit finishes; close and reopen still opens Sessions. With the `beforeunload` handling or the send settling removed, the matching check fails.
- `shutdown` (unit): steps run in order, a slow step is abandoned at its limit, a failing step does not stop the rest; the socket wait follows real local WebSocket close handshakes and reports a socket that does not close.
- Mac mini (Electron 44.4.5, macOS 26, same harness as `quit-native`): a send in progress finished 777 ms after the quit request, then the windows closed, then the connection; the `beforeunload` popup closed after 69 ms; a refusing main window was destroyed at 2 s and the quit finished; close and reopen worked. The old code on the same harness left the app running with a closed connection, and a Session row click opened nothing.
- Not verified: a real WebSocket close against the Hermes server on Jamie's Mac; the fixture has no live socket.

Release v0.1.83 (2026-10-13, authorized by Jamie: "合并发布"): fixes `a691f4e` and `496c55a`, release commit `802762e`, tag `v0.1.83`. Candidate `desktop:check` on Linux with Chromium and Electron/Xvfb: 199 passed, 0 failed. Mac mini workflow run `38509252342`: 199 tests, 150 pass, 0 fail, 49 skipped; `npm audit` 0 vulnerabilities. The downloaded zip passes its `.sha256` check (`298dc41e…7b55`); Info.plist shows 0.1.83. The ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `dist/renderer/styles.css` are byte-identical to the local build. Releases kept: v0.1.83 and v0.1.82. No mobile, plugin, Expo or Gateway change. Quit on Jamie's Mac is not checked yet.
