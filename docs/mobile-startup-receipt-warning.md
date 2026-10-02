# Mobile startup receipt warning hotfix

User clarified that the generic `Could not save or confirm your message` banner appears immediately at App startup / Channel List, without sending a new message.

## Reproduced cause

The App provider restores its secure outbox before connecting; coming online checks old accepted receipts even with no conversation opened. A durable receipt with no original history reference emits a reception-proof notice. App's `sendNotice` then collapses it into a misleading save/confirm failure banner.

A private executable baseline probe reproduced this cold-start path: one receipt GET, zero message POSTs, zero body reads, original retained, warning emitted. It does not access the phone's SecureStore. Read-only server metadata also contains old mobile unknown receipts without original references; this is consistent evidence, not proof identifying the phone's exact saved record. Gateway error checks did not reveal a corresponding send/storage server exception.

## Candidate changes

- Keep acknowledged originals without a history reference, never resend unknown execution and never classify normal delayed publication as local storage failure.
- Consume an exact matching durable receipt/reference already delivered through the opened session's live state; persist proof before local removal. No periodic body/receipt reads.
- Preserve classified, user-facing outbox notices rather than collapsing real cleanup or storage problems into the same vague banner.
- Preserve genuine storage-failure reporting, foreign-identity fences, cold recovery and unconfirmed originals.

## Verification and deployment boundary

Baseline cold-start reproduction succeeded. Five added regressions cover delayed ACK/reference, exact live proof, foreign proof, cold-start unknown recovery without a send and real storage failure. Full mobile tests: 417/417, zero failures/skips with Chromium enabled. Mobile TypeScript: zero diagnostics. iOS and Android offline exports succeeded.

Candidate only: no phone data cleared, no existing model task resent, no production Gateway/Expo restart or runtime checkout change. Publishing this hotfix remains a separate deployment action. Do not claim a physical-phone storage diagnosis or device acceptance from these tests.
