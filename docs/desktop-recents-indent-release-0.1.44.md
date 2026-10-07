# Desktop Recents indent fix release v0.1.44

## Authorized scope

Jamie reported that v0.1.43 indented Recents two steps ("缩进一档就够，你这是两档了", 2026-10-07). This corrects the v0.1.43 change under the same merge-and-redeploy request.

Change: Recents titles sit 17px right of the Recents label, the same step as Session titles under a Project name (v0.1.43: 33px). The guide line stays. CSS and its test only. Details: [Desktop tree navigation](desktop/tree-navigation.md).

Publication: desktop tag `v0.1.44` through the release workflow; version metadata `0.1.44`; no dependency change. Mobile, shared client, plugin and Gateway do not change.

## Candidate checks

- Chromium measurement: Recents step 17px, Project step 17px.
- Desktop: typecheck, build and 133/133 tests with real Chromium and Linux Electron/Xvfb, 0 skipped. The first full run in the fresh worktree failed two Electron tests with `Text file busy` (Electron binary setup race); the rerun passed.

## Results

- `origin/main` and annotated tag `v0.1.44` point at `410fb96` (fix `fix/desktop-recents-indent-one`, fast-forward).
- Tag run `37626504389` succeeded, including Release publication and pruning. `Hermes Desktop v0.1.44` is Latest; v0.1.43 kept.
- Downloaded `Hermes-0.1.44-macOS-arm64.zip` (130,254,657 bytes) matches its `.sha256`. `Info.plist` and `app.asar` versions are `0.1.44`. Packaged CSS: `.recent-list { margin: 0 0 6px 12px; padding-left: 6px; ... }`.
- No Expo, Gateway or plugin change. macOS install and visual acceptance remain with Jamie.
