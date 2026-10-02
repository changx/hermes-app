# New-topic and new-channel constrained layout candidate

Continuation of `t_6d9ddce9`, based on main `7fefae5`. The new 2026-10-01 iPhone screenshot shows the current full-screen editor, not the former EditorSheet. The first-message border and attachment/create controls overlap, with a large gap above the keyboard.

## Confirmed defect and scope

`NewTopicEditor` assigned the native TextInput `flex: 1` and `minHeight: 180` directly alongside its attachment/footer. The minimum can exceed the space left after keyboard avoidance. Candidate gives the input a stable non-collapsible native flex slot, removes its 180pt minimum, and gives the attachment/create footer a separate non-shrinking native wrapper. No input remount/key, draft reset, focus command, keyboard dismissal, submission/attachment API, dependency, shared protocol or server change.

This fixes a demonstrated overflow constraint, not a verified explanation of all screenshot geometry. Shared `FormKeyboardAvoidingView` remains unchanged. Its retained keyboard padding and native app-switch event order are still possible contributors to the large gap; this candidate does not claim to resolve them. Previous failed EditorSheet foreground toggles and screen/window frame calculations were not reintroduced.

## Actual local verification

Private evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/new-topic-resume-layout/`.

- Executed RN's pinned Yoga C++ sources with the old and candidate flex constraints. Available-height sequence 766 → 436 → 240 → 180 → 120 → 436 → 766: old footer overflow is 34/94/154pt in the three smallest cases; candidate footer stays within the padded root in every case. This is an actual layout-engine probe with synthetic viewport sizes, not native iPhone event playback. Its simplified two-child tree models the bounded input slot/footer and does not exercise UIKit text layout or attachment menus.
- Executed production editor with React test renderer: bounded native input slot, zero input minimum, non-shrinking footer, retained multiline draft and one input mount across repeated updates. RN hosts are substitutes, not device acceptance.
- Targeted new-topic, form keyboard, attachment and router keyboard tests: 33/33 passed.
- Full serial mobile suite: 381/381 passed.
- Mobile TypeScript passed after generating the existing Markdown renderer in the fresh worktree. First check's missing generated module is recorded; no source workaround was added.
- iOS and Android Expo exports passed on rerun. First exports could not resolve expo-router from a symlinked dependency directory outside Metro's watch roots; replaced that worktree symlink with a private copy of the already installed dependencies, without npm ci, lockfile or Metro configuration changes. Original failure logs retained.

## New-channel follow-up (requested by Jamie)

The first candidate `09fa8a7` covered New topic only. New channel had the same `flex: 1` / `minHeight: 180` description constraint, with additional name, explanation and create controls. The follow-up wraps the description in a stable non-collapsible flexible native slot, overrides its minimum to zero, and keeps the name and grouped explanation/create controls non-shrinking. Normal layout spacing and creation APIs remain unchanged.

Executed production-component regression confirms both input identities, Chinese multiline drafts, repeated updates, failed-create draft/error retention and subsequent successful creation. This uses a synthetic client and substituted RN hosts, not network/device acceptance. Pinned Yoga C++ channel probe models a 44pt name, 38pt explanation, 44pt action, actual gaps/padding, and native description padding/border. In viewport sequence 766 → 436 → 280 → 240 → 220 → 436 → 766, the old create button overflows 86/126/146pt at the three smaller heights; the candidate stays in bounds. This remains a synthetic geometry probe, not iOS lifecycle playback; extreme sizes smaller than all fixed controls or larger accessibility text require separate acceptance.

Follow-up checks: targeted channel/topic/form/router tests 24/24; full serial mobile suite 382/382; TypeScript and iOS/Android exports passed. Exact exported bundles contain both editors' layout markers; hashes are recorded in `channel-export-verification.json`. The first full-suite run was 381/382 because an existing source assertion required the obsolete 180pt description minimum. Updated that layout expectation to zero minimum/stable slot/non-shrinking footer and reran successfully; original failure log retained. No keyboard boundary, dependency, lockfile, core or backend changes.

## Delivery boundary

Isolated branch `fix/new-topic-resume-layout`; not merged, deployed, pushed or signed. Main Expo bundle and all Gateway/plugin/core state unchanged. Do not close the parent keyboard acceptance card from these checks.

After publication authorization, verify public iOS/Android manifests and exact launchAssets. iPhone acceptance must include Chinese nine-key multiline drafts, keyboard show/hide, repeated inactive/background/active transitions while typing, attachment menus/previews and returning from pickers. Check input/footer bounds, remaining keyboard gap, retained text/selection, and keyboard/focus behavior. If the large gap persists, capture lifecycle and native root bounds in a separate scoped diagnosis rather than claiming this overflow fix is complete.
