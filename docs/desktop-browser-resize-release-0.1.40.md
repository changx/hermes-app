# Desktop preview sidebar resize release v0.1.40

## Authorized scope

Jamie authorized merging `feat/desktop-browser-resize` into main and publishing it ("merge and redeploy", 2026-10-06). Candidate `0433277` is based on main `ecc25be` and fast-forwards into main.

Change (details: [desktop tabs](desktop-tabs.md#右侧预览栏宽度)): drag the left edge of the right preview (Browser) sidebar to change its width. The width is saved locally; a double click returns to the automatic width.

Publication: desktop tag `v0.1.40` through the release workflow. Version metadata changes to `0.1.40`. The dependency graph does not change.

Not included: Expo restart (desktop-only change), plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

Desktop typecheck, build and 108/108 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. The native preview-resize test passed 5 consecutive runs. Evidence: channel workspace `desktop-browser-resize/`.

## Results

- `main` moved to `fc7bce1` and was pushed atomically with annotated tag `v0.1.40`.
- Tag run [37567200960](https://github.com/changx/hermes-app/actions/runs/37567200960) passed checks, audit, packaging, archive validation, publication and **Remove older releases**. That last step is the Bash 3.2 fix from v0.1.39, and this is its first successful run in CI. Main CI for the previous head `ecc25be` passed.
- Release `v0.1.40` is not a draft or prerelease. The downloaded ZIP passed the sidecar SHA-256 check (`dabcbd21ec41a06f8f44664b7aa8825a3e4f526bb5825230b4f4ea24b13e5717`) and the ZIP CRC check. Info.plist and ASAR report `0.1.40`, and the executable is Mach-O arm64. Packaged main, preload, renderer script, HTML and stylesheet are byte-identical to the verified local build. Retention now keeps v0.1.40 and v0.1.39. Evidence: channel workspace `desktop-browser-resize/release/`.
- No Expo restart, Gateway restart, plugin or core change. The app is unsigned and not notarized. macOS drag feel and the 6px strip appearance remain pending. Rollback: reinstall v0.1.39.
