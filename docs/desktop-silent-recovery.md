# DESK-FIX-SILENT-RECOVERY

Status: Review — implementation, automated checks and unsigned candidate packaging complete; not deployed or installed on Jamie's Mac. Jamie reports frequent desktop timeout banners and requests unobtrusive automatic recovery.

Scope: desktop connection error classification; retry failed channel/history reads without clearing visible content; retry durable sends even when the WebSocket remains online; lifecycle cancellation and selection race guards. No core, plugin, mobile or deployment changes.

Acceptance: transient errors never become global banners; failed reads recover automatically; stale selection responses do not change the active view; same-ID send retries preserve text/attachments; unknown execution only queries its receipt; authorization and permanent action failures remain actionable; close/forget cancels timers. Desktop full checks and shared client regressions must pass. Mac sleep/wake, real network switching and updated installation remain separate device acceptance.

Not included: automatically repeating non-idempotent channel mutations, signing, releases, or claiming simulated faults are real-device validation.

## Implemented

- Transient connection failures are not exported as global errors; permanent connection errors are separate from action errors and cleared on recovery.
- Removed the normal header's connection label/manual reconnect control. SDK heartbeat, backoff and durable replay remain unchanged.
- Channel list, current history and older history retry automatically with bounded backoff and Retry-After; cancellation and stale selection guards prevent old results changing current pagination.
- Durable outbox retries while the socket remains online, single-flight per identity; crash-left `sending` entries resume under the original ID. Unknown execution queries an existing receipt only. Authorization failure stops further automatic recovery.
- macOS resume rotates the connection without clearing projections; blocked/permanently stopped clients do not restart. Close/forget cancel retries; late send responses cannot recreate confirmed entries or schedule work after close.

## Verification

- `npm run desktop:check`: TypeScript, main/preload/renderer build, **54/54 tests passed**, including 14 new simulated fault/lifecycle tests.
- Initial `npm run client:check` exited because HERMES_BASELINE was unset; rerun with `/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline` passed pinned baseline validation, SDK typecheck/build and test groups **24/24**, **20/20**, **33/33**.
- `npm run desktop:package:mac`: generated unsigned Apple Silicon candidate at `apps/desktop/artifacts/Hermes-darwin-arm64/Hermes.app`. Checked packaged executable, ASAR main/preload/renderer, recovery/wake code and absence of the old timeout banner. This Linux-produced candidate lacks macOS ASAR integrity digest restoration because codesign is unavailable; do not treat it as a signed/release build.
- `git diff --check`: passed. No changes to main, mobile runtime, plugins, Hermes core or services.
- Not verified: installation/launch on Mac, real sleep/wake, real weak-network/switching, Mac/iPhone end-to-end recovery. Candidate remains in an isolated branch until approved desktop deployment/device acceptance.
