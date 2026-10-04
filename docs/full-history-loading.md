# One-page entry and full-history expansion

## Confirmed behavior

- Open a conversation with one recent transport page: 30 records for normal entry, or 31 records around an explicit attachment-source target.
- Keep normal entry at the latest message. Keep source navigation at its exact target.
- On the first earlier-history action, read the complete original timeline automatically. Do not ask the user to load another block or page.
- Full expansion uses one `GET /v1/threads/{id}/messages?full=true` request and one complete response. Neither client nor server loops through history pages. Initial/source windows remain bounded.
- Show `Loading messages…` and a loading indicator on initial entry. Show loading feedback during full-history expansion while retaining current visible messages.
- Preserve the original reading anchor when the full history is published. Do not reveal partially downloaded earlier blocks.
- Retain downloaded history for the existing live page lifecycle. Returning to a retained page does not load it again. A removed page releases its content.
- Download attachment files only when needed. Message metadata loading does not imply downloading every attachment.

This supersedes five-user-block initial/history expansion. Historical five-block and pull documents remain evidence of earlier implementations.

## Implementation

`LiveSessionClient.loadFullHistory` shares concurrent requests and consumes one complete snapshot. The paired plugin advertises `history_full`; the SDK rejects unsupported servers rather than silently falling back to pagination. It checks `complete: true`, null older/next cursors and ordered references before merging. A failed response leaves current messages and the visible window intact. Requests have a 60-second deadline. Page ownership and cancellation prevent a late response from restoring removed content.

Before full loading completes, live refresh retains the initial window. After completion, refresh also uses one full snapshot request. Desktop expansion tries transient failures three times, then clears loading, keeps rows and restores the earlier-history action with a readable error. Other send behavior remains unchanged.

### Single-request candidate

Jamie reported `Load all earlier messages` remaining on `Loading messages…`. Baseline regression tests reproduced three defects: retry downloaded the first successful page again; live refresh widened to partially downloaded old rows; desktop history recovery kept retrying without leaving the loading state. These are verified code paths, not a captured trace of Jamie's physical device.

Jamie then explicitly replaced pagination with a single complete load. This supersedes the unpublished checkpoint-retry candidate `0b44bf0`. The plugin selects the full reference snapshot once and reuses original projection and receipt identity. It never truncates success: above 20,000 references or 64 MiB JSON, it returns a resource error. Compression is negotiated; attachment files still load on demand.

Isolated branches: App `fix/history-load-reliability`, plugin `feat/full-history-single`; task `t_111b3661`. Real authenticated HTTP returns 255 original messages plus matching receipts in one response. SDK tests: 125 passed. Plugin targeted tests: 17 passed. Desktop: 140 passed, 14 browser/native tests skipped. Mobile: 547 passed, one browser test skipped. All three TypeScript checks, desktop build and both Expo exports passed. Evidence: active Channel `history-single-*-final.log`. No main merge, publication, plugin installation or Gateway restart. No native device acceptance is claimed.

`LivePageClient` routes full loading to the exact page owner. Unopened conversations still receive no body reads.

The mobile App publishes the initial page directly, without fetching enough pages to make five user blocks. During full loading it keeps the visible start reference unchanged, then publishes the first authoritative reference once. FlashList retains native reading position. Its empty state and source-opening state use an accessible loading indicator; reduced motion retains static feedback.

The desktop service retains the visible start reference until full loading finishes. It publishes per-page `loadingHistory`, separate from initial `loadingMessages`. The renderer keeps a fixed-height earlier-history status slot. Its existing prepend correction owns reading position; browser CSS anchoring is disabled to prevent double adjustment. Animation stops under reduced motion and on hidden pages.

## Verification and delivery boundary

The initial implementation was isolated in `feat/full-history-loading`. It changed clients only, with no plugin, server protocol, core or lockfile change. Jamie later authorized main merge and publication; the verified release is recorded below.

Executed automated checks cover:

- One-page opening and a 250-record complete expansion using the actual SDK.
- Concurrent intents, later-page failure/retry, cancellation during page switching and repeated-cursor rejection.
- Bounded source opening followed by explicit complete expansion and subsequent live updates.
- App publication boundary, tail-repair races, background/page retention and existing native FlashList anchor checks.
- Accessible initial loading, active/background indicator behavior and reduced-motion listener cleanup.
- Desktop initial/full loading, retry and retained pages.
- Real Chromium CSS animation, reduced motion and a 250-record prepend that preserves the original row position.
- Shared/mobile/desktop TypeScript checks, tests, desktop build and iOS/Android Expo exports.

Physical iPhone and Mac validation remains separate: first-frame feedback, gesture smoothness, large-message rendering, keyboard behavior, background recovery and weak-network retry. Export and browser checks are not native installation acceptance.

Private evidence is kept in the active Channel workspace under `full-history-loading/`.

## Published release v0.1.17

Jamie authorized main merge, then publication. Main merge `be4f790` includes candidate `76eb015` and preserves the already merged current-year date behavior. Published source/tag `v0.1.17` is `0c85a30c961c9a0bff61e2fe334ebcaea77124a8`; it also includes main's subsequently merged local draft labels. Root/desktop package and lock version metadata changed to 0.1.17 without changing dependency versions.

- Fresh combined release gates: shared-client typecheck/build and 104 tests passed; mobile renderer generation, typecheck and 517 tests passed with one optional browser test skipped; desktop typecheck/build and 128 tests passed, including real Chromium. Both native Expo exports and dependency audit passed.
- Remote main and tag were read back after push. Only the existing Expo service restarted. Both Gateway PID/start/cwd states, installed plugin source hashes, fixed core and mobile lock hash were read back unchanged.
- Expo Go entry remains `exps://agent.tuly.space`. Public iOS/Android manifests and their exact launch assets returned HTTP 200, SDK 57. Served modules contain the full-history action/SDK, bounded initial cursor, loading feedback, reduced-motion handling, retained-content retry and draft labels; the old user block loop is absent from App's history action. Bundle publication does not establish iPhone usability or a signed standalone mobile release.
- [Desktop v0.1.17](https://github.com/changx/hermes-app/releases/tag/v0.1.17) is published in the existing private repository. macOS arm64 workflow `37168953920` passed checks, audit, packaging and release. The downloaded archive passed SHA-256 sidecar verification and ZIP integrity; the actual app is arm64 with package version 0.1.17. Its ASAR contains the full-history SDK, busy states, loading feedback, reduced-motion animation, explicit scroll-anchor ownership and draft labels.
- Archive: `Hermes-0.1.17-macOS-arm64.zip`, 129951824 bytes, SHA-256 `46c94089acd78042b25ad3e6ca1b02e7e260206b48fdb1416cc649dfd4581a50`. Unsigned and not notarized. No Mac installation or launch is claimed.

Release evidence, exact bundles, manifests, downloaded desktop archive/ASAR, checks and before/after state are in Channel `full-history-loading/release/`. Reload the Expo Go project to fetch the update. Physical iPhone/Mac behavior remains pending.

Rollback source is `4a415c6`, preserved as `rollback/history-loading-before-v0.1.17`. If separately authorized, restore only the runtime client source and restart only Expo; retain outbox/chat data and all Gateway/plugin/core state. Source rollback on main uses explicit reverts, not branch reset. Desktop rollback uses the existing v0.1.16 release; do not replace published v0.1.17 assets.
