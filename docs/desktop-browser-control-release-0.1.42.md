# Desktop browser control release v0.1.42

## Authorized scope

Jamie authorized merging everything into main and publishing it ("全都合并主分支，发布", 2026-10-07). Details: [Desktop built-in browser: Agent control](desktop-browser-control.md).

Merged into main:
- `origin/main` (`9e9a0ae`: desktop v0.1.37–v0.1.41, floating Session toolbar, Recents). Local `main` and `origin/main` had diverged by 20 commits each; three pairs were the same change with different IDs. Two document conflicts were resolved by keeping the new text without Kanban card IDs, matching the earlier card-ID removal on local main.
- `feat/desktop-browser-control` (`742e6d3` design, `a87d907` implementation).

Publication:
- Desktop tag `v0.1.42` through the release workflow. Version metadata changes to `0.1.42`. The dependency graph does not change.
- Mobile: the merge changes the shared client (`packages/client`, workspace API from the desktop line), so the Expo Go test entry is republished from the runtime checkout. Only `hermes-app-expo` restarts.
- Plugin `v0.2.6` (repository `hermes-app-plugin`, `f2b41e5`) is on its main and tagged. It is installed in the `hermes-app-dev` profile. It takes effect after Jamie restarts `hermes-gateway.service` (the multiplexed Gateway that now serves `hermes-app-dev`).

Not included: Hermes core, signing, notarization, other profiles' plugins.

## Candidate checks (integration worktree, merge result)

- Shared client check: 34/34.
- Desktop: typecheck, build and 133/133 tests with real Chromium and Linux Electron/Xvfb, 0 skipped.
- Mobile: TypeScript check, 124 tests pass (1 skipped), iOS and Android exports succeed.
- Plugin: full `tests/p1` 141 passed, 2 skipped.

## Results

Pending.
