# Desktop tab and composer release v0.1.38

## Authorized scope

Jamie authorized merging `feat/desktop-tab-composer-polish` into main and publishing it ("合并主分支，发布", 2026-10-06). Candidate `bfab0ae` is based on main `c4ba924` and fast-forwards into main. Kanban card `t_cb99f559`.

Changes (details: [desktop tabs](desktop-tabs.md#session-内容宽度与输入框)):

1. Session content column has a maximum width of 768px.
2. Opening a Session focuses the composer. Focus stays in the composer after send.
3. The tab strip has no scrollbar.
4. Each tab has a context menu: Close Tab, Close Tabs to the Right, Close Other Tabs.
5. Single-line Enter sends. Multiline text needs Cmd+Enter. Shift+Enter adds a line.

Publication: desktop tag `v0.1.38` through the release workflow. Version metadata changes to `0.1.38`. The dependency graph does not change.

Not included: Expo restart (desktop-only change), plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

Desktop typecheck, build and 106/106 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. Evidence: channel workspace `desktop-tab-composer-polish/`.

## Results

- `main` moved to `05bcaeb` and was pushed atomically with annotated tag `v0.1.38`.
- The normal tag run `37483268398` passed checks, audit, packaging and archive validation, then failed only at artifact upload (Actions storage quota). The source-pinned Desktop Direct Release run `37483387708` succeeded.
- Release `v0.1.38` is not a draft or prerelease. Downloaded ZIP checksum and ZIP CRC passed. Info.plist and ASAR report `0.1.38`; executable is Mach-O arm64. Packaged main, preload, renderer script and stylesheet are byte-identical to the verified local build. Evidence: channel workspace `desktop-tab-composer-polish/release/`.
- No Expo restart, Gateway restart, plugin or core change. The app is unsigned and not notarized. macOS device checks (native tab menu, trackpad/wheel tab scrolling, composer focus feel) remain pending. Rollback: reinstall v0.1.37.
