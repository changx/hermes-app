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

- `main` moved from local `f22c05a` and remote `9e9a0ae` to `d0f4178` and was pushed atomically with annotated tag `v0.1.42`.
- Tag run [37616557894](https://github.com/changx/hermes-app/actions/runs/37616557894) passed checks, audit, packaging, archive validation, publication and **Remove older releases**.
- Release `v0.1.42` is not a draft or prerelease. The downloaded ZIP passed the sidecar SHA-256 check. Info.plist and ASAR report `0.1.42`; the executable is Mach-O arm64; the ASAR contains `dist/preload/browser-page.cjs`, and the main process contains the `/v1/desktop-browser` control connection. Retention keeps v0.1.42 and v0.1.41.
- Mobile: only `hermes-app-expo` restarted (PID 1909875 → 2127634). Public iOS and Android manifests return HTTP 200 with SDK 57.0.0; each exact `launchAsset` returns HTTP 200 and contains the merged shared-client code.
- Plugin `v0.2.6`: on `hermes-app-plugin` main `f2b41e5` with tag `v0.2.6`, installed in `hermes-app-dev` (rollback copy and hashes in the private workspace). Gateway not restarted (PID 1305834 unchanged); the plugin takes effect after Jamie restarts `hermes-gateway.service`.
- Evidence: channel workspace `desktop-browser-control/release/`.
- Pending: macOS device acceptance of Agent browser control (design document section 12). The app is unsigned and not notarized. Rollback: reinstall v0.1.41; plugin rollback copy restores v0.2.5.
