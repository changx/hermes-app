# Mobile failed-send recovery after successful reception

## Scope and evidence

Baseline: `857a0e2`; candidate branch: `fix/mobile-failed-send-recovery`.

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

## Authorized publication

Jamie subsequently authorized merging this fix into main and publishing it. Main merge: `201b589c40b5df9d079adf7f1c20aabb45951ef0`; the integrated main TypeScript check and 28 targeted recovery/lifecycle/notice tests passed.

Main already contained Files/AGENTS (`f2a3347`) and minute-only times (`1314a60`) under an explicit merge-only/no-publication instruction from another task. Those changes were not published incidentally. The existing Expo runtime directory therefore remains detached, updated from `857a0e2d3a41b9b2fdec1effeb87b652badb34e1` to the exact tested recovery candidate `0e87ea496951bb7c4c8d2a6e9b26eb2555e21576`. Main remains checked out in the existing mobile-workspace-entry worktree; no remote push or desktop release was performed.

Only `hermes-app-expo.service` restarted. Expo PID changed from 2056860 to 2330378, start time 2026-10-02 19:50:38 PDT. Development and Jamie Gateway PID/start states, installed plugin hash set, fixed core commit and mobile lockfile hash were read back unchanged; no npm ci, plugin installation, phone-data clearing or task resubmission.

Both public manifests and each exact launchAsset returned HTTP 200, SDK 57. Both served bundles contain the blocked-send exact durable identity recovery and App banner reconciliation. Unpublished Files/AGENTS screen markers remain absent; existing light-blue unread-dot color remains. Private evidence: `workspace/hermes-app/failed-send-recovery/release/verification.json` plus saved manifests and exact bundle bytes.

Rollback baseline is the existing detached runtime commit `857a0e2`; restore that explicitly and restart only Expo if rollback is authorized. Published-source rollback must not overwrite chat or outbox storage. iPhone repeated-entry/cold-launch verification remains pending; public resources do not prove physical-device acceptance. The unrelated Chromium table-layout timeout remains unresolved.
