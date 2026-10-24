# Form keyboard: ignore background keyboard frames

Jamie reported that the New conversation page is broken after the App goes to background and back with the keyboard open. In his screenshot the composer sits at the top, below the Channel row. There is about 300 pt of blank space between the composer and the keyboard top (572 pt). The keyboard is a third-party Chinese keyboard.

Branch `fix/form-keyboard-background-events`. Only the mobile client changes.

## Cause

- Form pages (New conversation, New topic, New channel, settings, labels) use `FormKeyboardAvoidingView`. It used RN `KeyboardAvoidingView` in `padding` mode ([router keyboard](m1-router-keyboard.md)).
- A trace captured on Jamie's iPhone on 2026-10-01 shows that the third-party keyboard sends `keyboardWillShow` with `screenY`, `width` and `height` 0 while the App is in background. RN KAV computes `frame.y + frame.height - (screenY - offset)`, so the padding becomes 922 pt instead of 351 pt.
- The keyboard stays open when the App returns. No later keyboard event corrects the padding, so the page stays broken until the keyboard closes.
- The [dismiss keyboard on inactive](m1-dismiss-keyboard-on-inactive.md) workaround hid this defect. Jamie withdrew that workaround on 2026-10-18 ([tap to collapse](mobile-composer-tap-collapse.md)), so the defect came back.

## Change

`src/FormKeyboardAvoidingView.tsx` replaces RN KAV in the form wrapper. `App.tsx` re-exports it, so the pages do not change.

- Same padding formula and vertical offset (`max(headerHeight, insets.top)`) as RN KAV `padding`. Same events: iOS `keyboardWillShow`/`keyboardWillHide`, Android `keyboardDidShow`/`keyboardDidHide`. Same `LayoutAnimation` with the keyboard duration and easing.
- A show event applies only when `AppState.currentState` is `active` and `screenY`, `width` and `height` are finite and above 0. Other show events are ignored, and the form keeps the last usable frame.
- A hide event always applies, also in background, so a keyboard that the system closes while the App is away gives zero padding.
- The padding applies only while the page is focused and keyboard-controller reports a visible keyboard; otherwise the wrapper writes `paddingBottom: 0`. This keeps the retained-page rule from the router keyboard work.
- A form that opens over an open keyboard uses `Keyboard.metrics()` only when that frame passes the same check.
- The keyboard is not dismissed when the App leaves foreground. The chat composer dock is not changed.

Limit: with iOS "Prefer Cross-Fade Transitions", a real keyboard frame can have `screenY` 0. RN KAV gave zero padding in that case; this wrapper ignores the frame, which also gives zero padding from a closed keyboard.

## Verification

- New `tests/form-keyboard-background.test.mjs` uses the coordinates captured on the iPhone. It runs the installed RN 0.86.3 KAV source with the background zero frame and gets 922 pt padding (old behavior). The new wrapper keeps 351.33 pt through background zero frames, inactive frames and a foreground zero frame; the input identity and Chinese multiline draft stay. Other cases: a foreground keyboard change moves the form, a background hide gives 0, unfocused or closed-keyboard pages give 0, a page opened over an open keyboard, Android events, and listener cleanup.
- These are JS tests with native substitutes. They do not replay UIKit events on a device.
- Results: targeted tests (new file, router lifecycle, labels page) 38/38. Full mobile suite with `ESBUILD_BINARY_PATH` and `HERMES_TEST_CHROME` 240/240, 0 fail, 0 skipped; a first run without these variables had 2 esbuild binary failures and 1 Chromium skip. TypeScript passes after generating the Markdown renderer in the fresh worktree. iOS and Android `expo export --no-bytecode` pass after replacing the worktree dependency symlinks with private copies (no `npm ci`, no lockfile change); both bundles contain the `'active'===n&&…[screenY,width,height].every(…>0)` check.
- iPhone acceptance: with the third-party keyboard open on New conversation, New topic and New channel, switch apps and return several times. The composer must stay directly above the keyboard, the draft must stay, and closing the keyboard must return the page to normal.

## Development release

Released `eabefdd` (merge `eaf197b`) to `exps://agent.tuly.space`. The lockfile did not change. Before restart, the release directory passed the targeted tests (38/38) and TypeScript. Only `hermes-app-expo.service` was restarted (PID 3122984 → 197319, 19:24:55 PDT). The `hermes-gateway.service` PID 4045158 and the hermes-app-dev plugin hash did not change. The public iOS and Android manifests return HTTP 200 with SDK 57.0.0, and each exact launchAsset returns HTTP 200. The launchAssets are Hermes bytecode; the same URLs with `transform.bytecode=0` return HTTP 200 and each contains the frame check once. Evidence: private `workspace/hermes-app/2026-10-23-form-keyboard-background/`. Rollback baseline: `ac68e32` (branch `rollback/form-keyboard-background-before-release`); roll back with `git revert -m 1 eaf197b` and an Expo restart only. iPhone acceptance is pending.
