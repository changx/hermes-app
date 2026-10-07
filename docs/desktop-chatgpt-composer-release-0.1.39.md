# Desktop ChatGPT-style composer release v0.1.39

## Authorized scope

Jamie authorized merging `feat/desktop-chatgpt-composer` into main and publishing it ("merge and redeploy", 2026-10-06). Candidate `1d7ef46` is based on main `d1d171c` and fast-forwards into main.

Change (details: [desktop session composer](desktop-session-composer.md#chatgpt-style-input-card-isolated-candidate)): the Session input area is a white rounded card with a borderless text line, an in-card `+` and a round black send button, copied from the ChatGPT desktop layout.

Publication: desktop tag `v0.1.39` through the release workflow. Version metadata changes to `0.1.39`. The dependency graph does not change.

Not included: Expo restart (desktop-only change), plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

Desktop typecheck, build and 106/106 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. Evidence: channel workspace `desktop-chatgpt-composer/`.

## Results

- `main` moved to `cd8aca7` and was pushed atomically with annotated tag `v0.1.39`.
- Tag run [37566102231](https://github.com/changx/hermes-app/actions/runs/37566102231) passed checks, audit, packaging, archive validation and **Publish GitHub Release**. Main run `37566102219` passed.
- The tag run then failed at **Remove older releases**: `scripts/prune-releases.sh` used `mapfile`, which macOS Bash 3.2 does not have. This was the first tag run of that step. The fix replaces `mapfile` and array slices with a `while read` loop. A stub `gh` test passed on local Bash 5.2 and on macOS `/bin/bash` 3.2.57 (Mac mini). Then the script was run once by hand with the real `gh`, as the retention policy specifies.
- Release `v0.1.39` is not a draft or prerelease. The downloaded ZIP passed the sidecar SHA-256 check and the ZIP CRC check. Info.plist and ASAR report `0.1.39`, and the executable is Mach-O arm64. Packaged main, preload, renderer script, HTML and stylesheet are byte-identical to the verified local build. Evidence: channel workspace `desktop-chatgpt-composer/release/`.
- No Expo restart, Gateway restart, plugin or core change. The app is unsigned and not notarized. Installed macOS visual and keyboard checks remain pending. Rollback: reinstall v0.1.38.
