# Typing lag and live refresh cost

## Confirmed request

Jamie reported that the macOS app lags while he types and that the iPhone app uses much battery. He approved plan B (the server names the changed rows) and the draft-saving fix ("方案 B。全都改。").

## Causes found

1. **Each keystroke saved the drafts in full.**
   - Desktop: the main process read, decrypted, encrypted and rewrote the whole drafts file (`safeStorage` runs synchronously on the main process). Then it called `TabManager.publish()`, which projected a snapshot for the window and for every tab and side panel and sent all of them. macOS input events pass through the Electron main process (see [desktop-scroll-main-process.md](desktop-scroll-main-process.md)), so a busy main process delays keystrokes.
   - Mobile: each keystroke wrote all drafts to two slot files, read both back and listed the folder, synchronously on the JS thread.
2. **Each live change read the complete history.** A watched Session read `GET …/messages?full=true` for every `conversation_changed`. Measured on the jamie connection: a Session with 1002 rows is 769 KB (196 KB gzip) and takes 0.3–1.2 s on the server; the last three rows alone are 2.7 KB in 5 ms. The server event rate is low (23 events in 3 minutes with one running Agent), so the cost is per event, not the number of events.

## Changes

### Drafts

- Desktop `LocalDraftStore` keeps the decrypted drafts in memory after the first read. A keystroke changes memory only. The file is written once typing pauses for 500 ms (`DRAFT_WRITE_DELAY_MS`). It is written at once for the clear after a send and for a connection's clear. `flush()` writes a pending change; the quit sequence already calls it (`prepareShutdown`). A failed write rejects the next change, so the existing draft error still appears.
- The desktop main process publishes a new snapshot only when a Thread's draft presence (the sidebar badge) changes (`updateDraftPresence`).
- Mobile `bindLocalDraftStorage` writes a text edit once typing pauses for 500 ms. It writes at once for attachment edits, a removed or emptied text (a sent message never comes back as a draft), and when the app becomes inactive or goes to the background. `stop()` writes a pending change.
- Limit: an app crash while typing can lose the last 500 ms of text.

### Live refresh (plugin 0.2.70, capability `changed_refs`)

- The plugin adds `refs` to `conversation_changed`: the history rows this page of events changed. See the plugin's `docs/changed-refs.md`.
- The SDK (`LiveSessionClient`) collects the named rows and reads them with `GET …/messages?refs=`. Other rows keep their objects, so mobile row `memo` and the desktop projection cache stay valid.
- The SDK reads the complete history: on open; after each reconnect (`watching`); for a frame without `refs`; when the server lacks `changed_refs`; when a named read fails; and when the Thread's turn stops (`session_state` with `running: false`). The last case picks up core edits of existing rows, which publish no event.

## Verification

Automatic tests (they count reads and writes; they do not measure battery or input latency):

- SDK `changed-refs.test.mjs`: a named change reads only those rows and keeps the other row objects; a stopped turn, an unnamed change and a reconnect read the whole history; a failed named read falls back; without the capability nothing changes; invalid `refs` are a protocol error. Four of the five fail on the old code (the compatibility test passes on both).
- Desktop `local-draft-store.test.mjs` (one encrypted write after the pause, no file read per change; flush; immediate writes; copies) and `draft-presence.test.mjs`. The pause test fails on the old code.
- Mobile `local-draft-storage.test.mjs`: pause, foreground exit, sent text and stop.
- Plugin `tests/p1/test_changed_refs.py`.

Device checks still to do: typing in a long Session on Jamie's Mac with several tabs open; Expo Go battery use in iPhone Settings › Battery with the same use before and after.

## Release on this host (2026-11-24, Jamie: "本机合并发布")

