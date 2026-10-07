# Desktop preview sidebar resize release v0.1.40

## Authorized scope

Jamie authorized merging `feat/desktop-browser-resize` into main and publishing it ("merge and redeploy", 2026-10-06). Candidate `0433277` is based on main `ecc25be` and fast-forwards into main.

Change (details: [desktop tabs](desktop-tabs.md#右侧预览栏宽度)): drag the left edge of the right preview (Browser) sidebar to change its width. The width is saved locally; a double click returns to the automatic width.

Publication: desktop tag `v0.1.40` through the release workflow. Version metadata changes to `0.1.40`. The dependency graph does not change.

Not included: Expo restart (desktop-only change), plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

Desktop typecheck, build and 108/108 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. The native preview-resize test passed 5 consecutive runs. Evidence: channel workspace `desktop-browser-resize/`.

## Results

Pending: recorded after the tag run completes.
