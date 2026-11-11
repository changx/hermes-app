# macOS desktop automatic updates

Status: implemented on branch `feat/desktop-auto-update`; tested end to end on the Mac mini with signed test builds (see Verification). Not released yet.

Jamie (2026-11-10): "macos app 做成支持自动更新的。"

## What the user gets

- The installed app checks for a new version 1 minute after launch and then every 4 hours. After wake from sleep it checks again if the last check is more than 1 hour old.
- A new version downloads in the background. Normal checks show no dialog and no notification.
- When the download is complete, the app menu shows **Restart to Update to 0.1.N** under **About Hermes**. That item runs the normal quit sequence (sends settle, drafts and outbox saved, windows and connections close), installs the new version and opens it.
- If the user does not restart, the new version installs when Hermes quits, and the next launch opens it.
- **Check for Updates…** in the app menu checks at once and answers with a dialog: up to date, downloading, ready (with **Restart Now**), not in the Applications folder, or could not check.
- Updates work only for the app in `/Applications` or `~/Applications`. An app opened from the disk image or another folder makes no update requests; **Check for Updates…** asks the user to move it to Applications.
- The first version with this feature (the first release after v0.1.132) must be installed by hand from the DMG. Every later version arrives by itself.

## Mechanism

Electron's built-in `autoUpdater` (Squirrel.Mac), in its server mode. No third-party updater.

