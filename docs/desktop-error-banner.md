# Desktop error banner

## Problem

Desktop action errors share one connection-wide `errorMessage`. Before this change, only a reconnect, pairing, a session link or loading earlier messages cleared it. The banner had no close control. A notice such as "That request is no longer pending. Hermes will refresh its status." therefore stayed on the session page after the request status was refreshed.

## Behavior

- An action error has a close button (×). The snapshot field `errorDismissible` is true when the message is an action error and the connection is paired.
- A live connection problem (`connectionIssue`) has no close button. It stays until the connection recovers.
- The stale-request notice clears 6 seconds after Hermes refreshes the request status. If a newer error replaced it, the newer error stays. If the refresh fails, the notice stays until the user closes it.
- The session page and the workspace use the same `ErrorBanner` component (`apps/desktop/src/renderer/error-banner.tsx`).
- IPC: `desktop:dismiss-error` with an optional thread ID. The thread ID selects the connection that owns the session; without it, the current connection is used.

Tests: `apps/desktop/tests/error-banner-dismiss.test.mjs`.

## Release record — desktop v0.1.87

- Commits: `d8e4863` (fix), `07723ca` (release, tag `v0.1.87`), pushed atomically to `origin/main`.
- Candidate (Linux): desktop typecheck and build passed; `npm test` 210 tests, 161 pass, 0 fail, 49 skipped (native Electron tests not enabled).
- Workflow run 38676398474 on `macmini-m4`: success in 3m12s; 210 tests, 161 pass, 0 fail, 49 skipped; audit 0 vulnerabilities. Releases kept: v0.1.87, v0.1.86.
- Package: `Hermes-0.1.87-macOS-arm64.zip` (132,555,939 bytes), `sha256sum -c` OK, `CFBundleShortVersionString` 0.1.87. Extracted `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `dist/renderer/styles.css` are byte-identical to the candidate build. Markers `desktop:dismiss-error` and `error-banner-close` are present.
- No mobile, plugin or Gateway change. Expo was not restarted.
- Open: visual check on Jamie's Mac (close button, automatic clear of the stale-request notice).
