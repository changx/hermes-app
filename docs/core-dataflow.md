# CORE-DATAFLOW — equal-session synchronization and selective presentation

Status: In progress. Authorized by Jamie in the current Hermes App thread. Baseline: local main `68f0706` (existing media and Markdown changes integrated). Worktree: `refactor/core-dataflow`.

## Agreed constraints

- No foreground/background priority system. Every session participates in the same persistent synchronization lifecycle.
- UI selection, drafts, scroll and panels are presentation state; selection does not restart the connection or stop background synchronization.
- Coalesce duplicate entity reads in a received event page; publish a batch of summaries once, not once per summary.
- Independent session/entity reads may proceed concurrently. A slow background read must not prevent another session's data from becoming visible. Durable cursor advancement must never skip incomplete work.
- SQLite is a local cache/outbox, not an authoritative chat database. Keep credentials in existing secure storage; do not reduce current outbox encryption.
- Renderer receives only changed data and preserves identities for unchanged rows/Markdown. Keep existing authentication, exact edit references, version fences, same-ID sending and history semantics.

## Scope and acceptance

1. SDK batch replay: a burst for one session reads its tail once and summaries once per page; independent sessions do not block one another; gaps, failures, abort and reconnect cannot advance past unfinished work; exact edits and receipts remain correct.
2. Desktop selective presentation: unchanged message rows retain identities across IPC updates; list-only changes do not reparse chat Markdown; selection remains an immediate UI action.
3. SQLite persistence: atomic entity updates plus synchronization checkpoint; connection isolation; indexed latest/older history; cold reopen and rollback tests; no credentials stored; preserve encrypted outbox during migration.
4. Full existing SDK/desktop regressions; new burst/multi-session/failure tests. Mac native install, long-running real traffic and device switching are separate acceptance, not simulated by Linux tests.

Not included: priorities, replacement Hermes core, server data migration, production deployment, signing or publishing. Shared protocol/server changes require a separate plugin card and activation gate.

## Integration audit

Worktree inventory also found uncommitted historical changes in `m1-discord-followup`: old mobile reaction variants, the old in-app plugin layout, and test-run evidence. Their product behavior is superseded by current main (`docs/m1-discord-followup-fix.md`, callback-aware `timeline.ts`) and the separate plugin repository (`continuation_anchors` is already present). That worktree is preserved untouched; its old plugin copy and run evidence are not copied back into the client repository.

Local main includes `feat/app-media-static` and `fix/desktop-markdown-spacing`, integrated via `integrate/pre-dataflow`. Desktop: 77 passed / 1 optional Chromium layout test skipped. SDK: 24 + 20 + 38 passed. The first client-check invocation lacked HERMES_BASELINE; rerun with the pinned P0 baseline succeeded. Existing mobile fixes are already in main; older read-loop variants were superseded by b903cb7. Old rolled-back experiments and separate plugin-repository history are not resurrected. No push, release or service restart.

## First implementation increment

- SDK plans a received event page by entity and session, retaining every distinct exact edited ref, coalescing repeated versions and message tails, and sharing one summary traversal. Independent reads publish their results as they finish; acknowledgement waits for every read owner and the persistence hook. Partial/gapped/failed pages cannot skip an unfinished checkpoint. Synchronous summary commits emit one notification per page. Automatic tail continuation uses the saved forward cursor rather than reopening a view.
- Main/preload send revisioned collection deltas. Renderer retains unchanged collection/row references; IPC gaps restore a full baseline and startup/unsubscribe races are fenced. Memoized timeline, sidebar rows and Markdown separate presentation from unrelated data changes. Running and unread count are displayed independently.
- Entering a session initially presents its latest 50 cached rows, not all previously downloaded history. Older paging expands only the presentation window. Cached entry negotiates capabilities before deciding latest versus legacy history; old request completion cannot change the new session's cursor or loading state.
- The desktop cache uses built-in `node:sqlite` in a dedicated worker. Entity changes and the SDK checkpoint commit in one FULL-synchronous transaction; SQL failure rolls both back. A separate file per connection plus owner validation isolates identities. Indexed latest/older queries, stable upserts, cold restore of SDK version/sequence fences, and cache clearing are implemented. Main and renderer never execute synchronous SQLite work.
- Credentials and the encrypted outbox remain in their existing safe-storage implementation. No plaintext outbox migration was attempted. The new server-projection cache is ordinary SQLite with a private directory and 0600 database permissions; it is not database-encrypted. It contains no transport credentials. Attachment files remain separate.

## Verification and limits

- Desktop TypeScript/build and full suite, with actual Chromium layout test enabled: 96/96 passed, no skips.
- SDK pinned-baseline check: 24/24 + 20/20 + 50/50 passed.
- SQLite tests also executed under the actual pinned Linux Electron runtime (`ELECTRON_RUN_AS_NODE=1`): 7/7 passed, including worker transaction failure and SDK → worker → cold reopen → resumed replay.
- A React test-renderer probe ran the actual DesktopShellView and actual Markdown component, instrumenting only a render counter: initial two bodies = 2 renders; unrelated session running/unread update = still 2; one body edit = 3; receipt-only change = still 3. This is component execution, not a Mac visual/performance acceptance.
- Mobile TypeScript and 389/389 tests passed; Android and iOS Expo exports succeeded. Dependency installation reported inherited mobile audit findings (11 moderate, 4 high); no unrelated dependency upgrade was made.
- Burst regression uses real SDK with synthetic transport: 20 message events / 100 summaries now take 3 HTTP requests and 2 state notifications instead of the diagnostic baseline's 41 requests / 2020 notifications. This is request-count verification, not a production latency claim.
- Private logs and render probe: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/core-dataflow/`.
- Corrected integration failures during development: the build-output allowlist needed the new worker artifacts; the new older-window test fixture initially omitted a saved connection. Final full rerun passed.

The overall card remains In progress. This first increment is not a released replacement. Remaining gates: lifecycle/resync UI-continuity review, long-lived multi-session traffic and cache growth, Mac native packaged-worker/device acceptance, and any separately agreed encrypted outbox/draft migration or mobile persistent-cache adoption. SDK events still use existing protocol invalidations and HTTP hydration; no server/core change, production activation, signing, installation, model traffic or service restart is claimed.
