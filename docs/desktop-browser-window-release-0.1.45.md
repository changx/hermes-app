# Desktop browser window and Settings fixes release v0.1.45

## Authorized scope

Jamie authorized merge and redeploy of all pending changes ("merge and redeploy all changes", 2026-10-07).

Merged into main (on `1d9fc66`):
- `feat/desktop-browser-window` (`9f62f61`): browser switch between the sidebar and one separate window per Session; windows never take focus. Details: [desktop-browser-window.md](desktop-browser-window.md).
- `fix/desktop-settings-model` (`fe45390`, applied as `08d0a8a`): Settings focus follows the shown page; navigation focus rings stay inside their rows. Details: [desktop-settings.md](desktop-settings.md).

Plugin (separate repository): `hermes-app-plugin` v0.2.7 (`5c563ba`): model settings work in a multiplexed Gateway by running in the adapter's own profile scope. Installed in `hermes-app-dev`; active after Jamie restarts `hermes-gateway.service`. Not installed in other profiles.

Publication: desktop tag `v0.1.45` through the release workflow. Version metadata `0.1.45`; no dependency change. Mobile and shared client do not change; no Expo restart.

## Candidate checks (integrated tree)

- Desktop: typecheck, build and 135/135 tests with real Chromium and Linux Electron/Xvfb, 0 skipped.
- Plugin: model settings and runner binding tests 14 passed. Full `tests/p1`: the 20 failures also present on unchanged `origin/main` (test environment); one intermittent native-command test passed twice alone.

## Results

- `origin/main` and annotated tag `v0.1.45` point at `615fe43`.
- Tag run `37630089634` succeeded, including Release publication and pruning. `Hermes Desktop v0.1.45` is Latest; v0.1.44 kept.
- Downloaded `Hermes-0.1.45-macOS-arm64.zip` (130,257,740 bytes) matches its `.sha256`. `Info.plist` and `app.asar` versions are `0.1.45`; Mach-O arm64. Packaged code contains the separate browser window (`--hermes-browser-view`, `showInactive`, `browser-window.json`, "Open in separate window") and the Settings rule `.settings-nav button:focus-visible { outline-offset: -2px; }`.
- Plugin: `hermes-app-plugin` main and tag `v0.2.7` at `5c563ba` (tag only, like v0.2.6). The `hermes-app-dev` installation matches plugin main file by file. The running Gateway still has the old code until `hermes-gateway.service` restarts.
- Not done: Gateway restart (Jamie), plugin for the `jamie` profile (needs separate approval), macOS acceptance.
