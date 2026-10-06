# Multi-connection release v0.1.36

## Authorized scope

Jamie authorized merging `feat/multi-connection` into main and publishing it ("合并主分支，发布", 2026-10-05). Source: branch commits `d06af2f` (desktop), `be76119` (mobile), `f5ac55a` (docs) on main `e6c2d57`. The release changes root/desktop version metadata to `0.1.36`.

Publication covers:

- Desktop: tag `v0.1.36` through the existing GitHub release workflow.
- Mobile: the Expo Go test entry, by updating the runtime checkout that the `hermes-app-expo` service serves.

Not included: plugin installation, Gateway restart, Hermes core change, signing, App Store distribution.

## Rollback

- Runtime checkout before the update: detached at `e6c2d5721c3d914842f68831712ea7cffe34a52a`, clean.
- Mobile rollback: check out that commit in `/opt/projects/jamie/hermes-app` and restart `hermes-app-expo`.
- On the first mobile start, the existing paired connection becomes the `primary` slot with its existing SecureStore keys. Rolling back keeps that connection working. Connections added after the update are not visible to the old version.

Verification and publication results are in the section below.

## Results

Desktop (published):
- `main` fast-forwarded to `7e16e5b` and pushed atomically with annotated tag `v0.1.36`.
- The normal tag run passed checks, audit, packaging and archive validation, then failed only at artifact upload because the Actions storage quota is exhausted (same blocker as v0.1.32). The source-pinned Desktop Direct Release run `37454930846` succeeded.
- Release `v0.1.36` is not a draft or prerelease. Downloaded ZIP checksum passed: `3b82d19f875a3f0f078d4795752cd3c40e675f3a94b1b1b094218753b036e5bd`. Info.plist and ASAR report `0.1.36`; executable is Mach-O arm64; the renderer contains the Project count code.

Mobile (published):
- First attempt: the Expo service runs Metro in CI mode, so it does not watch files. Moving the runtime checkout to `7e16e5b` without a restart made the Android bundle return HTTP 500 (new `connections.tsx` not resolved). The checkout was rolled back to `e6c2d57` at once; both bundles returned HTTP 200 again.
- With Jamie's authorization, the runtime checkout was moved to `7e16e5b` and only `hermes-app-expo` was restarted (new PID 4016948, 2026-10-06 04:20:54 PDT). Rule: a runtime checkout change needs an Expo restart in the same step.
- Public `https://agent.tuly.space` manifests and bundles: iOS 200 (12,345,871 bytes), Android 200 (12,678,273 bytes). Both bundles contain the connection index key, `Add connection`, `Pair connection`, `Create in` and the Project count description.
- Both Gateways kept their PIDs and start times (dev 3461455, Jamie 3469840). No plugin or core change. Runtime checkout is clean.
- iPhone acceptance (migration of the existing pairing, Project list, adding a second Hermes, removal) is still pending.
