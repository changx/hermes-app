# Message toolbar, Thread branch and short session links — release 0.1.46

## Authorized scope

Jamie authorized merging all code and publishing it ("全部合并代码，发布", 2026-10-07):

- Hermes App plugin `changx/hermes-app-plugin` main `62aaafb`, tags `v0.2.8` (native `/branch` opens a new App Thread) and `v0.2.9` (branch with copied history, message sources, conversation export, short links).
- Client: local `main` and `origin/main` reconciled with `feat/message-toolbar` on `integrate/message-toolbar`; desktop tag `v0.1.46`; Expo test entry republished.
- Core `local/main` `8735238716` (plugin adapters opt in to `/branch` sibling threads) was already in place.

Design, decisions and limits: [Thread branch](thread-branch.md). Link format: [session links](session-links.md).

## Changes

- Shared client: `branchThread`, `messageSources`, `exportThread`, `HttpError.code`, notice kind, capability flags; short `hermesapp://session/<thread-id>` links resolved against the content's connection.
- Mobile: always-visible toolbar under final replies (Branch, Copy, References, Export, Retry on the latest reply only); tappable links in branch notices; Session options "Export conversation"; fixed a recursion when tapping ordinary web links in native inline text.
- Desktop: the same toolbar; "Export conversation" in the Session toolbar; Markdown save dialogs; short links resolved by the main process against the tab's Session.

## Activation

- Plugin 0.2.9 files are installed in hermes-app-dev. Activation needs a Gateway restart by Jamie with a stopped-state backup of `metadata.sqlite`, because the plugin rebuilds the `system_notices` table once (operator script in the private workspace `…/20261007-181114-plugin-0.2.9/activate.sh`).
- Until then the server reports no branch/sources/export capability; clients show Copy and Export only.

## Verification

Candidate `c4e59da` (= `integrate/message-toolbar`: local `main` + `origin/main` + `feat/message-toolbar`):

- `npm run client:check`: 40/40. Mobile `npm run check` and `npm test`: 133 pass, 1 skipped (Chromium table test), 0 fail. `expo export` iOS and Android: OK.
- `desktop:check` (Chrome + Electron): first run 135/136 — `browser-window-native` failed at its last CHECK ("window placement saved"); the same test also fails intermittently on untouched `origin/main` (1 of 3 runs, same CHECK). Rerun after the version bump: 136/136.
- Plugin: real-runner branch test (real GatewayRunner, HTTP API, local synthetic model) and the full `tests/p1` suite with no new failures against plugin main.

## Results (2026-10-07)

- Git: `main` `f81de79..c4e59da` pushed with tag `v0.1.46`; local runtime checkout fast-forwarded from `e8e4479`.
- Expo: `hermes-app-expo.service` restarted (PID 2127634 → 3466388, 18:14:14 PDT). Public iOS and Android manifests HTTP 200, SDK 57.0.0; launch assets 200 (12,466,161 / 12,799,601 bytes); markers `No web pages were used for this reply`, `Export conversation`, `message-toolbar` found on both. Mobile lockfile unchanged; no `npm ci`.
- Desktop: tag run 37711911497 succeeded. Release `Hermes-0.1.46-macOS-arm64.zip`: checksum OK, ZIP OK, Info.plist 0.1.46, `hermesapp` scheme, arm64 executable; ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js`, `dist/renderer/styles.css` byte-identical to the verified local build.
- Gateway untouched (PID 3315581). Plugin 0.2.9 installed, not yet active (needs the operator restart with backup).
- Evidence: channel workspace `message-toolbar-release/` (`release.log`, `m_ios.json`, `m_android.json`).
- Not yet done: plugin activation; real-device acceptance on iPhone, Android and macOS.

Rollback (client): `git revert` the merge range on `main`, then in one command `git -C /opt/projects/jamie/hermes-app checkout -q --detach <reverted sha> && systemctl --user restart hermes-app-expo.service`; the previous desktop release is `v0.1.45`.
