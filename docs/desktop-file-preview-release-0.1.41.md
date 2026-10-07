# Desktop file preview release v0.1.41

## Authorized scope

Jamie authorized merging the file preview work into main and publishing it ("合并主分支，发布", 2026-10-07). Kanban `t_073d55bc`. Details: [In-app file preview](file-preview.md).

Desktop commits from `feat/file-preview`, applied on main `dd2c020`:
- `8cfeebf` (was `f491975`): the built-in PDF viewer may load its `chrome://resources` files, so PDF pages render instead of a grey pane.
- `f642a02` (was `36acdb7`): Markdown renders as static HTML without scripts; video and audio play, with `Range` seeking.
- `7fd8ec6` (was `dc387b9`): requirement and feature document.

Publication: desktop tag `v0.1.41` through the release workflow. Version metadata changes to `0.1.41`. The desktop dependency graph does not change.

The mobile part of the same work was published separately to the Expo Go test entry from the local runtime checkout (`dc387b9`). Evidence: channel workspace `file-preview/release.log`.

Not included: plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

On this release line: desktop typecheck, build and 111/111 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. The native test checks a rendered PDF page (attachment and `https`), rendered Markdown without scripts, H.264 video metadata and a seek through `Range`, and WAV audio metadata.

## Results

- `main` moved to `c8ed4d6` and was pushed atomically with annotated tag `v0.1.41`.
- Tag run [37596973466](https://github.com/changx/hermes-app/actions/runs/37596973466) passed checks, audit, packaging, archive validation, publication and **Remove older releases**.
- Release `v0.1.41` is not a draft or prerelease. The downloaded ZIP passed the sidecar SHA-256 check (`3eb97d413c5e49e941a232530583c80e15ae4501bf688a86aa1c3f975e2378a5`) and the ZIP CRC check. Info.plist and ASAR report `0.1.41`, and the executable is Mach-O arm64. Packaged main, preload, renderer script, HTML and stylesheet are byte-identical to the verified local build. Retention now keeps v0.1.41 and v0.1.40. Evidence: channel workspace `file-preview/desktop-release/`.
- Mobile: published to the Expo Go test entry (only `hermes-app-expo` restarted; public iOS/Android manifests and bundles HTTP 200, SDK 57).
- No Gateway restart, plugin or core change. The app is unsigned and not notarized. macOS checks of each file type remain pending. Rollback: reinstall v0.1.40.
