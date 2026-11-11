# macOS desktop automatic updates

Status: released in desktop v0.1.133 (2026-11-10). Download with progress and visible result released in v0.1.135 (2026-11-11). Open: Jamie's Mac (see Release: desktop v0.1.135).

Jamie (2026-11-10): "macos app 做成支持自动更新的。"

## What the user gets

- The installed app checks for a new version 1 minute after launch and then every 4 hours. After wake from sleep it checks again if the last check is more than 1 hour old.
- A new version downloads in the background. A normal check shows no dialog. During the download the Dock icon shows a progress bar and the app menu item under **About Hermes** reads **Downloading Update 0.1.N… 42%**. Then **Preparing Update…** while macOS checks the signature.
- When the update is ready, a system notification says so (a click restarts Hermes into the new version). When a download fails, a notification names the problem; the menu item reads **Update Failed – Try Again**. Each notice shows once per version and app run.
- A download that receives no data for 60 seconds stops with a failure. The next try (in 15 minutes, or at once with **Update Failed – Try Again**) continues from the received bytes.
- When the download is complete, the app menu shows **Restart to Update to 0.1.N** under **About Hermes**. That item runs the normal quit sequence (sends settle, drafts and outbox saved, windows and connections close), installs the new version and opens it.
- If the user does not restart, the new version installs when Hermes quits, and the next launch opens it.
- **Check for Updates…** in the app menu checks at once and answers with a dialog: up to date, downloading (with the percentage), preparing, ready (with **Restart Now**), not in the Applications folder, could not check, could not download, damaged download, or could not install.
- Every step and failure is written to `~/Library/Application Support/Hermes/logs/update.log` (no user content; about 2 MB at most).
- Updates work only for the app in `/Applications` or `~/Applications`. An app opened from the disk image or another folder makes no update requests; **Check for Updates…** asks the user to move it to Applications.
- The first version with this feature (the first release after v0.1.132) must be installed by hand from the DMG. Every later version arrives by itself.

## Mechanism

The app downloads and checks the update itself; Electron's built-in `autoUpdater` (Squirrel.Mac) checks the signature and installs. No third-party updater. electron-updater uses the same split on macOS.

1. `fetchFeed` (`update-io.ts`) asks the feed with Electron `net.fetch` (Chromium network stack, system proxy settings), 30 s limit.
2. `downloadUpdate` writes `<userData>/updates/Hermes-<version>-update.zip.part` with progress. It stops a download after 60 s without data and resumes a `.part` file with `Range: bytes=<size>-`. It checks the size and the SHA-256 from the feed, then renames the file. A verified file of the same version is not downloaded again; files of other versions are deleted.
3. `stageWithSquirrel` serves the verified file on `127.0.0.1:<random port>` (`/feed`, `/update.zip`), points `autoUpdater.setFeedURL` there and calls `checkForUpdates()`. Squirrel.Mac copies the file, checks the code signature against the running app and stages the update (`update-downloaded`). The local server closes at once; a 5-minute limit applies.
4. "ready": the update installs when Hermes quits, or at once with **Restart to Update**.
- A failed step is retried in 15 minutes; no update means the next check in 4 hours.

