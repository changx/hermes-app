# Mobile history hint and reading divider

## Scope and baseline

Jamie approved a quiet top pull hint and asked to respect the language version. A direct follow-up additionally requested a previous-reading marker after loading older history; chose a text-free divider.

This candidate starts from current main `0160cfe`, which already includes the accepted FlashList layout fix and subsequent history-state client changes. It does not roll back to an older UI release. Branch/worktree: `jamie/session-history-pull-hint`.

The existing mobile app is English-only: inspected UI sources and the existing `english-ui.test.mjs` contract, with no locale selector/translation layer. Keep new labels English; no automatic device-language detection or application-wide localization expansion.

## UI behavior

- Fixed 44pt header slot inside the list, naturally visible at the loaded-history top, not floating over messages.
- Idle with earlier history: `↓ Pull down for earlier messages`.
- After native refresh intent and before observed drag release: `Release to load`.
- Started request: spinner and `Loading history…`.
- Completed and exhausted: `Start of conversation`.
- No false start-of-conversation label while empty or locating. Existing locate text/button stays below the slot.
- The existing release-only RefreshControl, duplicate ownership, focus/background cancellation and failure retry are retained. No guessed pull-distance threshold, timers, extra HTTP call or new top scroll command.

The header space is present from initial layout in all states. This is an added constant height compared with the old UI; status changes do not insert/remove height. One-line text uses the existing font-size wrapper and the full accessibility label; loading status is polite.

## Previous-reading marker

When older keys prepend during a history load, mark the previously first displayed key. A thin, text-free line is attached to that original message root, not inserted as a new data item or row.

- Absolute position at the row top, hairline height, no row-height/margin additions.
- Decorative, ignores touch and accessibility.
- Only real Cells paint it, not measurement/sticky copies.
- Persists when scrolling away/back and remounting the row. The next older batch moves the single marker to its own old/new boundary.
- Clears when the marked key leaves the displayed window or the thread changes.
- Existing message root styles and memo identity remain intact. Memo comparison includes the new flag so adding/removing the decoration updates correctly.

FlashList, type prediction, render-ahead, stable keys, native anchor, 5-block publication, fade and independent tail repair remain. No SDK/protocol/dependency/backend/core change.

## Verification

- 7 new production-component regression tests: all hint states with the same native slot; empty/locating action preservation; canceled/failed retry; marker key/remount/next batch/thread reset; unsolicited initial/append exclusion; deliberate drag during an active load; assistant/tool/notice roots.
- Existing history pull suite: 22/22.
- Full mobile suite: 374/374, including existing English UI, keyboard, fade, layout, 5-block, and current history-state client regressions.
- TypeScript and diff check pass.
- Both Expo exports pass. Actual minified JS checked for all English labels, keyed real-cell marker wiring and absolute hairline styling; Unicode escapes and minified local names are handled rather than requiring source spelling.
- Tests substitute native views/timing. They verify configuration, identity, lifecycle and absence of new application-level scroll commands; they are not physical iPhone layout/visual proof.

Evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-pull-hint/`.

Local-only candidate: no merge, public deploy or service restart in this task. Phone visual acceptance remains pending.

## Follow-up: vertical padding

After de31f03 was published, Jamie asked for space above and below the divider. The new local candidate adds `paddingVertical: 8` around an inner hairline, with horizontal margins matching messages.

The padded separator is a sibling before the original message root, inside the same keyed FlashList cell. An always-present React Fragment adds no native wrapper and keeps the original message subtree stable when the marker moves. This also avoids turning the row-oriented system-notice layout into a padded column. The separator now intentionally consumes layout height; it is no longer an absolute overlay.

Hidden Measurement renders include the same spacer as real Cells, avoiding a shorter preliminary measurement. Sticky copies still exclude it. FlashList continues to own layout/anchor correction; no new application scroll commands. Padding/measurement parity, original native-root identity and existing hint/boundary behavior are covered by the 374 passing mobile tests. TypeScript, both exports and actual compiled padding/inner-hairline checks pass.

This follow-up is local-only, not merged or deployed. Phone reading/visual acceptance after the height change remains pending.

## Follow-up: remove conversation-start text

The latest user requirement removes `Start of conversation` from the mobile list header. Complete history now has no hint text or accessibility label. Keep the existing fixed-height header slot to avoid changing message layout. Earlier-history, release and loading hints, the reading divider and locate actions remain unchanged.

Candidate branch: `fix/remove-conversation-start`, based on current main `a1e2e3c`. Three regressions execute the actual production hint initializer and verify exhausted, partial, release, loading, empty and locating states. These and four timeline identity/follow tests pass. Mobile TypeScript and iOS/Android exports pass. Tests do not prove iPhone visual behavior. No main merge, public deployment or service restart is included.
