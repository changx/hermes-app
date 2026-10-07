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

Pending.
