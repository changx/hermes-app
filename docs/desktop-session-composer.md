# Desktop session composer and left user bubbles

## Confirmed behavior

- Desktop new-session dialog provides a Channel selector, title and file selection/removal (including drag/drop). Command-N defaults to the selected Channel, or the first available Channel when none is selected.
- Channel tree rows expose a new-session button on hover and keyboard focus. Clicking it opens the same dialog with that row's Channel selected without first navigating away from the current conversation.
- Attachment uploads are scoped to the new session's authoritative returned ID. The existing upload API requires an existing session: files stay local until Create session, then upload into its message draft. They are **not automatically sent**. Cancel before creation does not create a session or upload files.
- Creation retries preserve the original client identity and Channel/title. Upload failures preserve files and retry the already-created session instead of creating another. An existing empty session is not silently deleted when continuing without files.
- Desktop composer uses the mobile palette, translucent dock, compact inline plus/stop/send controls, attachments above the input, and bounded content-sized multiline input (42–120px). Enter sends; Shift-Enter and composing IME input do not. Running tasks keep separate stop and send actions.
- Desktop user messages include the You byline, Markdown and attachments inside a pale-blue rounded bubble aligned left. Mobile user bubbles now also align left, with the small corner on the left. Short text remains content-sized; wide tables/media retain bounded viewports.
- Alignment is intended to become a user preference in a later change. This candidate does not introduce a nonfunctional settings control or persistence schema.

## Implementation boundary

Initial candidate: client-only isolated branch `feat/desktop-session-composer`, based on `f14b251`; no publication at that stage. Subsequent authorized publication is recorded below. No plugin/shared-server protocol changes or Hermes-core modification.

Desktop bridge changes are narrowly typed Channel/Thread arguments and an authoritative created Thread ID return. Existing main-process file validation, preload File-to-path extraction and authenticated upload APIs remain in use. No new filesystem or general IPC access is exposed to the renderer.

A pinned root **dev-only** `react-test-renderer@19.2.3` dependency supports executable production-component regressions in desktop CI without installing the mobile workspace; no application framework or runtime dependency was added.

## Verification

- Desktop `npm run desktop:check`: TypeScript/build successful; **99 passed, 5 skipped, 0 failed**.
- New executable UI/service regressions cover hovered/default Channel, selector change, cancel before any writes, explicit returned upload target, immediate duplicate submit, dismissal during pending work, failed upload retry without duplicate creation, same creation identity after failure, invalid files, Channel toolbar/Command-N wiring, IME/Shift-Enter, independent stop/send and partial-upload cleanup.
- Mobile `npm run check`: passed. Mobile `npm test`: **417 passed, 1 skipped, 0 failed**; existing production bubble regression now asserts left alignment and corner radii.
- iOS and Android Expo SDK 57 exports: passed. These are JS/resource exports, not independently installable mobile packages.
- Root dependency audit (including dev tooling): 0 vulnerabilities. Mobile locked dependency installation reports 15 existing findings (11 moderate, 4 high); no broad dependency upgrade/audit fix was performed in this UI task.
- Additional Chromium geometry tests for normal/standalone/user-bubble tables and shell layout could not be executed successfully: the available Chromium binary hangs when started with an isolated user-data directory, including a minimal diagnostic data-URL page. Five optional browser tests are kept skipped in the successful normal gate; their failed opt-in run is retained in private evidence. Do not report browser geometry or visual verification as passed.

## Pending review

Mac: native file picker/drag-drop upload, dialog focus, Channel hover toolbar, resizing and long-input behavior; installed Electron layout, scrolling and keyboard feel.

iPhone: left blue bubbles with text, tables and attachments; keyboard/scrolling and retained composer experience. Independent installers/release and real-device acceptance are not delivered by this candidate.

Tracking: default Kanban `t_85324483`. Private evidence: active-profile `workspace/desktop-session-composer/`.

## Authorized publication

Jamie subsequently authorized main merge and publication. Candidate `e2cc7fa` merged with main `1c4d584` without replacing the concurrent mobile Channel Context changes. Release source `4e1641279c979083e8c9222dfc04dcf5a7878529` was pushed to main and tag `v0.1.9`.