| Part | Where |
|---|---|
| Update state, timers, menu text and dialogs | `apps/desktop/src/main/updater.ts`, `apps/desktop/src/main/app-menu.ts` |
| App menu (Electron's default menus plus the update item) and quit integration | `apps/desktop/src/main/index.ts` |
| Feed and package routes | `services/mobile-updates/desktop.mjs`, served by the same process as the iOS updates (`server.mjs`, `hermes-app-mobile-updates.service`) |
| Publish tool | `services/mobile-updates/desktop-publish.mjs` |
| Release step | `scripts/macmini-desktop-release.sh` |
| Ingress | router `hermes-app-desktop-updates` in `services/mobile-updates/traefik/hermes-app-api.yaml`, copied to `/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-api.yaml` |

- Feed URL: `https://hermes-app-api.tuly.space/desktop-updates/darwin-arm64/<running version>`. The server answers 204 when the running version is the newest, and 200 with `{url, name, notes, pub_date, sha256, size}` when a newer version exists. It never offers an older version.
- Package URL: `https://hermes-app-api.tuly.space/desktop-updates/files/Hermes-<version>-macOS-arm64.zip`. The server sends `ETag`, `Last-Modified` and honours single `Range` requests, so Squirrel.Mac can resume an interrupted download.
- The repository is private, so the app cannot download from GitHub Releases. The update host is the existing `hermes-app-api.tuly.space`.
- Only one check runs at a time. Squirrel.Mac downloads twice if `checkForUpdates()` is called twice.
- "Restart to Update" sets a flag and calls `app.quit()`. The graceful shutdown in `before-quit` runs first; at its end the app calls `autoUpdater.quitAndInstall()` instead of `app.quit()`. If the install cannot start (error event), the app quits normally.
- `HERMES_UPDATE_FEED` (environment variable) points a test build to another feed. A package from that feed must still carry the Developer ID signature of team `4R5932XFRV`.

## Security

- Squirrel.Mac installs a downloaded app only when it satisfies the designated requirement of the running app: `identifier "com.changx.hermes.desktop" and anchor apple generic and … certificate leaf[subject.OU] = "4R5932XFRV"`. A package not signed by this team is refused, also if the server or the feed is compromised.
- Squirrel.Mac also discards a download whose SHA-256 or size differs from the feed entry (Electron 44).
- The feed is served over HTTPS. The update service is read-only and holds no signing material.
- The update zip contains the same signed, notarized and stapled `Hermes.app` as the DMG.

## Release and publication

`scripts/macmini-desktop-release.sh vX.Y.Z` does this for every release:

1. On the Mac mini, after the DMG: `ditto -c -k --sequesterRsrc --keepParent Hermes.app Hermes-<version>-macOS-arm64.zip`. The script unpacks the zip into a temporary folder and runs `codesign --verify --deep --strict`, `stapler validate` and `spctl --type execute` (`source=Notarized Developer ID`) on the unpacked app. A failed check stops the release.
2. Both files and their `.sha256` come back to this host (about 2 × 9 minutes over the Cloudflare Access link).
3. The GitHub Release is published with only the DMG and its `.sha256`, as before. The zip is not a Release download.
4. Then `desktop-publish.mjs publish` copies the zip into the update store, checks it against its `.sha256`, and makes it the current version. Installed apps see the new version from this moment.
5. `desktop-publish.mjs prune --keep 2` deletes older update zips. The records stay.
6. The script checks that the public feed answers 200 for version `0.0.0`.

Store: `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/mobile-updates/store/desktop/` (`files/`, `current/darwin-arm64.json`, `releases/darwin-arm64/<version>.json`).

Manual commands:

```bash
export PATH=/home/hermes/.asdf/installs/nodejs/24.14.1/bin:$PATH
S=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/mobile-updates/store
node services/mobile-updates/desktop-publish.mjs list --store $S
node services/mobile-updates/desktop-publish.mjs publish --store $S --zip tmp/release/vX.Y.Z/Hermes-X.Y.Z-macOS-arm64.zip --sha256-file tmp/release/vX.Y.Z/Hermes-X.Y.Z-macOS-arm64.zip.sha256
```

## Rollback

- The client never downgrades. To replace a bad version, release a new, higher version with the fix (or with a revert).
- To stop distribution of a bad version before most apps take it: publish the fixed higher version. Apps that already installed the bad version update to the fix at their next check.
- Users can always install an older DMG from the Releases page by hand.

## Deployment of the server part (one time)

1. Copy `services/mobile-updates/server.mjs`, `lib.mjs` and `desktop.mjs` to `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/mobile-updates/service/`. Keep the old copy for rollback.
2. Restart `hermes-app-mobile-updates.service`. Check `/mobile-updates/health` and the iOS manifest (204 or the current update) again.
3. Add the `hermes-app-desktop-updates` router to `/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-api.yaml` (Traefik reads the folder). Check `https://hermes-app-api.tuly.space/desktop-updates/health` (200) and `/desktop-updates/darwin-arm64/0.1.132` (204 before the first publication).

## Verification

- `node --test services/mobile-updates/tests/*.test.mjs`: 15 tests (desktop: feed 204/200, never older, invalid platform/version, whole file, ranges, `If-Range`, 416, HEAD, path traversal, publish refusals, SHA-256 mismatch, prune; the iOS tests unchanged).
- `apps/desktop/tests/auto-update.test.mjs`: 8 tests (unsupported cases, timer plan, one check at a time, manual check answers, error retry, wake check, menu text and dialogs without technical words, menu roles and quit order).
- End to end on the Mac mini (2026-11-10, commit `637ff67`). Three builds of the same code, signed with the Developer ID identity but not notarized (test only), versions 0.1.133, 0.1.134 and 0.1.135; a local feed (`server.mjs` on 127.0.0.1:8091) with the real publish tool; the app installed in `~/Applications`, opened with `HERMES_UPDATE_FEED`:
  1. 0.1.133 asked the feed 60 s after launch, downloaded 0.1.134 (134 MB) and Squirrel.Mac staged it (`ShipItState.plist`, `launchAfterInstallation = false`). After a normal quit (SIGTERM, graceful shutdown), ShipIt installed it: `Installation completed successfully`; `CFBundleShortVersionString` 0.1.134; `codesign --verify --deep --strict` OK.
  2. 0.1.134 downloaded 0.1.135. The app menu read `About Hermes`, `Restart to Update to 0.1.135`, `Services`, `Hide Hermes`, `Hide Others`, `Show All`, `Quit Hermes`; the menu bar `Hermes, File, Edit, View, Window`. Clicking the item (its `click()` through the Node inspector, because the Mac mini has no foreground session for Cua Driver) ran all four shutdown steps (`sendsSettled: true`, `clean: true`), ShipIt installed 0.1.135 and opened it 3 s later.
  3. 0.1.135 against the same feed: one request, 204; the menu shows `Check for Updates…`.
  4. 0.1.133 opened from a folder outside Applications: no feed request in 70 s.
  - Logs: `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/desktop-auto-update/20261110-macmini-e2e/`. The test app, caches, ShipIt job and the test build folder were removed; the Mac mini's earlier `~/Library/Application Support/Hermes` folder was moved aside for the test and restored.
- Open: the public feed after the server deployment; Jamie's Mac: install the first version with updates from the DMG, then receive the next release by itself.
