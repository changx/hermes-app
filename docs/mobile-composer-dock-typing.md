# Mobile composer dock drops while typing

Jamie reported (2026-11-14): on the session page, the input area does not stay above the keyboard while he types. It drops to the bottom of the screen, as if no keyboard were open. More typing does not bring it back. Closing and opening the keyboard brings it back, and then it drops again.

- App: TestFlight build (iOS, runtime `b32a4b59…`).
- Keyboard: the third-party Chinese keyboard from [form keyboard background events](form-keyboard-background-events.md), and also the iOS system keyboard.
- Stable trigger (Jamie): the composer text wraps to a new line.

Branch `diag/composer-dock-typing`. Only the mobile client changes.

## Cause (from source; device confirmation pending)

- The session page wraps the timeline in `KeyboardGestureArea` with `offset={composerHeight}` (since `ef42eb5`). `composerHeight` is the composer card height + 14.
- On iOS, keyboard-controller 1.22.7 makes this offset an invisible input accessory view on the keyboard (`KeyboardAreaExtender`, created at `keyboardDidAppear`). A new offset calls `InvisibleInputAccessoryView.updateHeight`, which changes the keyboard frame while the keyboard is open.
- A line wrap changes the composer height, so every wrap resized the keyboard accessory. The dock (`KeyboardStickyView`) gets its iOS position only from keyboard-controller `onKeyboardMoveStart` events. After the resize the dock sat at its closed position until the next real keyboard open.

The exact UIKit event order for this resize is not captured yet. The diagnostic below records it.

## Change

- `ChatTimeline.tsx`: the `KeyboardGestureArea` offset (`gestureOffset`) follows the composer height only while no keyboard is shown. A keyboard-controller `onEnd` with height > 0 freezes it. `onEnd` with height 0 or RN `keyboardDidHide` releases it and takes the current composer height.
- The composer expands on focus, before `keyboardDidAppear`, so the accessory still gets the expanded composer height.
- Limit: during interactive dismissal of a multi-line composer, the gesture area starts at the height that the composer had when the keyboard opened.

## Diagnostic (temporary)

`src/keyboardTrace.ts` keeps the last 240 events of the session composer in memory:

- keyboard-controller `onStart`/`onEnd`: height, progress, duration, target;
- RN `keyboardWillShow`, `keyboardDidShow`, `keyboardWillChangeFrame`, `keyboardDidChangeFrame`, `keyboardWillHide`, `keyboardDidHide`: end frame;
- composer focus and blur, text length and line count (never the text), dock layout, `dockFollowsKeyboard`, App state;
- with each event: the library height and progress shared values, the RN keyboard metrics and the dock window position (`measureInWindow` in the next frame).

When the keyboard hides (or the App leaves foreground) after typing, the buffer goes to the connected Hermes as one `console` client log (`keyboard-trace hide`), at most once per 15 seconds. Nothing shows in the UI. See [client error logs](client-error-logs.md). Remove the diagnostic after the device confirms the fix.

## Verification

- New test in `tests/session-entry-composer.test.mjs`: with the keyboard open, composer layouts of 66 and 88 keep the offset at 58; after the hide the offset is 102; RN `keyboardDidHide` alone also releases it. It fails on unchanged `main` (`keyboard open: a line wrap keeps the offset`) and passes on the branch.
- `tests/keyboard-trace.test.mjs`: no upload without typing or without a reporter; the text is not recorded; throttle; buffer limit.
- Full mobile suite with `ESBUILD_BINARY_PATH` and `HERMES_TEST_CHROME`: 276 tests, 276 pass, 0 fail, 0 skipped. TypeScript passes.
- These are JS tests with native substitutes. iPhone acceptance: type until the composer wraps to 2, 3 and more lines, with the system keyboard and the third-party keyboard. The composer must stay directly above the keyboard.
