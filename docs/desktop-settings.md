# Desktop Settings

Task: `t_810a35d8`. Candidate: `feat/desktop-settings`, based on `main` at `3a2b2fe` (desktop v0.1.31). This candidate is not published or installed on Jamie's Mac.

## Confirmed scope

The desktop Settings dialog uses left navigation and right content. The first three sections are Default agent model, Font size and Shortcuts. Connection is a separate section. Find a session remains available through the existing picker shortcut. Delete project moves to the Project editor, with the existing confirmation.

All desktop Settings entry points use the same dialog. The old font-only dialog is removed. Paired devices initially show Default agent model. Unpaired devices initially show Font size and explain why model settings are unavailable.

## Behavior

- Default agent model reads and writes the connected Agent profile through existing SDK methods. Renderer calls only narrow, trusted preload IPC methods. Credentials stay in the main process.
- Model selection changes the connected profile default across devices, not a local presentation-only choice. Running replies and conversation overrides retain existing behavior. Only configured providers appear; model names can be entered when inventory is incomplete.
- Server selection warnings require explicit confirmation. Editing the choice clears the prior warning. Save failures require a reload instead of an automatic mutation retry. The main process reads the exact target after a committed save and checks canonical provider/model consistency before reporting success.
- Main-process read and write methods check connection identity before and after requests. Renderer model components are keyed by connection identity and ignore late responses after unmount. Switching settings pages retains model drafts and warnings.
- Font size reuses the existing local 12–24 px preference, 16 px default, immediate application, restart persistence, reset and honest storage-failure feedback. The page includes live prose/code preview. It does not zoom the whole app.
- Shortcuts lists implemented keys: Enter, Shift+Enter, Cmd/Ctrl+K, Cmd/Ctrl+N/T/W, Cmd/Ctrl+Tab, Cmd/Ctrl+Shift+Tab, paste and Escape. This version does not implement custom bindings or global shortcuts. Ctrl+K now matches the Linux/Windows shortcut label; existing Cmd+K behavior remains.
- Connections is a saved-server list with Add, confirmed per-connection Remove, and real connection state. Each connection owns its client, credentials, drafts and tabs. The sidebar combines all connections without a switch-first menu. Default agent model provides explicit connection selection. See [Desktop Connections](desktop-connections.md) for behavior, storage compatibility and verification limits.
- Native HTML dialog supplies modality, Escape, focus containment and focus restoration. Arrow Up/Down and Home/End select navigation sections. Workspace overlays hide native tab/browser views using existing bounds ownership.
- Navigation and content remain side by side at tested widths. Content scrolls independently at large font sizes. Dialog geometry, controls and spacing do not scale with text size.

## Verification

Evidence directory (private Channel workspace): `/home/hermes/.hermes/profiles/hermes-app-dev/hermes-app/channels/p_6cf55361/desktop-settings/`.

- Desktop TypeScript and production main/preload/renderer build pass.
- Original Settings candidate `a726d0e`: 71 pass, 0 fail, 0 skipped with real headless Chromium and Linux/Xvfb Electron enabled. The expanded Connections candidate adds account routing, storage, cancellation and native multi-connection checks; see [Desktop Connections](desktop-connections.md). Model service tests cover native SDK calls, confirmation forwarding, explicit readback, mismatch/read failure, invalid inputs and connection replacement.
- Chromium Settings test exercises real React DOM at 1280, 930 and 600 px window widths. It covers left/right geometry, selected navigation, keyboard arrows, model load/save/warning/error/reload, incomplete inventory, local content scroll, close focus restoration and late old-connection response rejection. Model responses are controlled fixtures, not live model changes.
- Existing Chromium font regression passes cold-browser persistence, all text surfaces, unchanged geometry, DOM retention, reset and storage-failure recovery.
- Linux/Xvfb production Electron check passes. The expanded check exercises real preload/trusted IPC, model warning/confirmation/readback, native Escape, native view hide/restore and font propagation across views. Transport/model/storage data are controlled fixtures; this is not macOS device acceptance.
- The initial native checks intermittently failed an existing clipboard-thumbnail pixel assertion before reaching Settings. An unchanged retry and the expanded Settings check passed. Final test stabilization waits for the exact red pixel to paint, then keeps the original pixel assertion. No attachment production code changed. The final combined run passes; failure and retry logs remain as evidence. The right-browser native test also required updating its old Settings-close selector.
- Local macOS arm64 package builds. Mach-O architecture and ASAR Settings labels/model IPC are verified. The package is unsigned and not notarized. Packaging is not proof of Mac execution.

## Remaining gates

No real provider/default was changed during this work. Live backend model-switch acceptance and Mac visual/keyboard acceptance remain separate. No service, plugin, Hermes core, mobile app, production configuration, remote repository or published release was changed. Publishing and installation require authorization.
