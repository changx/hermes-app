# CORE-DATAFLOW — equal-session synchronization and selective presentation

Status: Review — implementation, local regressions, network fixture soak and native Mac packaged-worker smoke complete; real model multi-session/device experience acceptance remains separate. Authorized by Jamie in the current Hermes App thread. Baseline: local main `68f0706` (existing media and Markdown changes integrated). Worktree: `refactor/core-dataflow`.

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

## Completion increment

- Replaced destructive resync with a staged projection. Previously cached intervals are re-read to repair expired old edits; the replacement is persisted before one atomic UI publication. Failed/aborted/superseded staging leaves the old projection and checkpoint intact. Late approval, attachment and read responses are epoch-fenced. Desktop preserves selection, older reading boundary and pagination; authoritative removal cancels the obsolete selection.
- IPC baseline failures now retry without new events or false unpaired state. Unsubscribe cancels timers and late callbacks.
- SQLite worker requests have deadlines, crash rejection and single-flight draining close. The service recreates a dead worker without resubmitting model execution. Idle identical checkpoints perform no SQL writes. A cache-removal failure is actionable and cannot falsely confirm Forget connection.
- Sidebar running state uses authoritative processing outcomes before lifecycle bookkeeping. Running membership is computed once per projection rather than scanning all receipts for each session; unread remains independent.

### Final verification

- Linux desktop TypeScript/build + real Chromium layout: **104/104 passed**, no skips. SDK groups: **24/24 + 20/20 + 55/55 passed**. Actual pinned Linux Electron SQLite-worker tests: **10/10 passed**.
- Mobile TypeScript, **389/389 tests**, Android and iOS exports passed on final source.
- `scripts/dataflow-soak.mjs`: real loopback HTTP/WS, two SDK clients, actual desktop service/delta store and SQLite worker; messages and receipts are explicitly synthetic fixtures. Final run: 100 sessions, 300 rounds, 6,100 message rows, 12,060 events, 60 view switches, forced disconnect and authoritative cursor expiry/resync, 62,587 ms. Both clients' messages, read positions and unread counts matched the fixture authority; cold SQLite reopen and renderer projection matched. This is bounded network/resource stress, not genuine model traffic or a production latency claim.
- Native Apple Silicon Mac mini: pinned Node/npm install, desktop build and tests (**103 passed, one optional Chromium layout test skipped**), unsigned native `.app` packaging. Production packaged entry launched in a dedicated empty user-data directory; root mounted, phase unpaired, sandbox retained. SQLite worker loaded from **inside app.asar**, wrote a checkpoint and cold-reopened it. Electron 44.4.5 / embedded Node 24.21.0. Mach-O arm64 and ElectronAsarIntegrity read back.
- Native probe first attempted NODE_OPTIONS preloading, which packaged Electron rejected; used a loopback-only main-process inspector on the isolated candidate instead. No production source/permission/security-setting change, original App replacement or real credential copy. Candidate process and debug listener were closed and read back absent.
- Initial native source archive omitted `.gitignore` required by a packaging regression; supplied that repository file and reran full native checks successfully. No gate was bypassed.

### Retained artifact

`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/core-dataflow/Hermes-0.1.5-core-dataflow-macOS-arm64.zip`

- Native archive size: 128,776,794 bytes.
- SHA-256: `58b04515775ebba4eb0071e3972a800f767764facad2a928fda9e2269ea57104`; Mac source archive and downloaded copy agree.
- Unsigned development candidate; not notarized or a replacement for the published v0.1.5 Release. Probe/user-data/logs remain private, not packaged.

Implementation is in Review, not a claim that every end-user gate is Done. Genuine multi-session model traffic and MacBook/iPhone visual/keyboard/network experience still need their own acceptance. Encrypted outbox/draft migration and mobile persistent-cache adoption are separate future scope, not silently included. No refactor merge into running main, remote push, service restart, public release, signing, Hermes core/plugin change or real model run was performed.
