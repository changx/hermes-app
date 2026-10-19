# Mobile composer: tap to collapse and dock reset

Jamie asked for two changes on the session page:

1. A tap on the session page must also collapse the input box.
2. Bug: after the keyboard closes, the input box sometimes stays at the position of the open keyboard.

Branch `fix/mobile-composer-tap-collapse`, baseline main `62e192c`. Only the mobile client changes (`apps/mobile/src/ChatTimeline.tsx`).

## Collapse rules

The composer expands when its input has focus and collapses when the input loses focus ([ChatGPT-style composer](m1-composer-chatgpt.md)). The input loses focus, and the composer collapses, when:

- the user drags the message list down (iOS interactive dismiss, Android on-drag; unchanged);
- the user taps a blank area or plain message text on the session page (new);
- the App leaves foreground ([dismiss keyboard on inactive](m1-dismiss-keyboard-on-inactive.md); unchanged);
- the page closes (native Stack `keyboardHandlingEnabled`; unchanged).

A tap on a pressable control keeps the keyboard open and the composer expanded. These controls include buttons, links, the copy button, code blocks (tap to copy), images and the work toggle. Tool lines and table text are selectable text, not pressable controls; a tap on them can collapse the composer like plain text.

The timeline scroll view now uses RN `keyboardShouldPersistTaps="handled"` instead of `"always"`. With `handled`, RN gives the tap to the control when a child view takes the touch. Otherwise the scroll view takes the tap and blurs the focused input on release, but only when the tap did not scroll. Plain `Text` without a press handler does not take the touch (RN 0.86.3 `Text.js` `isPressable`), so taps on message text collapse the composer. This replaces the earlier rule in [tool timeline](m1-tool-timeline.md) that kept the keyboard open for taps on non-button text.

RN dismisses on tap only when it saw a software keyboard open (`_keyboardIsDismissible`). With a hardware keyboard, a tap on the page does not end input.

## Dock reset

The dock is the `KeyboardStickyView` that holds the jump-to-latest button, requests, the running row and the composer. keyboard-controller 1.21.9 moves it by the keyboard height shared value. If the library misses a hide event, the height keeps the open value and the dock stays above the bottom. One known case: `Keyboard.dismiss()` runs while the App leaves foreground, and the hide happens while the App is not active. Similar upstream reports: [#1411](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1411), [#1526](https://github.com/kirillzyusko/react-native-keyboard-controller/pull/1526) (Android fix; not in 1.21.9). The exact iPhone event order for Jamie's report is not captured. This fix does not depend on one trigger.

The dock now uses the library `enabled` prop:

- The dock follows the keyboard while a dock input has focus (composer or clarify answer field), and while a keyboard starts to open (`onStart` with height > 0).
- After the last dock input loses focus, the dock keeps following the keyboard during the hide animation. When the hide settles, the dock is released and sits at the bottom (`enabled=false` gives `translateY = closed = 0`).
- Any one of these signals releases the dock when no dock input has focus: keyboard-controller `onEnd` with height 0, RN `keyboardDidHide`, the App returning to foreground, or the page becoming active again.
- A clarify request that settles can remove its focused answer field without a blur. The focus record for a removed request is cleared.

After a normal hide, the released position equals the followed position (both 0), so release causes no movement. The list bottom padding still comes from the library value. A missed hide can leave extra blank space below the last message until the next keyboard open and close. This fix does not change that.

## Verification

- New tests in `tests/session-entry-composer.test.mjs`: `handled` on the timeline; dock release after the controller hide, after RN `keyboardDidHide` alone, and after foreground return alone; dock kept while the input has focus; dock taken by a keyboard that starts to open; a focused answer field holds the dock; a removed request releases it.
- The 3 new tests fail on the unchanged `ChatTimeline.tsx` (red check) and pass on the candidate.
- Mobile `npm test` with `HERMES_TEST_CHROME` and the matching `ESBUILD_BINARY_PATH`: 225 tests, 225 pass, 0 fail, 0 skipped.
- Mobile TypeScript passes. iOS and Android `expo export` (`--no-bytecode`) pass; both bundles contain the `composer-dock` marker and the timeline `keyboardShouldPersistTaps:"handled"`.
- These are JS tests with native substitutes. iPhone acceptance is required: tap on blank space and on message text collapses the composer; tap on copy/link/code keeps the keyboard; switch apps with the keyboard open and return; drag the keyboard down; the dock must sit at the bottom in each case.