| Part | Where |
|---|---|
| Update state and timers | `apps/desktop/src/main/updater.ts` |
| Feed request, download, Squirrel.Mac handoff | `apps/desktop/src/main/update-io.ts` |
| Menu text, dialogs, notifications | `apps/desktop/src/main/app-menu.ts` |
| App menu (Electron's default menus plus the update item) and quit integration | `apps/desktop/src/main/index.ts` |
| Feed and package routes | `services/mobile-updates/desktop.mjs`, served by the same process as the iOS updates (`server.mjs`, `hermes-app-mobile-updates.service`) |
| Publish tool | `services/mobile-updates/desktop-publish.mjs` |
| Release step | `scripts/macmini-desktop-release.sh` |
| Ingress | router `hermes-app-desktop-updates` in `services/mobile-updates/traefik/hermes-app-api.yaml`, copied to `/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-api.yaml` |

- Feed URL: `https://hermes-app-api.tuly.space/desktop-updates/darwin-arm64/<running version>`. The server answers 204 when the running version is the newest, and 200 with `{url, name, notes, pub_date, sha256, size}` when a newer version exists. It never offers an older version.
- Package URL: `https://hermes-app-api.tuly.space/desktop-updates/files/Hermes-<version>-macOS-arm64.zip`. The server sends `ETag`, `Last-Modified` and honours single `Range` requests, so an interrupted download resumes.
- The repository is private, so the app cannot download from GitHub Releases. The update host is the existing `hermes-app-api.tuly.space`.
- Only one check or download runs at a time.
- "Restart to Update" sets a flag and calls `app.quit()`. The graceful shutdown in `before-quit` runs first; at its end the app calls `autoUpdater.quitAndInstall()` instead of `app.quit()`. If the install cannot start (error event), the app quits normally.
- `HERMES_UPDATE_FEED` (environment variable) points a test build to another feed. A package from that feed must still carry the Developer ID signature of team `4R5932XFRV`.

## Security

- Squirrel.Mac installs a downloaded app only when it satisfies the designated requirement of the running app: `identifier "com.changx.hermes.desktop" and anchor apple generic and … certificate leaf[subject.OU] = "4R5932XFRV"`. A package not signed by this team is refused, also if the server or the feed is compromised.
- The app checks the size and the SHA-256 of the download against the feed entry before Squirrel.Mac sees it; a damaged file is deleted. The local handoff feed listens on 127.0.0.1 only and closes after the handoff.
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

## Release: desktop v0.1.133 (first version with automatic updates)

- Commits `637ff67` (feature), `1be0df5` (docs), release commit `a8d71a3`, tag `v0.1.133`. Later on main: `5589d6f` (release script: `stapler validate` retry).
- Server deployment (2026-11-10 18:50 PST): `server.mjs`, `lib.mjs`, `desktop.mjs` copied to the service folder (old copy: `mobile-updates/service.pre-v0.1.133/`); `hermes-app-mobile-updates.service` restarted (PID 1132486 → 3679600). The iOS manifest answered 200 before and after. Traefik router `hermes-app-desktop-updates` added (old file: `mobile-updates/hermes-app-api.yaml.pre-v0.1.133`). Public `/desktop-updates/health` 200, feed 204 before publication.
- First release run: the app passed notarization, then `stapler validate` failed with Apple's ticket-service network error (`NSURLErrorDomain`, Error 68). The step had no retry, and the script stopped before anything was published. `5589d6f` adds the same retry rule as `scripts/macos-dmg.sh` (5 tries, only for `NSURLErrorDomain`) to the app check and to the zip check. Second run of the same tag: all checks passed.
- Checks in the log: app, DMG and unpacked update zip all valid, stapled, and `source=Notarized Developer ID`. All 10 app-code SHA-256 lines equal a local `npm run build` of `a8d71a3`.
- GitHub Release v0.1.133: only `Hermes-0.1.133-macOS-arm64.dmg` (147,054,469 bytes) and its `.sha256`. Pruning deleted v0.1.131; v0.1.132 stays for rollback.
- Update store: `Hermes-0.1.133-macOS-arm64.zip`, 134,252,115 bytes, SHA-256 `0075dffc…a26c`. Public feed: version 0.1.132 gets 200 with this entry, and 0.1.133 gets 204. Public download: 200 with the same SHA-256; `Range: bytes=0-99` returns 206.
- v0.1.132 and older apps have no updater. Install v0.1.133 from the DMG once.
- Open: Jamie's Mac: install v0.1.133 from the DMG into Applications and check that the app menu has "Check for Updates…" ("Hermes is up to date."). After the next release, Hermes downloads it by itself and the menu shows "Restart to Update to 0.1.134".

## Problem: no progress, stuck in "Downloading" (v0.1.133, 2026-11-11)

Jamie: "自动更新功能不太对，一直在 downloading ，也没有进度提示，也不知道成功失败。"

- Server log: Jamie's Mac (v0.1.133) received the v0.1.134 offer at 00:32 PST and requested the zip once. Later checks at 00:34–00:41 got the offer again, but there was no new zip request.
- On the Mac mini the same released v0.1.133 downloaded v0.1.134 in 17 s and reached `update-downloaded`. The server, the package and the signature are good; the download on Jamie's network did not finish or did not report.
- Cause in the design: Squirrel.Mac gives no progress events and no limit for a stalled connection. v0.1.133 waited for its events; with no event the state stayed "Downloading" without any end, and the menu gave no way to see or retry.
- Fix (`fix/desktop-update-progress`, released in v0.1.135): the app downloads itself (see Mechanism), with progress in the Dock icon and the menu, a 60 s stall limit, resume, notifications for ready and failure, failure-specific dialogs, and `update.log`.
- Jamie's v0.1.133 still has the old updater. Install the first release with the fix from the DMG once.

### Verification of the fix

- `apps/desktop/tests/auto-update.test.mjs`: 14 tests. State machine with fake steps (full cycle, progress at most once per percent, no update, failure kinds and 15-minute retry, manual check during download, wake check). Real HTTP server: feed 204/200/never older/broken, download with progress and SHA-256, deletion of other versions, no second download of a verified file, stall stopped after the limit and resumed with `Range`, damaged file deleted. Handoff to a Squirrel stand-in over 127.0.0.1, signature error, 5-minute limit. Menu, dialog and notice texts without technical words.
- End to end on the Mac mini (2026-11-11, commit `d8acd2b`): two signed test builds, 0.1.135 and 0.1.136; local feed behind a proxy limited to 5 MB/s; app in `~/Applications`:
  1. Without the limit (first proxy version): found, downloaded, SHA-256 checked, staged, ready within 1.1 s.
  2. With the limit: menu `Downloading Update 0.1.136… 24%`, `34%`, `44%`, `54%` at 3 s intervals.
  3. Proxy frozen (`SIGSTOP`, connection open, no bytes): 60 s later `failed (network) while downloading: download stalled`; menu `Update Failed – Try Again`; 73,465,533 bytes kept.
  4. Proxy resumed, menu item clicked: request `Range: bytes=73465533-`; `63%` … `94%`; `downloaded 0.1.136, SHA-256 checked`; `ready 0.1.136`; menu `Restart to Update to 0.1.136`.
  5. Click: shutdown steps done, `install 0.1.136`, the new version opened 7 s later; `CFBundleShortVersionString` 0.1.136, `codesign --verify --deep --strict` OK.
  6. Staged update and exit by `kill -9`: ShipIt still installed the new version.
  - Logs: `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/desktop-auto-update/20261111-macmini-progress-e2e/`. Test apps, caches, ShipIt job and test folders removed; the Mac mini's earlier Hermes data folder restored.
- Not checked on a real screen: the Dock progress bar and the notifications (the Mac mini has no foreground session).

## Release: desktop v0.1.135 (download with progress)

- Commits `d8acd2b` (fix), `594dfaf` (docs), release commit `e18cb3e`, tag `v0.1.135`. No server change.
- Release runs: 1st stopped at `codesign` (Apple timestamp server: "A timestamp was expected but was not found"); 2nd passed signing and notarization, then the DMG `stapler validate` failed 5 times (`NSURLErrorDomain`, Error 68). Both are network failures from the Mac mini to Apple, and nothing was published. 3rd run: all checks passed (one `stapler staple` retry).
- Checks in the log: app, DMG and unpacked update zip valid, stapled, `source=Notarized Developer ID`. All 10 app-code SHA-256 lines equal a local `npm run build` of `e18cb3e`.
- GitHub Release v0.1.135: `Hermes-0.1.135-macOS-arm64.dmg` (147,060,386 bytes) and its `.sha256` only. Pruning deleted v0.1.133; v0.1.134 stays for rollback. Update store: the v0.1.133 zip removed, v0.1.134 and v0.1.135 kept.
- Public feed: 0.1.133 and 0.1.134 get 200 with the v0.1.135 entry (134,259,382 bytes, SHA-256 `899fc98d…a710`); 0.1.135 gets 204. Public download: 200, same SHA-256.
- v0.1.133 and v0.1.134 still have the old updater and can hang the same way. Install v0.1.135 from the DMG once.
- Open: Jamie's Mac: install v0.1.135; "Check for Updates…" answers "Hermes is up to date." At the next release: Dock progress, menu percentage, the ready notification and "Restart to Update" on a real screen.
