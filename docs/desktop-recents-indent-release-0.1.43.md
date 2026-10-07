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

Pending.
