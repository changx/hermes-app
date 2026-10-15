# Mobile battery: connection checks and retries

## Confirmed request

Jamie asked to reduce phone battery use and approved the proposed design (A + B with NetInfo + C). The design keeps the reliability rules in [m1-network-reliability.md](m1-network-reliability.md). It changes only foreground connection timing. Background behavior is unchanged: the app already pauses the connection, animations and timers in the background.

## Behavior

### A. Adaptive connection check

- Active: the phone sends a WebSocket `ping` every 10 s, as set in [m1-network-time.md](m1-network-time.md).
- Idle: the phone sends a `ping` every 30 s. This matches the server's own WebSocket heartbeat (`heartbeat=30`).
- The pong deadline stays 10 s in both modes. With no error, an idle silent disconnect is detected in at most about 40 s. An active one is still detected in about 20 s.
- A connection is active when any of these is true:
  - an outbox message is not confirmed (any status except `blocked`);
  - a Thread in the directory is running, or a receipt is running;
  - the user touched the app, or returned it to the foreground, in the last 2 minutes.
- When a connection becomes active, the next ping moves forward to 10 s after the last ping. A change to idle takes effect after the next ping.
- Sending uses HTTP, so the idle interval does not delay sends. Idle only delays detection of a silent drop, and with it updates from other devices.
- Touch capture uses `onStartShouldSetResponderCapture` at the root and always returns `false`. It never takes a touch. Repeated touches do not re-render; only the start and end of the 2-minute window re-evaluate.

### B. Retry backoff and network changes

- Ordinary backoff is now 0.2, 0.5, 1, 2, 5, 10 and then 20 s, with ±20% jitter. The old schedule stopped at 5 s and retried every 5 s for as long as the phone had no network.
- `@react-native-community/netinfo` (12.0.1, the version bundled with Expo SDK 57) reports device network changes. In the foreground, a change of network type or connected state calls `networkChanged()` on each connection:
  - during an ordinary backoff wait, the SDK retries at once and starts the schedule again;
  - on an open socket, the SDK sends a `ping` at once, so a socket that a network switch broke is found within 10 s.
- The first NetInfo report is only the starting state. A report of no connection does nothing. Background reports do nothing; returning to the foreground already reconnects.
- A server `Retry-After` wait (HTTP 429) is never shortened. Authentication failures still stop retries.

### C. Retry countdown

`Connection interrupted. Retrying in Ns…` updates once per second at the second boundary. It used to update every 250 ms.

### D. Rendering of Thread pages

A code review found that the app did more React work than the content needed. The cause was not the network.

- **One account-wide signal.** Before, every SDK change on any page or connection increased one `revision`. Every retained Thread page, the Recents list and the channel pages then rendered again.
- **Rows rendered again with no change.** Each render gave every message row new callback functions (`onCancel`, `onDeleteFailed`, `onRetryFailed`) and a new `WorkGroup` object. `MessageRow` compares these by identity, so its `memo` never held. The full transcript is one plain `ScrollView`, so every row took part.
- **Scrolling rendered the page.** The visible row list was page state. It changed many times during a scroll, and each change rendered the page.
- **Hidden animation.** The `Agent is running` dots ran on a retained page that another page covered.

Changes:

1. Each `LiveSessionClient` has `subscribe()` and `changeVersion`. A page notifies only its own subscribers; the account notifies for directory changes. The app callback (`onChange`) still runs for every change, so the outbox, the lists and `revision` are unchanged.
2. A Thread page reads `useAppScope()`, the connection scope without `revision`, and `usePageVersion(page, account, shown)`. It renders for changes of its page and its account. While it is hidden or the app is in the background, it notes the change and renders once when it is shown again. The SDK still receives all data and keeps the subscription; only the React work waits. `ThreadScreen` and the page are `memo`, and `useAgentName()` returns a stable object, so the route's own renders do not reach the page.
3. Row callbacks have one identity for the page's life (`useLatestCallback`). Rows receive a group view (`reuseWorkViews`) that keeps its object while its key, label, completion and running state are unchanged. A new tool row in a running turn renders only that row.
4. Visible rows are kept in a ref. Only "the completed-result row is in view" is state, so the read mark still runs, but scrolling does not render the page.
5. The receipt and approval signatures read only this Thread's entries.
6. `TypingIndicator` is active only on the shown page.

