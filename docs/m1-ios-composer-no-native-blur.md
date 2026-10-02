# iOS composer native-blur fallback

Continuation of `t_64d903f8`, based on main `7fefae5`. Jamie's new iPhone screenshot (`att_57ebb182c9ad4d2e8ede71965cc67177`) still shows the input draft blurred while border and Send remain sharp. The earlier sibling-background/foreground deployment did not eliminate the reported device symptom. Do not record it as accepted.

## Minimal candidate and tradeoff

Render the existing composer `BlurView` only on Android. On iOS there is no native blur/effect view in ChatTimeline; the existing `rgba(248, 250, 253, 0.78)` surface and single shadow remain. The explicit foreground native View, white input container, running/stop row, attachment/accessory path, transparent latest row, KeyboardStickyView, safe-area offsets and keyboard gesture/list behavior are untouched.

This deliberately sacrifices iOS native frosted-glass blur for a translucent tint. It is a conservative fallback and isolation of one possible contributor, not proof that Expo/UIKit blur caused the glyph symptom. No intensity cycling, keyboard/AppState toggles, timers, forced focus, input keys or remounts are added. If the glyph symptom persists on iPhone without this native effect, investigate the native text/IME/compositor separately rather than claiming removal cured it.

Reference checked: [Expo SDK 57 BlurView](https://docs.expo.dev/versions/latest/sdk/blur-view/) describes blurring content underneath and the dynamic-content render-order caveat. That caveat does not establish the root cause of this specific input symptom.

## Verification

Private evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/ios-composer-no-native-blur/`.

- Production ChatTimeline component executed through the existing substituted-host harness for iOS and Android, with both normal and accessory composer paths. iOS mounts zero BlurViews; Android mounts exactly one childless background with unchanged target/method/intensity/tint. Existing draft, running/stop, translucent shared surface, one shadow and transparent latest row assertions pass.
- Focused composer/reaction/attachment/native-navigation/router/short-list keyboard tests: 44/44 passed.
- Full serial mobile suite: 380/380 passed (base main excludes the other pending candidates).
- Mobile TypeScript passed; iOS and Android Expo exports passed.
- Exact emitted ChatTimeline modules inspected: Metro folds the platform guard, iOS surface children start with false and contain no `.BlurView`; Android retains `.BlurView` with existing settings. Bundle hashes and snippets are saved in `export-verification.json`.
- First bundle verifier expected an unoptimized Platform.OS guard and failed after compilation removed it. Inspected actual modules and checked platform-specific emitted behavior instead; no product code changed in response. Failure is recorded, not native-device failure.
- `git diff --check` passed. No backend/protocol/dependency/core change, service restart, merge, publication or signed package.

After separate publication authorization, verify public manifests and exact platform launchAssets. iPhone acceptance must cover Chinese and English composition/candidate selection, single/multiline draft, Send/clear, keyboard open/interactive dismissal, background/resume, menu/previews, running/stop changes and draft/selection/scroll preservation. Native visuals are not covered by RN substitutes or exports.

## Discord multi-file question: read-only investigation

Inspected the pinned Hermes baseline `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`: `agent/display.py` maps patch's primary argument to `path` and has no V4A patch-specific preview builder. `gateway/run_turn_runner.py::_progress_build_message` falls back to the tool name when preview is absent. Discord's `format_tool_preview` only preserves truncated URL links; it does not extract patch file headers.

Executed the actual `build_tool_preview` with synthetic replace and multi-file V4A arguments: replace yields `/repo/src/a.ts`; mode=patch with two file headers and no top-level path yields None. Evidence `discord-preview-probe.json`. This demonstrates the compact progress-display filename gap in this pinned version, not a Discord send/device test or a failure to apply a patch. No edit execution was tested by that probe. The App-specific `path=` caption comes from its plugin passing an already-safe path summary as synthetic path; Discord did not supply that prefix. Pending shared-client candidate `989da96` addresses App compact presentation independently. Hermes core and Discord adapter remain read-only.
