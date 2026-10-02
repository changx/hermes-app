# Shared completed-unread directory status

Confirmed by Jamie: completed but unread results need a session-list marker, shared between desktop and mobile. This is directory subscription metadata, not conversation content and not a revival of unread counts.

## Contract

- Catalogue session entries add `completed_unread`, `result_version`, `result_ref`. A result revision is an acknowledgement identity, not an event replay cursor or a general synchronization version chain.
- Successful execution must be confirmed by the existing formal processing-complete callback. Only after history reconciliation, and with a visible assistant reference newer than this input, may the plugin publish a completed result. Running=false, busy handoff, failed, stopped and unknown outcomes are not completion evidence.
- The plugin stores result metadata and a monotonic account-wide read revision per Thread; it never duplicates result text. Existing authentication's single-owner devices share this state. Future multi-user ownership requires a separate account-scoping decision.
- Result completion and read commits wake existing live publishers and emit `directory_changed`. All connected devices reread lightweight directory metadata even if they watch no conversation. Unopened sessions never fetch bodies to maintain the marker. Reconnect and cold startup recover the same directory state.
- `POST /v1/threads/{id}/result-read` with `{result_version: <displayed revision>}` acknowledges only an existing result owned by this available Thread. Repeated/stale acknowledgements are idempotent and cannot clear a newer result. Authentication, available Channel and archive checks still apply.
- Mobile uses FlashList's actual viewable refs plus focused route and active AppState. Desktop uses the result element's intersection with the timeline viewport plus visible/focused document. Downloading history, entering a list, a hidden window, or reading older messages alone does not mark a result read.
- Both lists show a blue `● Completed · Unread` marker. Running remains independent: an older unread result can coexist with a newer running task. No unread count, general message read position, push delivery or history cache is added.
- Failed read acknowledgements do not clear local state. Directory readback and subsequent directory subscriptions remain authoritative; foreground/open/reconnect can retry. No periodic business polling is introduced.
- Migration creates empty result/read metadata tables. It does not invent unread status for pre-upgrade history, for which a shared result-read baseline never existed. New successful completions are recorded after activation.

## Candidate and verification

Kanban: `t_00c33792`. App branch `feat/completed-unread`; plugin branch `feat/plugin-completed-unread` based on the existing channel-workspace candidate. The latter dependency is not an authorization to deploy workspace APIs or any other pending feature; publication must select the reviewed plugin baseline and carry only this change.

Implemented: plugin schema, post-success publication, authenticated acknowledgement endpoint, catalogue projection and live invalidation; strict shared-client decoding/acknowledgement; mobile and desktop list markers and actual visible-result acknowledgement.

Local checks: shared client 79 passed; desktop full check (typecheck/build/tests) 99 passed, 5 skipped; mobile 430 passed, 1 skipped; plugin full P1 suite 314 passed, 1 optional SDK probe skipped. Final targeted plugin callback/HTTP/WS tests 12 passed, 1 optional probe skipped, including two real authenticated directory-only WebSockets, persistent shared clearing, wrong-thread and unauthenticated ACK rejection, duplicate/stale ACK and new-result races. Inputs in these isolated tests are synthetic, not real model execution or device evidence.

Desktop and mobile TypeScript checks passed. iOS and Android offline Expo exports both passed. Dependency symlinks outside Metro's watch root initially prevented module resolution; copying the existing locked mobile dependency tree into the isolated worktree fixed both exports without dependency or lockfile changes. Evidence is kept in the active profile's private workspace, not committed logs or credentials.

Not released: no main merge, plugin installation, Gateway/Expo restart, production change or Mac device operation. Real model lifecycle acceptance, mobile/desktop physical-device visibility behavior and a coordinated development deployment remain separate gates. No signed or standalone mobile package is claimed.
