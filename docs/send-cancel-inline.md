# Queued-message Cancel in the time line

## Problem

When a message waits in the queue, both clients show Cancel. The button was in a separate row under the message. That row appeared when Hermes confirmed the message and disappeared when the task started. The message grew and shrank, and the timeline moved.

## Behavior

- Cancel sits in the message's time line, left of the copy icon and the time. It uses the time's small text size.
- Cancel appears and disappears without changing the message height, and the time does not move.
- Warnings (failed, outcome unknown) and Retry safely stay in their own row. These states are final, so the row does not come and go.
- The Cancel space is always reserved. When Cancel is not shown, an invisible placeholder with the same text and size holds the space (desktop `visibility: hidden` + `aria-hidden`; mobile `opacity: 0`, hidden from accessibility, no touches). The user bubble is therefore at least as wide as Cancel + copy + time plus an 8 px margin left of Cancel, so even a very short message keeps the same width when Cancel appears or disappears. The reserve follows the font size because it is real text.
- Desktop: `.user-message-cancel` in `apps/desktop/src/renderer/shell.tsx`. Mobile: `testID="user-message-cancel"` in `apps/mobile/src/ChatTimeline.tsx`.

## Redraws during a send

A probe of the desktop service recorded the states of one sent message:

| Step | Text color | Cancel |
| --- | --- | --- |
| Saved on this device | light gray | no |
| Received by Hermes, queued | light gray | yes |
| Original confirmed | solid | yes |
| Task running | solid | no |
| Task finished | solid | no |

Each step is a real state change. The desktop sends only changed rows to the page (`shared/snapshot-delta.ts`), and unchanged rows keep their objects, so other messages do not redraw. Mobile `MessageRow` has a field-by-field memo comparator with the same result. Before this change, the visible jump came from the Cancel row, not from extra redraws.

Tests: `apps/desktop/tests/send-cancel-inline.test.mjs` (source placement on both clients; Chromium geometry: height and time position are unchanged in all four states).

Release record — desktop v0.1.88 and Expo test entry (2026-10-14):

- Commits: `940222f` (fix), `c300f79` (release, tag `v0.1.88`), pushed atomically to `origin/main`. Rollback branch: `rollback/send-cancel-inline-before-release` at `58f250f`.
- Candidate checks: desktop typecheck, build and `npm test` with Chromium and Electron enabled, 212 tests, 212 pass, 0 fail, 0 skipped. Mobile `tsc` OK; `npm test` 202 tests, 201 pass, 0 fail, 1 skipped; iOS and Android `expo export` OK.
- Workflow run 38679089481 on `macmini-m4`: success; 212 tests, 162 pass, 0 fail, 50 skipped (runner skips the Chromium/Electron tests); audit 0 vulnerabilities. Releases kept: v0.1.88, v0.1.87.
- Package: `Hermes-0.1.88-macOS-arm64.zip` (132,555,964 bytes), `sha256sum -c` OK, `CFBundleShortVersionString` 0.1.88. Extracted `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `dist/renderer/styles.css` are byte-identical to the candidate build.
- Expo: runtime checkout fast-forwarded to `c300f79` (mobile lockfile unchanged, no `npm ci`). `hermes-app-expo.service` restarted: PID 3356338 → 4120448, 20:59:36 PDT. Public iOS and Android manifests HTTP 200, SDK 57.0.0; launch assets HTTP 200 (12,701,090 / 13,027,259 bytes). Markers `user-message-cancel` 0 → 1 and `inlineCancel` 0 → 2 on both platforms. Gateway PID 2069678 unchanged; plugin not changed.
- Open: visual check on Jamie's Mac and iPhone.

Release record — reserved Cancel space, desktop v0.1.89 and Expo test entry (2026-10-14):

- Commits: `de4a8ae` (fix), `b7b8247` (release, tag `v0.1.89`), pushed atomically to `origin/main`. Rollback branch: `rollback/user-bubble-min-width-before-release` at `cfb453a`.
- Candidate checks: desktop typecheck, build and `npm test` with Chromium and Electron enabled: first run 211/212 (`browser-window-native` known ETIMEDOUT under load; passed alone twice), second full run 212 pass, 0 fail, 0 skipped. Mobile `tsc` OK; `npm test` 202 tests, 201 pass, 0 fail, 1 skipped; iOS and Android `expo export` OK.
- Workflow run 38689059795 on `macmini-m4`: success; 212 tests, 162 pass, 0 fail, 50 skipped; audit 0 vulnerabilities. Releases kept: v0.1.89, v0.1.88.
- Package: `Hermes-0.1.89-macOS-arm64.zip` (132,556,044 bytes), `sha256sum -c` OK, version 0.1.89; extracted main, preload, renderer and styles byte-identical to the candidate build.
- Expo: runtime checkout fast-forwarded to `b7b8247` (lockfile unchanged). `hermes-app-expo.service` PID 4120448 → 213947, 22:51:38 PDT. iOS and Android manifests HTTP 200, SDK 57.0.0; launch assets HTTP 200 (12,701,656 / 13,027,825 bytes); markers `user-message-cancel-slot` 0 → 1 and `cancelSlot` 0 → 2 on both platforms.
- Gateway PID 116641 (started 22:04:10 PDT, before this release; not caused by it) unchanged during the release; plugin not changed.
- Open: visual check on Jamie's Mac and iPhone.
