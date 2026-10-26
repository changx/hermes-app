# Desktop Settings

Initial candidate: `feat/desktop-settings`, based on `main` at `3a2b2fe` (desktop v0.1.31). Published as [Desktop v0.1.32](desktop-release-0.1.32.md). Not installed on Jamie's Mac.

## Confirmed scope

> Superseded structure: Settings is now grouped by where a setting takes effect, and the model moved to each connection's page. See [Unified Settings](unified-settings.md).

The desktop Settings dialog uses left navigation and right content. The first three sections are Default agent model, Font size and Shortcuts. Connection is a separate section. Find a session remains available through the existing picker shortcut. Delete project moves to the Project editor, with the existing confirmation.

All desktop Settings entry points use the same dialog. The old font-only dialog is removed. Paired devices initially show Default agent model. Unpaired devices initially show Font size and explain why model settings are unavailable.

## Behavior

- Default agent model reads and writes the connected Agent profile through existing SDK methods. Renderer calls only narrow, trusted preload IPC methods. Credentials stay in the main process.
- Model selection changes the connected profile default across devices, not a local presentation-only choice. Running replies and conversation overrides retain existing behavior. Only configured providers appear; model names can be entered when inventory is incomplete.
- Server selection warnings require explicit confirmation. Editing the choice clears the prior warning. Save failures require a reload instead of an automatic mutation retry. The main process reads the exact target after a committed save and checks canonical provider/model consistency before reporting success.
- Main-process read and write methods check connection identity before and after requests. Renderer model components are keyed by connection identity and ignore late responses after unmount. Switching settings pages retains model drafts and warnings.
- Font size reuses the existing local 12–24 px preference, 16 px default, immediate application, restart persistence, reset and honest storage-failure feedback. The page includes live prose/code preview. It does not zoom the whole app.
- Shortcuts lists implemented keys: Enter, Shift+Enter, Cmd/Ctrl+K, Cmd/Ctrl+N/T/W, Cmd/Ctrl+Tab, Cmd/Ctrl+Shift+Tab, Cmd/Ctrl+B (show or hide sidebar), paste and Escape. This version does not implement custom bindings or global shortcuts. Ctrl+K now matches the Linux/Windows shortcut label; existing Cmd+K behavior remains.
- Connections is a saved-server list with Add, confirmed per-connection Remove, and real connection state. Each connection owns its client, credentials, drafts and tabs. The sidebar combines all connections without a switch-first menu. Default agent model provides explicit connection selection. See [Desktop Connections](desktop-connections.md) for behavior, storage compatibility and verification limits.
- Settings opens in a separate, single-instance native window (since v0.1.34). The Settings button and Cmd/Ctrl+, open or focus it. Escape and Cmd/Ctrl+W close only Settings. The workspace window is never hidden or covered: Session and preview views stay visible and usable, with their reading position, drafts and attachments.
- Earlier versions rendered Settings as an in-page HTML dialog. Native Session/preview views sit above page HTML, so that dialog had to hide them and the background went blank. The separate window removes the cause instead of covering it.
- The Settings window receives connection state only; Project, Session, message and browser data are stripped from its snapshots. Its sender may call only snapshot, model and connection-management IPC. Every other workspace, Session, browser and attachment action rejects it.
- Font size is stored in shared local storage, so a change applies immediately to the workspace and every open Session view. The last selected Settings section is remembered for the next open.
- Arrow Up/Down and Home/End select navigation sections. Navigation and content remain side by side at tested widths. Content scrolls independently at large font sizes. Geometry, controls and spacing do not scale with text size.

## Verification

Evidence directory (private Channel workspace): `/home/hermes/.hermes/profiles/hermes-app-dev/hermes-app/channels/p_6cf55361/desktop-settings/`.

