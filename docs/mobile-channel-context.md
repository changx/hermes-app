# Mobile Channel: sessions and context

## Confirmed direction

Jamie approved the mobile-first redesign in `th_a6e883886ccc4b00b9dbc80fde91728e` on 2026-10-02. Session lists now put latest activity first at the top; this supersedes the old channel-list bottom-first rule. Conversation timelines still open at their latest message at the bottom. Desktop is out of this change.

The Channel page prioritizes its session list. Full Context is replaced by a compact, accessible `Channel context` row with an information symbol and chevron. Channel rename is in the options menu; session rename is available through long press and a labelled accessibility action, without permanent edit icons on every row. The existing first-message/attachment composer remains below the list.

## Implemented candidate

- Ordinary FlatList, descending `last_message_at`, no inversion, automatic scroll or content-position anchoring that could override latest-first entry. Filter archived and other-Channel sessions; keep running indicator and last-message time. List key is separate from the composer key.
- Native Expo Router `channels/[channelId]/context` route validates its opaque ID, uses the existing keyboard-safe layout and renders loaded Context using the existing Markdown component. No catalogue prefetch or second authoritative store.
- Context view supports add, edit, clear, save and cancel. Editor retains its draft on failure or temporary route interruption. Native back/gesture removal uses `usePreventRemove` with discard confirmation; in-flight saves block navigation and duplicate submissions.
- Only `description` is patched from the Context editor, so another device's channel rename is not overwritten. Save is followed by exact-channel detail readback; mismatch/failure retains the draft and does not claim confirmed success.
- Channel rename patches only `name`, without reading or sending cached Description. No change to Description initialization/compaction behavior: the summary applies to new sessions, not existing conversations.
- Loading failures have explicit retry; pending reads abort on blur and late results are fenced. Built-in text is English.

## Channel directory and AGENTS.md: accepted phase 2, not implemented

A Channel should own a stable server-side directory independent of its display name. Context is a brief summary; root `AGENTS.md` holds lasting working conventions; Files contains reference documents and outputs. The dedicated AGENTS.md editor must operate on the same real file visible in Files, not a database copy. Shared files do not share conversation histories. Directory ownership alone is not a filesystem sandbox, and storing files does not automatically inject all files into every model request.

Read-only inspection of the installed `hermes-app-dev/plugins/hermes-app/adapter.py` found Channel CRUD/detail, thread attachments/media and catalogue endpoints, but no Channel Files/AGENTS.md API. `LiveSessionClient` also exposes only Channel detail/CRUD here. Consequently the candidate has no nonfunctional Files/AGENTS buttons and does not alter the plugin or Hermes core.

Phase 2 must verify plugin-based directory binding, existing-project/attachment migration, authorised relative-path reads/writes, symlink/traversal handling, concurrent-save conflict detection and the real execution/AGENTS loading extension point, including exactly when edited rules take effect. Missing core extension points must be reported, not patched around.

## Verification

- Mobile TypeScript: passed, zero diagnostics.
- Targeted ordering/context/editing/router/English checks: 28 passed, zero failures.
- Complete mobile suite: 430 tests, 429 passed, zero failures, one optional Chromium table-layout test skipped. Existing test assumptions for bottom-first lists and permanent rename icons were updated to the approved interaction; new component tests exercise production handlers rather than only copied sort logic.
- Both iOS and Android Expo exports succeeded. Exact generated bundles contain the Context route/editor, session rename action and save-verification error markers; bundle hashes are in private evidence.
- Candidate dependencies were copied from the unchanged installed mobile lockfile baseline because Metro cannot resolve dependencies outside its watched tree through the initial symlink. No dependency installation or lockfile changes. Generated offline Markdown renderer and shared client test bundle were built before checks.
- Private logs: active-profile `workspace/hermes-app/mobile-channel-context/` (`mobile-tests.log`, `typecheck.log`, `export-ios.log`, `export-android.log`). No tokens or chat data in these artifacts.

Native UI primitives/navigation in the component tests are substitutes. Exports are not an independent signed mobile package and do not prove iPhone usability. Physical-device checks remain: enter Channel at top, live activity reorder, long-press/VoiceOver rename, Markdown context view, keyboard and long-context editor, cancel/back discard prompt, save during weak network, then return to the Channel composer with its draft/attachments intact.

## Candidate delivery boundary (before publication)

Candidate branch: `feat/mobile-channel-context`; base: `f14b251`. Kanban: `t_f0e49193` (old ordering supersession noted on `t_47ae9b11`). No main merge, public push, Expo deployment, service restart, plugin install, core edit, desktop change or other-profile write. Deployment and iPhone acceptance remain separate. The attempted synchronization of the repository's protected AGENTS.md instruction file was denied by the approval guard; it remains unchanged.

## Publication outcome

Jamie subsequently authorized publication. Client commit `dff8a41575bacbde22cd9d0d54bdc0a5e0ee1aad` was fast-forwarded and pushed to `origin/main`; only the existing user-level `hermes-app-expo.service` restarted. No dependency install or repeat full tests/exports: the candidate gates above were reused and the mobile lockfile hash remained unchanged.

Public iOS and Android manifests and each manifest's exact launchAsset returned HTTP 200, runtime `exposdk:57.0.0` and SDK `57.0.0`. The served modules contain the compact Context link/native route, ordinary top-first session list, channel/session rename options, Context-only patch/readback and draft discard guard, while retaining the first-message composer. Both Gateway PIDs/start times and installed plugin hashes were unchanged.

Entry: `exps://agent.tuly.space` (Expo Go test deployment, not an independent package). Private before/after service evidence, plugin/lock hashes, manifests, exact bundles, module excerpts and `release-verification.json`: active-profile `workspace/hermes-app/mobile-channel-context/release/`. Rollback baseline is `f14b25112f2fd1bb4d4a45705cdef212338c1bdd`; revert `dff8a41` and restart only Expo if needed, without altering server/chat data. Physical iPhone acceptance and phase-2 Channel workspace/Files/AGENTS.md remain pending.
