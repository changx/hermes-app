# Mobile background scene preservation

## Confirmed correction

Jamie rejected treating App background/inactive as conversation departure. Short switches to another app, permission/photo selection and phone calls must keep the current scene. Only actual navigation away, conversation switch/close, forgotten identity or authoritative unavailability releases it. Still retain only one opened conversation; no SQLite/server-history persistence or multi-session body caches.

## Implementation

- `LiveSessionClient.suspendConnection()` closes health/watch transport and aborts current content reads, without releasing current messages, receipts, interactions, attachments, older cursor, draft state or conversation ownership. `close()` still releases content. Foreground `connect()` negotiates a new watch ACK and reconciles the retained loaded boundary, not a latest-window replacement. `retryNow()` also preserves the active scene.
- The focused mobile route remains mounted in background; AppState pauses the client/outbox instead of closing/unmounting. Existing route focus cleanup continues to release truly covered/popped conversations. Reader state, startRef/older pagination, text and selected file state remain owned by the mounted scene.
- Unchanged normalized message/tool/attachment identities survive fresh reads, avoiding parser/media reload from identity-only changes. This references only the one current message window and is cleared on real close/switch.
- Background cancellation of a history read does not produce an ordinary load-failure banner. Pending scroll frames/animations are cancelled without resetting the reading/follow state. Server archive/removal is still authoritative on foreground recovery.

## Verified evidence

- Shared package tests: 77/77; mobile tests: 418/418; desktop tests: 93/93, all zero failures/skips, Chromium layout checks enabled.
- All three TypeScript projects: zero diagnostics; shared bundles and desktop build succeeded; iOS/Android offline exports succeeded.
- Real isolated plugin HTTP/WS + actual candidate SDK interoperability: 6/6 (5 non-failing aiohttp warnings). Probe pauses/reconnects while retaining ownership and current rows, reads committed changes and releases all content on actual close.
- SDK fixtures cover no background business reads, unchanged parser/media metadata identities, late read fences and remote archive during suspension. React lifecycle regression checks mounted scene identity, an older five-block boundary, draft, mock scroll/follow/selection/media state across inactive/background/active, then real route departure releasing it. Native hooks/views are test substitutes, not proof of UIKit gestures or selection behavior.

This branch includes the prior unshipped `dc718d2` startup-receipt warning fix. No runtime checkout, server/core/plugin installation, credential change, service restart or release push was performed. Physical iPhone keyboard/gesture/selection/background-memory-pressure acceptance remains pending. Process death is cold restore, not ordinary background retention.

## Publication outcome

### Follow-up: native route lifetime

The background fix did not fix detail-reader coverage: `ThreadScreen` still returned null on blur, destroying its child and triggering a new open on return. Jamie requested natural native lifecycle management rather than forced page refreshing. The isolated follow-up removes the focus-based mount gate entirely: Native Stack owns page lifetime for detail, nested reader and settings coverage. Focus only gates visible work. Actual route unmount releases the watch only if still owned by that route; a changed conversation owner releases old server content in the SDK and a focused older route reopens only if its ownership was replaced. No route-path exceptions, duplicate parent pages or multi-session body caches are introduced. Candidate evidence and device acceptance are separate from the earlier publication below.

The native-lifecycle follow-up `f3ad7b9` was subsequently authorized, fast-forwarded to main and explicitly pushed as `HEAD:refs/heads/main`. Mobile Expo publication was verified using the exact public iOS/Android launchAssets (both manifest/bundle 200): `ThreadScreen` no longer has a focus-dependent mount gate, the ownership-based reopen fence is present, and background transport suspension remains. Only Expo restarted; both Gateway PIDs/start times and installed-plugin source hashes matched the fresh pre-release baseline. Existing desktop release assets were not replaced. Local follow-up validation: mobile 502/502 without skips, all three TypeScript projects zero diagnostics, final dual-platform exports succeeded. Physical iPhone detail-return/scroll/WebView acceptance remains pending. Private evidence: active-profile `workspace/hermes-app/mobile-tool-viewer-scene/release/{before,after}.json`; rollback `b7375b5`.

Jamie subsequently authorized main merge and publication. `1d35d15` (including `dc718d2`) was fast-forwarded and pushed to main. Only the existing Expo service restarted; development/Jamie Gateway PIDs and start times were unchanged. Public SDK57 iOS/Android manifests and their exact launchAssets returned 200; served modules verified transport suspension, stable message/resource ownership, exact live receipt-proof recovery and removal of the old generic startup warning. Main macOS CI run `37020918487` succeeded; the existing v0.1.8 desktop tag/assets were not moved or replaced.

Mobile entry: `exps://agent.tuly.space`. Private before/after and bundle hashes: active-profile `workspace/hermes-app/mobile-background-scene/release/verification.json`. Rollback source: `b141682`. Publication does not close the physical iPhone acceptance gates above.
