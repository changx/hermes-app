# Mobile ChatGPT-style composer

Jamie asked to copy the default and focused input area from two ChatGPT iPhone screenshots (`att_810c8d61642f4c35a5f6c974bd8a940b` default, `att_6cabac4b37ff4f01a6945ba6098d5737` focused). Branch `feat/mobile-chatgpt-composer`, baseline main `ec21215`. The desktop equivalent is [desktop session composer](desktop-session-composer.md); this change reuses its colors.

## Measured reference (3× screenshots, 440pt wide)

- Default: one pill, 48pt tall, fully rounded, about 39pt side margins. `+` is inside the pill on the left (center 24pt from the edge). The placeholder follows it. A microphone and a 32pt round Send (gray when empty) are on the right; Send is about 8pt from the edges.
- Focused: the card widens to about 13pt side margins and grows to about 91pt. The text line spans the card (about 20pt padding). A tool row below holds `+` on the left and a model label, microphone and the 32pt round Send on the right. The card sits about 12pt above the keyboard.

## Implementation

- New `ComposerCard` (`apps/mobile/src/ComposerCard.tsx`) is shared by the session composer (`ChatTimeline`, through `AttachmentComposer`) and the channel new-topic composer (`NewTopicComposer`).
- Not focused: a white 48pt pill, radius 24, `#e5e5e5` border, soft shadow and 36pt side margins. The tool row (`+`, Send) is placed over the single text line, and its middle passes touches to the field.
- Focused: the same card widens to 12pt side margins. The text line spans the card (padding 14/16pt), and the 46pt tool row is below it. The empty focused card is about 88pt tall.
- The field and its `TextInput` keep the same tree position in both states. Focus and blur only change styles. The input is never remounted or refocused, so the existing native multiline, the iOS `numberOfLines=1` empty reset, the six-line limit and keyboard tracking stay unchanged.
- Send is a 32pt round button with a white `↑`: `#1f2329` when ready, `#d7d7d9` when disabled. The accessible name stays `Send`. `+` is a 36pt dark glyph that still changes to `×` while the attachment menu is open.
- The legacy full-screen new-topic editor keeps its old `+`-and-actions row (`AttachmentComposer` without `send`).
- Not copied: microphone, model label and suggestion chips. Hermes has no matching function in this place, and controls without a function are not added. The translucent dock, its shadow, the running row with Stop, the attachment menu/previews and the jump-to-latest row stay unchanged.

## Verification

- Mobile TypeScript passes. Mobile tests pass in the worktree (107 total, 0 failed, 1 skipped). The new test checks the 48pt pill styles, the expansion on focus, the identical input node after focus, and the gray/black Send states.
- iPhone appearance, focus animation with the Chinese keyboard and Android keyboard dismissal (which can keep focus and so keep the card expanded) need device acceptance.
