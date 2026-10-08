# Desktop Recents indent release v0.1.43

## Authorized scope

Jamie authorized merge and redeploy ("merge and redeploy", 2026-10-07).

Merged into main: `fix/desktop-recents-indent` (`aec29d0`), fast-forward on `a1ea972`. Recents rows are indented one level, with the same inset and guide line as Sessions under a Project. Details: [Desktop tree navigation](desktop/tree-navigation.md).

Publication:
- Desktop tag `v0.1.43` through the release workflow. Version metadata changes to `0.1.43`. The dependency graph does not change.
- Mobile, shared client, plugin and Gateway do not change. No Expo or Gateway restart.

## Candidate checks

- Desktop: typecheck, build and 133/133 tests with real Chromium and Linux Electron/Xvfb, 0 skipped. Two built-in browser Electron tests failed once in a full run; they passed alone (with and without the change) and in the full rerun.

## Results

- `origin/main` fast-forwarded to `9af8aba` (release commit on `aec29d0`). Annotated tag `v0.1.43` points at `9af8aba`.
- Tag workflow run `37622207003` (Desktop Build and Release, event push, ref `v0.1.43`) succeeded: desktop checks, audit, unsigned macOS package, archive verification, Release publication and pruning.
- Release `Hermes Desktop v0.1.43` is Latest; v0.1.42 is kept, older Releases pruned. Asset `Hermes-0.1.43-macOS-arm64.zip` (130,254,655 bytes) matches its `.sha256` file.
- Downloaded archive: `Info.plist` version `0.1.43`, `app.asar` package version `0.1.43`, Mach-O arm64 executable, renderer CSS contains the new `.recent-list` rule.
- No Expo, Gateway or plugin change. Unsigned build; macOS install and visual acceptance remain with Jamie.
