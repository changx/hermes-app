# Hermes Desktop v0.1.32

## Authorized scope

Jamie authorized merging the Settings/multi-connection candidate into main and publishing a desktop release. Source integrates candidate `565135f` onto remote main `3a2b2fe`. The release changes root/desktop version metadata to `0.1.32` without changing dependencies or mobile/plugin code.

The detached runtime checkout and its existing uncommitted AGENTS.md edit remain untouched. Main is owned by the clean `mobile-workspace-entry` worktree; publication fast-forwards that branch owner. No Gateway/service restart or Mac installation is part of this release.

## Included behavior

- Two-column Settings: Default agent model, Font size, Shortcuts and Connections.
- Real Agent model configuration with explicit connection selection, warnings and same-target readback.
- Existing local font persistence and implemented shortcut reference.
- Independent saved connections, device pairing, confirmed removal and per-connection SDK status.
- Combined Project/recent Session sidebar and connection-qualified tab/action/draft routing.
- Explicit New Project destination, retained form through tab changes, unavailable-target rejection and same-client Project readback.
- Removal/re-add intentionally clears that connection's local drafts and queued messages. Other accounts and server conversations remain unchanged.

## Local verification

The isolated integrated release passed:

- Shared-client typecheck, build and **16 tests**, zero failures/skips.
- Desktop typecheck, build and **93 tests**, zero failures/skips, with Chromium and Linux/Xvfb native Electron enabled.
- Dependency audit: zero reported vulnerabilities.
- Candidate native tests use production views, preload and IPC with controlled SDK streams, a local HTTP pairing fixture and a test AES-GCM storage provider. They do not verify Mac Keychain or real multi-server fault recovery.

The first fresh-install desktop run hit Electron's lazy-download race (`Text file busy`) during parallel native tests. Initializing the Electron binary before an unchanged full retry passed. Both logs remain in the Channel workspace under `desktop-settings/release-*.log`.

## Publication gates

The version tag must match the desktop package version. macOS arm64 CI checks, audit, packaging and archive checksum must pass before publication. Published ZIP/ASAR contents, architecture, release version and hash must be read back after download.

The existing normal workflow previously failed only at Actions artifact upload because storage quota was exhausted. The existing source-pinned Desktop Direct Release workflow can publish the same tagged source without artifact transfer if that blocker recurs. This release does not delete existing artifacts or change billing.

The repository is private. Release downloads require an authorized GitHub login. The app is unsigned and not notarized; installation and macOS visual/keyboard/Keychain acceptance remain separate gates.

## Verified publication

- Main merge and annotated tag were pushed atomically. Immutable tagged source: `60a6251141317838496a0008d2150c7fa1416f92`.
- [Normal tag run](https://github.com/changx/hermes-app/actions/runs/37269389220) passed macOS checks, audit, packaging and archive validation, then failed only at upload because Actions storage quota was exhausted.
- [Source-pinned direct release](https://github.com/changx/hermes-app/actions/runs/37269504550) completed successfully and published [Hermes Desktop v0.1.32](https://github.com/changx/hermes-app/releases/tag/v0.1.32). No artifact deletion or billing change was used.
- Published release is neither draft nor prerelease. ZIP and checksum assets were downloaded through authenticated GitHub access. Asset names/sizes and release notes match readback.
- Downloaded ZIP integrity and SHA-256 passed: `994850db0bb722895b5e8103f85f4235734e4b82bc7e0c805ac203f14d93949f`.
- App Info.plist and ASAR package both report `0.1.32`; executable is Mach-O arm64. Published ASAR main, preload, renderer and CSS bytes exactly match the locally verified integrated build. Settings, connection management and explicit New Project destination code are present.
- Detailed evidence: Channel workspace `desktop-settings/release-0.1.32-verification.json`, `release-published.json`, `release-tag-ci.log` and `release-direct-ci.log`.
- Runtime checkout remains detached at `c39bd30`; its existing AGENTS.md diff hash remained `7631d0b9d367e9e202de2ab69928a56e9f2845c73e8f646ad4fbc16ca84b9cb2`. No service restart, mobile publication, plugin/core installation or Mac installation occurred.