Limits: the transcript is still not virtualized (see [m1-history-scrollview.md](m1-history-scrollview.md)). Other screens (Recents, channel lists) still follow `revision`. Android keeps its composer blur.

Candidate verification (branch `perf/mobile-render-battery`, clean `npm ci` in the worktree):

- New tests fail on the old code and pass on the new code: a hidden page waits and renders once when shown; another page's change does not render the shown page; row callbacks keep one identity; scrolling does not render the page; a new tool row renders only itself (old code rendered every earlier row of the group again); the running indicator stops on a covered page. Behavior tests confirm that the result read mark, retry handling and the "Worked for" heading are unchanged.
- SDK 83/83; mobile 209 pass, 1 skipped, 0 fail; mobile TypeScript; full desktop check with Chrome and Electron enabled (`desktop:check`): 212/212, 0 skipped; iOS/Android exports contain the new code.
- These tests count renders. They do not measure battery use or heat. Compare Expo Go in iPhone Settings › Battery with the same use before and after the release.

Dev release (2026-10-15): rebased onto `194a45d` (desktop v0.1.90, no overlap) and checked again: SDK 83/83; mobile 209 pass, 1 skipped; TypeScript; both exports; full desktop check 212/213 on the first run (`browser-window-native` ETIMEDOUT, the known flaky signature; alone 2 of 3 runs passed), then 213/213. Merge `e685a33` (tree equal to the tested branch) is in the runtime checkout; only `hermes-app-expo.service` restarted (PID 213947 → 416273). Public iOS/Android manifests and launch assets returned HTTP 200 with SDK 57.0.0. The markers `usePageVersion`, `reuseWorkViews` and `Changes of this client only` rose from 0 to 5, 4 and 1 on both platforms. Gateway PID 116641 and the plugin tree hash did not change; the lockfile did not change. No desktop release: desktop uses none of the new SDK API. Rollback: branch `rollback/mobile-render-battery-before-release` (`194a45d`), or `git revert -m 1 e685a33`, then restart Expo only. Evidence: `~/.hermes/profiles/jamie/workspace/hermes-app/2026-10-14-mobile-render-battery/` and the Channel workspace `mobile-render-battery/`. iPhone acceptance and battery comparison are not verified.

## Shared SDK

`LiveSessionClient` adds `idleLivenessMs`, `backoffJitter`, `setLivenessIdle()` and `networkChanged()`. Their defaults keep the previous behavior, so desktop is unchanged. Pages delegate both methods to the account connection.

## Verification and limits

- Automatic tests cover the active/idle interval, bringing the ping forward, the fixed pong deadline, the open-socket probe, waking an ordinary backoff, not shortening `Retry-After`, jitter bounds, suspend during a wakeable wait, the idle rules, the activity window, the NetInfo rules and the countdown timer.
- These tests prove the timing logic only. They do not measure battery use. iOS reports battery use for the whole "Expo Go" app. Compare it with the same use pattern before and after.
- iPhone checks not yet done: a network switch (Wi-Fi ↔ cellular) recovers quickly; airplane mode on and off reconnects at once; a quiet chat still receives a reply from another device.

## Dev release

Commit `2badd5d` was fast-forwarded into `main` and published to `exps://agent.tuly.space`. The mobile lockfile changed (NetInfo), so `npm ci` ran in `apps/mobile`. Only `hermes-app-expo.service` restarted. The unused `session-timing.conf` drop-in (`EXPO_PUBLIC_SESSION_TIMING=1`) was removed; a copy is kept with the evidence. Gateway PID/start time and the plugin hash did not change; no plugin was installed.

- Automatic checks: SDK 34/34; mobile 119 pass, 1 skipped, 0 fail; mobile TypeScript; full desktop check with Chrome and Electron enabled (`desktop:check`): 100/100, 0 skipped; iOS/Android exports.
- Public iOS/Android manifests and exact launch assets returned HTTP 200 with SDK 57.0.0, `dev=false`, `minify=true`. Both bundles contain the new markers (`idleLivenessMs`, `backoffJitter`, `networkChanged`, `RNCNetInfo`, root touch capture).
- Evidence: Channel workspace `mobile-battery/release.log`, `tests.log`, the manifests and `session-timing.conf.bak`.
- Rollback: `git revert` the feature commit, run `npm ci` in `apps/mobile`, and restart only Expo. Chat data is not affected.
- iPhone acceptance and battery comparison are not verified.
