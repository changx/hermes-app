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
