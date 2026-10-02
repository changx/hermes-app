# Composer blur background isolation

**Subsequent iPhone feedback:** screenshot `att_57ebb182c9ad4d2e8ede71965cc67177` still shows blurred input text after this deployment. The sibling-layer attempt did not resolve the reported symptom; do not treat the automated checks below as native acceptance. The next isolated iOS fallback is documented in [iOS composer native-blur fallback](m1-ios-composer-no-native-blur.md), not deployed yet.

## Scope and diagnosis

Card: `t_64d903f8`. Jamie reported intermittent blurred input text with the iOS Chinese keyboard and supplied a screenshot. The image shows blurred input glyphs while the composer border and send button remain sharp. This is consistent with a native compositing/layer-order issue, but the cause has not been reproduced on a device.

The previous composer supplied the running row and editable input/accessory as `BlurView` children. Inspection of installed `expo-blur` 57.0.3 (`src/BlurView.tsx`) shows that Expo itself renders a `NativeBlurView` followed by those children inside a shared View: it is **not** proof that UIKit intentionally blurs its children. The candidate makes the background/foreground separation explicit outside that wrapper, adds stable native foreground and outer Views (`collapsable={false}`), and orders the sibling layers with `zIndex: 0/1`. This is a targeted layering fix, not a verified upstream bug diagnosis.

Reference checked: [Expo SDK 57 BlurView documentation](https://docs.expo.dev/versions/latest/sdk/blur-view/). Its dynamic-list ordering warning is a separate documented issue; it does not establish the cause of this input-text symptom.

## Candidate change

- One shared shadow/tinted surface remains inside the existing KeyboardStickyView.
- One childless, absolute-fill BlurView is the non-interactive background (`pointerEvents="none"`). Existing intensity, tint and Android BlurTargetView/method remain unchanged.
- A separate, non-collapsible foreground View contains the running indicator/stop and normal input or complete attachment composer, including menus/previews.
- No input keys, input remount workaround, keyboard offsets, selection callbacks, send behavior, list geometry or foreground tint changed.
- The transparent jump-to-latest row stays outside this surface. No dependency/lockfile, plugin, protocol, Gateway or Hermes core change.

## Local verification

Evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/composer-blur-background/`.

- Mobile TypeScript passed (`typecheck.log`). An initial use of `StyleSheet.absoluteFillObject` failed against RN 0.86 types; replaced it with explicit absolute edges.
- Focused composer/reaction/attachment and keyboard/navigation tests: 65/65 passed (`targeted.log`). Assertions check a single childless background, explicit sibling order/layers, stable native foreground, input draft, normal/accessory paths, running/stop, shadow and latest-row transparency.
- Full mobile suite: 355/355 passed on rerun (`tests-rerun.log`). First attempt lacked the generated client bundle in the new worktree; built it with the existing esbuild dependency. The subsequent run hit the existing outbox test's short-timer assertion (`remote.queries.length >= 2`), 354/355; retained that log, changed no outbox code, and reran successfully. These failures are recorded, not omitted.
- iOS and Android Expo exports passed (`export-ios.log`, `export-android.log`). `verification.json` records actual JS hashes and confirms `composerBackdrop`/`composerForeground` are present in both exported bundles.
- `git diff --check` passed.

Component tests use RN substitutes and do not exercise UIKit compositing or Chinese IME rendering. No claim of native visual resolution is made.

## Deployment and device acceptance

The initial candidate `c8d8200` was isolated on `jamie/composer-blur-background`, based on `111953a`, and was not deployed during implementation. Runtime then pointed to the isolated `session-history-layout-stability/apps/mobile` tree.

Jamie subsequently authorized main merge and publication. At release time Expo had already returned to main (`5ce253b`), including the history-layout, execution-state and pull-hint changes. The candidate merged that current main in isolation; integration TypeScript, 99 focused composer/keyboard/attachment/history tests, and both platform exports passed. No dependency or lockfile change; existing dependencies were reused without npm ci.

Main fast-forwarded to `1ad47246bf4b90a71e87a546e4db1160fa3a3d90`, preserving all current history behavior. Only `hermes-app-expo.service` restarted (PID `3981665`, main apps/mobile cwd verified). Public iOS/Android manifests and their exact launchAssets returned HTTP 200 with SDK 57 and the explicit blur-background/foreground markers, retained history hint/divider/layout and native blur settings. Both Gateways' PIDs/start times and installed development plugin file hashes are unchanged. No Gateway/plugin/core/config/chat-data changes, remote push, or signed-build release.

Release evidence is under the same private evidence directory's `release/`: before/after service and plugin hashes, `release-verification.json`, per-platform manifests, bundles/snippets, integration test/typecheck/export logs and verifier. The verifier initially expected single-quoted JSX string literals; inspected the actual retrieved bundle, corrected it to accept Metro's double-quoted literals, and passed both platforms without changing deployed code.

Rollback baseline: local branch `rollback/composer-blur-before-1ad4724` at `5ce253b`; normal rollback is an explicit `git revert c8d8200f08b9bb3cabe72d91e957e96c323bb26b` followed by an Expo-only restart, without overwriting chat data. Entry remains `exps://agent.tuly.space`; reload Expo Go to load the new bundle. Native iPhone visual/IME acceptance remains pending.

After authorized deployment, iPhone acceptance must cover Chinese nine-key composition/candidate selection, single/multiline input and clear-after-send, repeated keyboard open/interactive dismissal, background/foreground, attachment menu open/close, running status appearing/disappearing, draft/selection retention and scroll position. Public bundle checks cannot substitute for this acceptance.
