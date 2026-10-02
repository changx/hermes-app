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
