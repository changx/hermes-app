# Desktop v0.1.7 / mobile table-width release

Jamie authorized merging the verified table-width candidate into main and publishing the client changes. Source candidate: `09d3277`; previous main/rollback baseline: `4a806717b1d88db462f8476fe784cec1c3ff030b` / Desktop v0.1.6.

## Included

- Desktop/mobile table outer viewports fill local available width without widening the page.
- Inner grids are at least viewport-wide; expand narrow native columns to fill unused width, retain wider readable columns and horizontal scrolling inside the table.
- No viewport-driven column squeeze or forced wrapping. Apply to Session rendering, independent table reader, full article and native fallback. See [confirmed table-width rule and candidate evidence](markdown-table-width.md).
- Root/desktop/lockfile version metadata changes to 0.1.7 only; no dependency upgrades. Mobile lockfile and dependencies are unchanged.

## Verified candidate / publication gates

Candidate checks passed: desktop 107/107 including actual Chromium, mobile 405/405, TypeScript/build, iOS/Android exports, 50 pinned Yoga geometry cases using actual component styles/dimensions. These do not substitute for native Mac/iPhone visuals, selection, rotation or horizontal gestures.

Desktop publication uses the existing private GitHub `desktop-release.yml` macOS arm64 workflow: locked install, desktop checks, dependency audit, unsigned native packaging, tag/version equality and archive checksum. After publication, download the exact ZIP/sidecar and verify packaged version, arm64 executable and final table renderer markers.

Mobile publication updates the existing Expo Go test entry `exps://agent.tuly.space`: fast-forward main, restart only `hermes-app-expo.service`, then read public iOS/Android SDK57 manifests and each exact launchAsset and verify final HTML/native table code. Reuse candidate tests/exports; do not repeat mobile dependency installation or full suite at deployment.

## Scope / evidence / rollback

No Gateway restart, plugin copy/install, Hermes core change, credentials/config change, other-profile write or Mac mini install. No signing/notarization/EAS/TestFlight/App Store release is authorized. Desktop remains an unsigned Apple Silicon macOS development build; mobile remains Expo Go, not an independent phone installer.

Before/after source commits, service PIDs/start times and development-plugin hashes plus workflow/asset/bundle evidence live privately in active-profile `workspace/hermes-app/markdown-table-container/release/`.

Rollback preserves chat data: use explicit Git revert of the table implementation commits (latest `09d3277`, then `e8d8df6`, then `0b94983` if restoring the original main rendering), with a separate version-metadata revert only if needed; restart only Expo for mobile rollback. Reinstall the intact v0.1.6 desktop ZIP if reverting the installed desktop app. Never overwrite/delete authoritative history or replace existing release assets.

Publication outcome is recorded in the private release verification after actual CI/public-asset readback; the build gates above are not a premature claim that a release exists. Physical-device post-fix acceptance remains separate.
