# One-page entry and full-history expansion

## Confirmed behavior

- Open a conversation with one recent transport page: 30 records for normal entry, or 31 records around an explicit attachment-source target.
- Keep normal entry at the latest message. Keep source navigation at its exact target.
- On the first earlier-history action, read the complete original timeline automatically. Do not ask the user to load another block or page.
- Continue using the existing paged HTTP API with a maximum of 100 records per request. Full loading is one user action, not a new unbounded server endpoint.
- Show `Loading messages…` and a loading indicator on initial entry. Show loading feedback during full-history expansion while retaining current visible messages.
- Preserve the original reading anchor when the full history is published. Do not reveal partially downloaded earlier blocks.
- Retain downloaded history for the existing live page lifecycle. Returning to a retained page does not load it again. A removed page releases its content.
- Download attachment files only when needed. Message metadata loading does not imply downloading every attachment.

This supersedes five-user-block initial/history expansion for the current client candidate. Historical five-block and pull documents remain evidence of earlier implementations.

## Implementation

`LiveSessionClient.loadFullHistory` shares concurrent requests, reads forward from the oldest reference, rejects repeated cursors and clears older/newer cursors only after completion. A retry restarts the full read; stable references merge without duplicate records. Page ownership, transport cancellation and caller cancellation prevent a late response from restoring removed content.

`LivePageClient` routes full loading to the exact page owner. Unopened conversations still receive no body reads.

The mobile App publishes the initial page directly, without fetching enough pages to make five user blocks. During full loading it keeps the visible start reference unchanged, then publishes the first authoritative reference once. FlashList retains native reading position. Its empty state and source-opening state use an accessible loading indicator; reduced motion retains static feedback.

The desktop service retains the visible start reference until full loading finishes. It publishes per-page `loadingHistory`, separate from initial `loadingMessages`. The renderer keeps a fixed-height earlier-history status slot. Its existing prepend correction owns reading position; browser CSS anchoring is disabled to prevent double adjustment. Animation stops under reduced motion and on hidden pages.

## Verification and delivery boundary

The candidate is isolated in `feat/full-history-loading`. It changes clients only. It does not change the plugin, server protocol, core or lockfiles. It does not authorize a main merge, service restart, remote publication or installation.

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
