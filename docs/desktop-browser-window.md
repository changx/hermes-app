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

## Quit cancelled by any window; unusable window after reopen

Jamie (2026-10-13, after v0.1.81): Cmd+Q still closed the window without quitting. After reopening the window, nothing in it worked.

- Cause of the unusable window: the second quit pass (`before-quit` after drafts are saved) closed the connection service at once. Any later cancel left the app running with a closed connection. A reopened window then rendered, but a Session row click opened nothing.
- Which window cancelled the quit on Jamie's Mac is not known. Any prevented window close cancels the whole quit in Electron, for example a page's `beforeunload` in a sign-in popup.
- Fix:
  - The service, Mac control and browser control close in `will-quit`, which runs only when the quit goes ahead.
  - On that pass, helper windows (Settings, Session card, separate browser windows, popups) are destroyed, so none of them can cancel the quit. They hold no unsaved state.
  - If a quit is still cancelled and all windows then close, `window-all-closed` (which Electron skips during a real quit) quits again. A cancelled quit also resets the draft save, so the next quit saves drafts again.
  - The main window tears down its tabs and Session card in `closed`, not `close`. A cancelled close no longer leaves a window without tabs.
- Test `quit-native` (production main code with the test fixture, real clicks): a helper window that refuses to close does not stop one quit request, and the service closes only in `will-quit`; a cancelled main-window close leaves the connection open and a Session row click still opens the Session, and the next quit finishes; close and reopen still opens Sessions.
- Mac mini (Electron 44.4.5, macOS 26, same harness): before the fix, a refusing helper window left the app running with no windows and a closed service; after a cancelled main-window close, a Session row click opened nothing. After the fix, both quit requests finished, and the Session opened after the cancelled close. Close and reopen worked in both builds.