- Desktop TypeScript and production main/preload/renderer build pass.
- Original Settings candidate `a726d0e`: 71 pass, 0 fail, 0 skipped with real headless Chromium and Linux/Xvfb Electron enabled. The expanded Connections candidate adds account routing, storage, cancellation and native multi-connection checks; see [Desktop Connections](desktop-connections.md). Model service tests cover native SDK calls, confirmation forwarding, explicit readback, mismatch/read failure, invalid inputs and connection replacement.
- Chromium Settings test exercises real React DOM at 1280, 930 and 600 px window widths. It covers left/right geometry, selected navigation, keyboard arrows, model load/save/warning/error/reload, incomplete inventory, local content scroll, close focus restoration and late old-connection response rejection. Model responses are controlled fixtures, not live model changes.
- Existing Chromium font regression passes cold-browser persistence, all text surfaces, unchanged geometry, DOM retention, reset and storage-failure recovery.
- Linux/Xvfb production Electron check passes. The expanded check exercises real preload/trusted IPC, model warning/confirmation/readback, native Escape, native view hide/restore and font propagation across views. Transport/model/storage data are controlled fixtures; this is not macOS device acceptance.
- The initial native checks intermittently failed an existing clipboard-thumbnail pixel assertion before reaching Settings. An unchanged retry and the expanded Settings check passed. Final test stabilization waits for the exact red pixel to paint, then keeps the original pixel assertion. No attachment production code changed. The final combined run passes; failure and retry logs remain as evidence. The right-browser native test also required updating its old Settings-close selector.
- Local macOS arm64 package builds. Mach-O architecture and ASAR Settings labels/model IPC are verified. The package is unsigned and not notarized. Packaging is not proof of Mac execution.

## Settings window verification (v0.1.34)

- Linux/Xvfb production Electron: Settings opens as a second native window; a second click focuses the same window. Session and preview views stay visible and active while it is open. Ctrl+W and Escape close only Settings; no workspace tab closes. Ctrl+, reopens it. The Session keeps its WebContents identity, DOM, draft text and preview after close.
- The Settings sender is rejected for `newTab` and `sendMessage`. The Settings DOM contains no workspace or message content.
- Model warning, confirmation and readback, font propagation to the workspace and an open Session view, and connection add/list/status/remove all run through the separate window with production preload and IPC.
- Chromium: the two-column page at 1280, 930 and 600 px, keyboard navigation, remembered section, and font changes while the conversation stays rendered.
- Full desktop check: 94 pass, 0 fail, 0 skipped, in consecutive full runs. Evidence: `window-check-2.log`, `window-check-3.log` and `window-evidence/desktop-settings.png` in the Channel workspace. The first run (`window-check-1.log`) found two test-script errors, which were then fixed, and one native paste timeout. That test then passed three separate runs and two full runs without code change; unchanged main also passed it twice.
- Mac window behavior, keyboard and visual acceptance remain unverified; Linux/Xvfb is not macOS.

## Remaining gates

No real provider/default was changed during this work. Live backend model-switch acceptance and Mac visual/keyboard acceptance remain separate. Candidate development did not change a service, plugin, Hermes core, mobile app or production configuration. Jamie subsequently authorized the main merge and desktop publication; verified release evidence is recorded in [Desktop v0.1.32](desktop-release-0.1.32.md). Mac installation remains unperformed.

## Settings focus overlap fix

- Symptom: on open, "All connections" partly covered the row below it.
- Cause: the window first renders an empty snapshot, so focus went to "All connections". When the real snapshot arrived, the page switched to the current connection, but focus stayed on the old tab. Its focus ring (`outline-offset: 2px`) reached over the next row (rows are 2px apart).
- Fix: until the user chooses a page, focus follows the page actually shown. Navigation focus rings are drawn inside the row (`outline-offset: -2px`).
- Test: `settings-focus` (Chromium) renders the empty snapshot, then the real one, and checks focus, overlap of every row's ring, and that a user choice keeps focus. It failed before the fix.

## Model settings in a multiplexed Gateway

"Could not load model settings" came from the server: plugin v0.2.6 refused model reads/writes (HTTP 503) when one Gateway serves several profiles. Plugin v0.2.7 runs them inside core's profile scope for the adapter's own home. No desktop change.
