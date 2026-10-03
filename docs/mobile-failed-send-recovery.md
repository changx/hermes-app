# Mobile failed-send recovery after successful reception

## Scope and evidence

Card: `t_c42f40e8`; baseline: `857a0e2`; candidate branch: `fix/mobile-failed-send-recovery`.

Jamie supplied recording `att_9ee25c2382ad41e3bdc0f020f2298653`. Local ffprobe and frame extraction/OCR show a failed optimistic user message on entry, followed by normal server history, while the global “Sending could not be confirmed” banner remains. This is observation of the recording, not access to iPhone SecureStore or proof of its exact client-message identity.

A production-code regression reproduced the defect: `MobileOutbox.reconcile()` ignores blocked sends even when the opened conversation provides an exact durable receipt with a published reference. Timeline projection temporarily suppresses the local row while that history is present; leaving the conversation releases history but leaves the blocked secure outbox record, so it appears again on reentry. App also retains the original rejection banner after outbox recovery.

Baseline six-test run: three failures (matching proof does not retire original; unknown reception proof does not recover; proof persistence failure is not attempted/reported), three identity guards pass. Candidate adds delayed response-failure recovery and App callback/navigation coverage.

## Implementation

- Consume existing live receipts only for the exact thread/client-message identity, preserving any already stored receipt/reference identity.
- Require durable reception and a positive stable reference; persist acceptance before removing the saved original.
- Reuse existing acknowledgement/cleanup handling, including real storage failure notices.
- No new HTTP reads, timers, full-history scans, body-equality matching, resend or model rerun. Unknown execution can prove reception without re-execution.
- Clear only the two resolved send-rejection banners when no blocked records remain; unrelated authentication, storage and action errors remain.

## Candidate verification

- Seven focused recovery cases and two notice cases; one additional App lifecycle case. All pass.
- Mobile suite: 448 total, 447 pass, zero failures, one optional Chromium table-layout case skipped with no browser configured.
- With Chromium enabled: 447 pass, one table-layout test times out after 30 seconds. Standalone retry and alternate launch flags also time out. This unrelated browser gate is **not passed**.
- Mobile TypeScript and `git diff --check`: pass.
- Offline iOS and Android exports: success; both exact generated bundles contain recovery and notice-reconciliation code, with SHA-256 evidence. An initial Android export returned success but omitted app routes in the reused Metro cache; explicit `EXPO_ROUTER_APP_ROOT=./src/app` and `--clear` produced a verified complete Android bundle. Candidate dependencies reuse installed packages; an ignored generated Markdown renderer and SDK dist were built locally. Metro temporarily included the real dependency folder to follow the worktree dependency symlink; this local build-only config change was restored, not committed.
- Public manifest/launchAsset verification and physical-iPhone acceptance: not performed because this candidate has not been deployed.

## Boundaries

No main checkout changes, service restarts, plugin installation, Hermes core edits, other-profile writes, iPhone data clearing or existing task resubmission. Deploying to the existing Expo Go test entry requires authorization; do not claim this is a device-verified fix or an independent installable release.

Private verification logs and exported-bundle hashes: active profile workspace `workspace/hermes-app/failed-send-recovery/`.
