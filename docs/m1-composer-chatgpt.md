# Mobile ChatGPT-style composer

Jamie asked to copy the default and focused input area from two ChatGPT iPhone screenshots (`att_810c8d61642f4c35a5f6c974bd8a940b` default, `att_6cabac4b37ff4f01a6945ba6098d5737` focused). Branch `feat/mobile-chatgpt-composer`, baseline main `ec21215`. The desktop equivalent is [desktop session composer](desktop-session-composer.md); this change reuses its colors.

## Measured reference (3× screenshots, 440pt wide)

- Default: one pill, 48pt tall, fully rounded, about 39pt side margins. `+` is inside the pill on the left (center 24pt from the edge). The placeholder follows it. A microphone and a 32pt round Send (gray when empty) are on the right; Send is about 8pt from the edges.
- Focused: the card widens to about 13pt side margins and grows to about 91pt. The text line spans the card (about 20pt padding). A tool row below holds `+` on the left and a model label, microphone and the 32pt round Send on the right. The card sits about 12pt above the keyboard.

## Implementation

- New `ComposerCard` (`apps/mobile/src/ComposerCard.tsx`) is shared by the session composer (`ChatTimeline`, through `AttachmentComposer`) and the channel new-topic composer (`NewTopicComposer`).
- Not focused: a white 48pt pill, radius 24, `#e5e5e5` border, soft shadow and 12pt side margins (36pt until the focus-motion fix below). The tool row (`+`, Send) is placed over the single text line, and its middle passes touches to the field.
- Focused: the same card keeps its width (it widened from 36pt to 12pt margins until the focus-motion fix below). The text line spans the card (padding 14/16pt), and the 46pt tool row is below it. The empty focused card is about 88pt tall.
- The field and its `TextInput` keep the same tree position in both states. Focus and blur only change styles. The input is never remounted or refocused, so the existing native multiline, the iOS `numberOfLines=1` empty reset, the six-line limit and keyboard tracking stay unchanged.
- Send is a 32pt round button with a white `↑`: `#1f2329` when ready, `#d7d7d9` when disabled. The accessible name stays `Send`. `+` is a 36pt dark glyph that still changes to `×` while the attachment menu is open.
- The legacy full-screen new-topic editor keeps its old `+`-and-actions row (`AttachmentComposer` without `send`).
- Not copied: microphone, model label and suggestion chips. Hermes has no matching function in this place, and controls without a function are not added. The translucent dock, its shadow, the running row with Stop, the attachment menu/previews and the jump-to-latest row stay unchanged.

## Verification

- Mobile TypeScript passes. Mobile tests pass in the worktree (107 total, 0 failed, 1 skipped). The new test checks the 48pt pill styles, the expansion on focus, the identical input node after focus, and the gray/black Send states.
- iPhone appearance, focus animation with the Chinese keyboard and Android keyboard dismissal (which can keep focus and so keep the card expanded) need device acceptance.

## Development release

Released `a833e89` to `exps://agent.tuly.space` (fast-forward from `ec21215`, lockfile unchanged). Only `hermes-app-expo.service` was restarted (PID 4134099 → 1292938). The `hermes-gateway.service` PID 1180321 and the hermes-app-dev plugin did not change. The public iOS and Android manifests return HTTP 200 with SDK 57. Each exact launchAsset returns HTTP 200 and contains the new card markers, and the old blue square Send is absent. Evidence: private `workspace/hermes-app/mobile-chatgpt-composer/`. Rollback baseline: `ec21215`. iPhone acceptance is pending.

## Focus change: one width and animation

Jamie reported that on the session page the input changed width when focus changed, and that the change between the two states had no animation. Branch `fix/mobile-composer-focus-motion`, baseline main `9009979`.

- The card keeps 12pt side margins in both states. The 36pt collapsed margin from the ChatGPT measurement is removed. Only the height and the inner layout change on focus.
- Reanimated layout transitions animate the change over 220ms (ease-out cubic):
  - The card frame uses a custom transition. It starts at the old height on the new bottom edge, so the card grows upward and does not cover the keyboard. When the card shrinks, its bottom edge also stays fixed.
  - The text wrapper and the tool row use `LinearTransition` with the same timing. The text moves from the pill line to the top line, and the tool row stays on the bottom edge.
- The same transitions apply when a line wrap changes the card height.
- All transitions use `ReduceMotion.System`. With Reduce Motion on, the new layout applies at once.
- The `TextInput` keeps one tree position. It is now inside one `Animated.View` wrapper in both states, so focus changes do not remount it.
- The dock and the message list still change height at once. Only the card and its parts animate.
- The shared `ComposerCard` also serves the channel new-topic composer, so that composer gets the same width and animation.