- Integrated desktop targeted tests: 23 passed / 1 browser skip; mobile targeted tests: 44 passed / 0 skips; both TypeScript checks, desktop build and iOS/Android exports passed. Candidate full suites were not repeated as a release-stage substitute for device acceptance.
- macOS arm64 tag workflow [37030529221](https://github.com/changx/hermes-app/actions/runs/37030529221) passed locked installation, desktop checks (99 passed / 5 browser skips), zero-finding dependency audit, native packaging, archive checksum and publication. Main workflow also passed.
- [Desktop v0.1.9](https://github.com/changx/hermes-app/releases/tag/v0.1.9) contains the unsigned, non-notarized Apple Silicon ZIP and checksum sidecar. Downloaded assets were verified: SHA-256 `f1a36fa25d5e7f813474251db69f98690fe5dc1ba26badb49c706c64f6d1337c`; plist/ASAR version `0.1.9`, Mach-O arm64, and packaged Channel selector/explicit upload scope/hover creation/mobile composer/left blue bubble code markers. No native installation was performed by this publication.
- Mobile Expo Go entry `exps://agent.tuly.space` updated. Public iOS and Android manifests and their exact launchAssets returned HTTP 200, SDK `57.0.0`, runtime `exposdk:57.0.0`; served code verifies left blue bubbles/left corner/media bounds while preserving Channel Context, latest-first lists and first-message composer.
- Only user-level `hermes-app-expo.service` restarted. Both Gateway PIDs/start times, installed plugin hashes and mobile lockfile hash remained unchanged. Root locked dependencies were restored because the dev-only test dependency changed; no mobile dependency installation or Gateway/plugin/core/other-profile/signing/EAS/store changes.

Publication card `t_f8af393d`; private readbacks, service/hash snapshots, exact bundles, CI logs and downloaded-asset verification: active-profile `workspace/desktop-session-composer/release/`. Implementation remains in review for the native checks above; publication does not convert skipped browser or physical-device tests into passes.

Rollback: reinstall intact Desktop `v0.1.8`; revert release metadata commit `4e16412` and feature merge using `git revert -m 1 d3aafa5` (baseline `1c4d584`), then restart only Expo for the mobile rollback. Preserve concurrent Channel Context changes and all server/chat data; do not reset or overwrite storage.

## Desktop palette follow-up (isolated candidate)

User confirmed: discard the desktop warm beige/brown combination. Use white and neutral light gray application chrome, with the existing mobile semantic colors. Candidate `feat/desktop-mobile-palette`, baseline `591ffc2`, card `t_24175050`.

- White conversation/forms/dialogs; `#f9fafb` application/navigation background; `#f3f4f6` rail/hover; `#e5e7eb` dividers; `#d1d5db` form borders.
- Neutral UI text `#1f2937`, secondary `#6b7280`, labels `#4b5563`.
- Actual mobile colors: blue general actions `#2960ad`, chat send `#285ea5`, links `#215ca7`, selected navigation `#e6edf7`, user messages `#e6f0ff`, final replies `#f7f5ef`.
- Code/tool commands use mobile pale `#e8eef6` and text `#20314a`; inline code `#dce5f0`; table headings `#e5ecf5`. Error and running colors match mobile. Final/approval pale warm colors remain semantic highlights, not application chrome.
- Explicit `color-scheme: light`; Electron startup background `#f9fafb`. Small local CSS variables centralize neutral chrome. No new theme framework, mobile change, protocol/plugin/core/dependency/lockfile edit or behavioral change.

Verification: `HERMES_TEST_CHROME=/usr/bin/google-chrome npm run desktop:check` passed TypeScript, build and all **107 tests**, with **0 skipped/failed**. Chromium computed-style checks cover production React navigation, conversation, composer, pairing, new-session form, Markdown/code/table/tool/error styles at 720/1280/1800px under forced OS dark mode. Existing Markdown/table/bubble/composer geometry tests pass. `git diff --check` passes.

Private evidence is in the current profile Channel workspace `desktop-mobile-palette/`: computed colors, production-component HTML, PNG and final check log. Preview messages are synthetic, not a live conversation or macOS screenshot. Pairing and new-session forms are in hidden probe containers, so their computed styles do not prove native interactions.

No main merge, push, Release, service restart or Mac installation. Local `apps/desktop/dist` is built; this candidate has no new macOS installer or native visual acceptance. Those checks remain separate; the implementation card stays in review.

## Latest Session content follow-up (isolated candidate)

User subsequently requested applying the latest mobile Session content display design to desktop. This overrides the old desktop content-sized blue-bubble rules above. Continue the neutral palette candidate from `283f636`; card `t_22bde83d`.

- User messages are full available-width `#e6f0ff` blocks, with no outer border, rounded corners, 80% limit or content-type-specific width.
- User and final backgrounds reach both timeline edges. Ordinary assistant, user and final bylines/prose all start at the same 14px inset. Text does not touch the window edge.
- Final replies retain `#f7f5ef` and 32px top separation, but lose the left decoration. Existing vertical spacing is retained.
- Continuous process grouping, safe compact captions and terminal command blocks remain unchanged. Message order/identity, timestamps, receipt actions, approvals, attachments, Markdown, table-local scrolling and composer/scroll handlers are not rewritten.
- Only content CSS and tests changed, plus this documentation. No mobile, shared protocol, plugin, core, dependency or lockfile changes.

Verification: newly added source/real Chromium assertions failed on the prior palette candidate (old gutter/bubbles) and passed after the layout change. DOM checks at 720/900/1280/1800px and resize back to 720 cover short prose, long nested lists, wide tables, attachment preview containers, continuous process and final replies. Both edges align, names/prose share the inset, content remains within row height, following rows do not overlap, and wide tables scroll locally rather than widening the timeline. Existing production composer geometry and Markdown/table checks also pass. Final desktop TypeScript/build and **110/110 tests** pass with no skipped/failed tests; `git diff --check` passes.

Evidence: current profile Channel workspace `desktop-session-content/`, including baseline failure, final check log, layout metrics and updated production-component preview HTML/PNG. The preview contains synthetic example content, not a Mac screenshot or live model execution. This is a client layout change, not a new tool capture implementation.

No main merge, push, installer release, native installation or service restart. Mac visual/keyboard acceptance and publication remain separate. The updated local desktop artifact is in `apps/desktop/dist`.
