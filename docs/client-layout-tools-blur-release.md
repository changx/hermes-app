# Client layout, file captions and iOS composer fallback release

Jamie authorized merging/submitting the preceding client candidates and publishing the existing mobile test entry. This release does not include the proposed Hermes/Discord shared-preview fix.

## Published changes

Based on main `7fefae5`, integrated isolated candidates as:

- `f3368ba` (candidate `09fa8a7`): bounded New topic input, independent non-shrinking attachment/create footer.
- `a0ee693` (candidate `a4dac1b`): bounded New channel description, non-shrinking name and explanation/create controls.
- `a83663f` (candidate `989da96`): shared mobile/desktop compact file-tool basenames, including multi-file Editing; preserve full safe paths in details/titles.
- `6ce95edd62dd537c8e971e1cbc81ed8abf072c08` (candidate `0e467dc`): iOS composer uses existing translucent tint/shadow without native BlurView; Android keeps its native blur. This is a fallback, not proof of the native root cause.

The code release is `6ce95ed`. Desktop source is merged and built/tested; no desktop install package, version bump/tag, remote push, signing, EAS/TestFlight or store release was made. Mobile remains Expo Go development testing at `exps://agent.tuly.space`, not an independent installation package.

## Verification and service scope

Combined isolated candidate passed mobile TypeScript, full serial mobile 384/384, desktop typecheck/build + 73/73, shared-client 24/24 + 20/20 + 36/36, both Expo exports and diff check. No dependency or lockfile change; reused installed dependencies, no npm ci during integration/publication. Did not repeat those suites during publication.

Main fast-forwarded to `6ce95ed`. Only `hermes-app-expo.service` restarted: PID 116034 → 721378, start 2026-10-01 18:32:12 PDT, process cwd verified as main `apps/mobile`.

Public status reports `packager-status:running`. Public iOS and Android manifests and each manifest's exact launchAsset returned HTTP 200, SDK 57. Verified both editors' zero minimum and non-shrinking footer markers, new file-caption helper, full-detail entry, retained tinted/shadow foreground, KeyboardStickyView and history pull behavior. iOS's emitted ChatTimeline mounts no BlurView; Android retains method/intensity/tint path. Manifest/asset readback evidence is not iPhone acceptance.

Both monitored Gateways (hermes-app-dev and Jamie) keep their exact PID/start/working-directory state; installed development plugin source/metadata hashes are unchanged. No plugin installation, Gateway restart, Hermes core modification, profile configuration change or chat-data operation.

Private evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/client-layout-tools-blur-release/`: integration logs, before.json, verifier, manifests, exact bundles/module snippets and release-verification.json.

LaunchAsset SHA-256:
- iOS: `8da549b503bcaaa4bc7a1c2e3edd7af30371293e20a79e56047de1bd6a504445`
- Android: `fb2e12133d1fe9a4260d216bc34c42c864b34f6de4e0fe40d361e41add325187`

## Native acceptance and rollback

Reload the Expo Go project to fetch this code. iPhone still needs Channel/Topic drafts + keyboard/background/foreground bounds, compact single/multi-file tool rows + expanded details, and English/Chinese IME input clarity with keyboard/menu/running/stop transitions. Do not mark the earlier native blur issue fixed solely because native blur was removed in emitted resources.

Rollback baseline branch `rollback/client-layout-tools-blur-before-6ce95ed` points to `7fefae5`. Normal rollback is explicit Git reverts of `6ce95ed`, `a83663f`, `a0ee693`, `f3368ba` in reverse application order, followed by only an Expo restart and public resource verification; do not reset/overwrite the repository or chat data.
