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
