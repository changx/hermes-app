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
