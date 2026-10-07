# Desktop ChatGPT-style composer release v0.1.39

## Authorized scope

Jamie authorized merging `feat/desktop-chatgpt-composer` into main and publishing it ("merge and redeploy", 2026-10-06). Candidate `1d7ef46` is based on main `d1d171c` and fast-forwards into main.

Change (details: [desktop session composer](desktop-session-composer.md#chatgpt-style-input-card-isolated-candidate)): the Session input area is a white rounded card with a borderless text line, an in-card `+` and a round black send button, copied from the ChatGPT desktop layout.

Publication: desktop tag `v0.1.39` through the release workflow. Version metadata changes to `0.1.39`. The dependency graph does not change.

Not included: Expo restart (desktop-only change), plugin installation, Gateway restart, Hermes core, signing.

## Candidate checks

Desktop typecheck, build and 106/106 tests pass with real Chromium and Linux Electron/Xvfb, 0 skipped. Evidence: channel workspace `desktop-chatgpt-composer/`.

## Results

Pending: recorded after the tag run completes.
