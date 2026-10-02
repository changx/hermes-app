# Delete a local failed mobile message

Card: `default / t_995eeaa4`; candidate branch `feat/delete-local-failed`, baseline `1606491`.

## Confirmed scope

Jamie approved a narrow local deletion action for the red failed-message row. Long-press its message block (or the red error line to avoid competing with native text selection), choose **Delete**, then confirm. Cancel at either step leaves the original unchanged. Accessibility actions expose the same confirmation flow. App-owned labels remain English.

Only optimistic user messages with `blocked` sending status and no server reference offer this action. The outbox rechecks the exact thread and current status under its existing serialized storage lock. Changing identity or leaving the conversation before confirmation cannot address another connection's record.

Deletion removes this device's durable sending record (text and local attachment descriptors), not server history or uploaded attachments. It does not cancel an Agent, retry the message, mark results read, or create a server tombstone. If Hermes actually received the original despite the missing confirmation, it can appear again through authoritative history.

## Persistence and failure handling

Reuse the existing `discarding` metadata marker before cleaning chunks and metadata. A successful removal updates the projected timeline and remains absent on cold load. Failure before the marker retains the original; interruption after the deletion marker is completed by the existing cold-load cleanup. Failed cleanup reports that deletion could not finish, rather than claiming success.

## Verification

- Added six executable regressions for eligibility, both confirmation steps, exact durable removal and cold load, foreign-thread/state refusal, commit/cleanup failures, and attachment-bearing records.
- Added production `ChatTimeline` component wiring regression for long-press, accessibility, both confirmations, busy state, and non-local/server rows. Native controls are substituted here; this is not device gesture verification.
- Updated existing component harness dependency maps to load the real action helper; no existing assertions weakened.
- Full mobile suite: **438 tests, 437 passed, 0 failed, 1 skipped** (existing optional browser check).
- Mobile TypeScript: passed.
- iOS and Android Expo JS exports: passed. Both exact exported bundles contain the deletion confirmation and `onDeleteFailed` wiring.
- Isolation note: reused locked dependencies and generated markdown renderer. Root esbuild lacked its optional binary; SDK built using installed mobile esbuild. Temporary Metro watch folders and explicit `EXPO_ROUTER_APP_ROOT` ensured exports used candidate source rather than the running checkout. Temporary Metro changes were restored; no lockfile change or install.
- Evidence: active profile private `workspace/delete-local-failed/` (test/typecheck/export logs and bundle markers).

## Delivery boundary and device acceptance

Initially delivered as an isolated candidate. Jamie subsequently authorized publication. Client commit `11a3c61631cf48f65a0912f924976460a44884d5` was cherry-picked onto `main` from rollback baseline `177d07dea42a6c3ffeb4221ce29a689630de8afd`, pushed to origin, and only `hermes-app-expo.service` restarted.

Public iOS and Android manifests and each exact launchAsset returned HTTP 200; SDK `57.0.0` and runtime `exposdk:57.0.0` confirmed. Both actual served bundles contain the Delete confirmation, long-press error-line action, outbox removal and App wiring. Gateway PIDs/start times, installed development plugin hashes and lockfile hashes were unchanged. Release evidence: active profile private `workspace/delete-local-failed/release/`.

No user's saved message was deleted by development or publication. This updates the existing `exps://agent.tuly.space` Expo Go test entry, not an independent install package. Candidate tests/typecheck/exports were reused without reinstalling dependencies or repeating the suite. Rollback: `git revert 11a3c61`, push main, and restart only Expo; do not overwrite chat data.

iPhone acceptance remains: long-press failed block/error line; cancel both dialogs; confirm deletion; leave/reopen and cold restart; verify other messages and Agent continue unchanged. Check text selection and keyboard/scrolling are not disrupted. If already received by Hermes, verify server history remains visible.