- Plugin 0.2.70: `main` `3e4ef5b`, tag `v0.2.70`. Installed at `~/.hermes/plugin-releases/hermes-app/releases/0.2.70` (equal to `git archive v0.2.70` plus the release `README.txt`); `current` points to it for emma, hermes-app-dev, jamie, nan, space and wangyu. No schema change. Full plugin P1 on `main`: 30 failed, 407 passed, 10 skipped; the 30 failures are the same set as before the change (test setup still sets the token through the process environment). The Gateway (PID 1327893, started 08:04 PST) still runs 0.2.69 until Jamie restarts it.
- App: `main` `bb3da58`. SDK 166/166; mobile 293 (292 pass, 1 skipped); desktop 343 (276 pass, 0 fail, 67 skipped); type checks; iOS and Android exports contain `changed_refs`, `messages?refs=` and `historyRefs`.
- Expo Go: only `hermes-app-expo.service` restarted (PID 3810249 → 1354010); the lockfile did not change. Public iOS and Android manifests and launch assets return HTTP 200 with SDK 58.0.0, and both bundles contain the three markers.
- Not released: the desktop app (no new signed DMG on the Mac mini) and the TestFlight update. The desktop draft fix reaches Jamie's Mac only with a desktop release.
- Until the Gateway restart, clients see no `changed_refs` and keep reading the complete history, as before.
- Rollback: plugin `current` back to `releases/0.2.69` and a Gateway restart; App `git revert bb3da58` and restart Expo only.
- Evidence: `~/.hermes/profiles/jamie/workspace/hermes-app/2026-11-24-typing-incremental/`.

## Full release (2026-11-24, Jamie: "合并发布")

- Gateway restarted by Jamie at 08:54 PST (PID 1373565). `GET /v1/capabilities` returns `changed_refs: true` on jamie and hermes-app-dev. On jamie's 1002-row Session, `?refs=` for the last 3 rows returns 2,732 bytes in 5 ms, rows equal to the complete history (769,161 bytes, 0.94 s). A real `/v1/live` subscription received `{"type":"conversation_changed","refs":[32745]}`.
- Desktop v0.1.149: `main` `a8361e9`, tag `v0.1.149`, built on the Mac mini with `scripts/macmini-desktop-release.sh`. Tests 343 (276 pass, 0 fail, 67 skipped); notarytool `"status":"Accepted"`, staple OK, `valid on disk`, `Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`, `source=Notarized Developer ID`. GitHub Release has `Hermes-0.1.149-macOS-arm64.dmg` (147,117,487 bytes) and its `.sha256`. Update feed: `darwin-arm64/0.1.148` → 200 with 0.1.149 (zip sha256 `167df35b…`, 134,284,075 bytes), `0.1.149` → 204; the zip answers range requests (206).
- iOS (TestFlight install): no new build. Signed update `1a7e80e0-c312-4c08-98db-bf315bda7d49`, runtime `b32a4b59…`, commit `a8361e9`, bundle 13,919,631 bytes; manifest 200 with this id; the bundle contains `changed_refs`, `messages?refs=` and `historyRefs`. Installed apps take it at the next cold start.
- Rollback: desktop reinstall v0.1.148; iOS `publish.mjs rollback --platform ios --runtime b32a4b59c09764da6bb60618bb3513d46fe43d86 --to 774eea4d-dcde-42d8-b89e-8ca0812677cd`; plugin and Expo as above.
- Open: typing in a long Session on Jamie's Mac with several tabs open; iPhone battery use (TestFlight app and Expo Go) with the same use before and after.
- team01 (2026-11-24, Jamie: "去更新 team01 的 hermes"): plugin `releases/0.2.70` copied without `__pycache__`; all 45 file hashes equal this host's release. `current` 0.2.66 → 0.2.70 after an idle check (no running turn; last agent activity 46–58 min earlier). Gateway restarted (PID 4187755 → 1106431, 23:33:54 UTC). All 5 profiles (guojingyu, jamie, sites, wangsheng, zhaozhidan): no token 401, token 200, `changed_refs: true`; `__pycache__` written at restart. Core unchanged (`8ad0396` on both hosts). Rollback: `current` back to `releases/0.2.66` and a Gateway restart.
