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

## Navigation cleanup and running composer row (isolated candidate)

User requested removing `Select channel` and correcting the missing `Agent is running` presentation. Continue from `0d69e5d`; card `t_a8372411`.

- Delete the redundant tree action and its unused CSS selector. Expanding/collapsing the Channel still does not forcibly leave the current Session. The Channel plus and Session selection remain unchanged.
- Match current mobile `runningRow`: a compact 32px row above the input contains three scaling dots and `Agent is running`, with the independent Stop button on the right (34×28px). The input row contains only plus, textarea and send.
- Use the selected Session's authoritative directory running state. Idle, no selection and a different running Session do not create this row. Offline cached state shows `Reconnecting…` with no dots and disabled Stop; pending selected-session interaction shows `Waiting for your response` with no dots. These states do not claim active work.
- Three CSS dots use mobile colors and staggered scaling. Reduced-motion mode disables their animation. Stop remains available during an in-flight send when connected and does not clear the draft. Running status does not replace or disable the ordinary send action.

Final desktop TypeScript/build and **113/113 tests** passed, with 0 failed/skipped. Production-component tests cover removed navigation action/no forced navigation, selected running/idle/no selection/pending/offline state, completion retaining the draft, resumed running, independent Stop/Send and Stop while send awaits confirmation. Real Chromium checks 720/1280/1800px input and Stop geometry and both regular/reduced-motion dot styles. The content/layout/palette/security regressions remain passed.

Evidence: current profile Channel workspace `desktop-running-row/`, with final check log, layout readback and regenerated production-component preview. Synthetic preview content is not a live model execution or native Mac screenshot. No main merge/push/release/installer/service restart/mobile/protocol/plugin/core/dependency/lockfile change; native Mac acceptance remains pending.

## ChatGPT-style user bubbles and hidden sender names (latest isolated candidate)

Jamie requested the desktop counterpart to the mobile candidate `fa8ecc0`. This decision supersedes earlier left blue bubbles, full-width blue blocks and visible sender-name rules. Desktop baseline `9c41f17`; branch `fix/desktop-chatgpt-message-style`; card `t_4059e0a8`.

- Hide sender names for all chat rows. Keep valid timestamps on full messages. Assistant continuations still omit repeated timestamps; missing timestamps do not leave an empty header.
- User bubbles align right, with a 14px right gutter. Their maximum width equals 60% of the timeline width after deducting both 14px gutters (`calc(60% - 16.8px)`).
- Use `width: fit-content`, automatic height, `#f3f3f3` light gray, 22px corner radius, and 13px vertical / 14px horizontal padding. Prose remains left aligned.
- Preserve assistant and final backgrounds, tool records, Markdown, attachments, timestamps, receipts and actions, message ordering/identity, history, navigation and composer handlers.
- The change is desktop-only. The mobile candidate remains separate; no mobile/shared/plugin/core/lockfile change, service restart, main merge or publication occurred.

New production component and Chromium assertions failed against the baseline, then passed after implementation. Chromium checks at 720/900/1280/1800px and resize back to 720 cover short prose, long prose, long nested lists, wide tables, long code and attachment preview containers. Bubbles stay within the cap, align right, retain left-aligned prose, contain their complete height and do not overlap following messages. Tables keep local horizontal scrolling. The short timestamped message stays content-sized at every window width.

Desktop TypeScript, main/preload/renderer build and all **120 tests passed**, with **0 failures and 0 skips**, using `/usr/bin/google-chrome`. The built artifact is `apps/desktop/dist`. Private evidence: active-profile `workspace/desktop-chatgpt-message-style/`, including baseline failure, full check log, production DOM geometry and preview HTML/PNG. The preview uses synthetic fixture messages, not a live conversation or native Mac screenshot.

No new installer, signing, push, Release or native installation. Installed Mac visual, scrolling and keyboard acceptance remains separate. The card stays in review.

### Authorized publication: Desktop v0.1.14

Jamie then authorized main submission and publication of both desktop and mobile candidates. Merge `8138302` retains candidate `4600dd4`; release source `986bbcb72c3a95ad49ed12c419bdd0c75e93be8a` was pushed to main and tag `v0.1.14`. Existing main live-session-page changes were retained. Root/desktop versions and root lockfile version metadata changed to `0.1.14`; dependency entries did not change.

- [Tag workflow 37132500437](https://github.com/changx/hermes-app/actions/runs/37132500437) passed locked installation, TypeScript/build/tests, audit, unsigned arm64 packaging, archive checksum and publication. Main workflow `37132499705` also passed. The prior local real-Chromium 120/120 checks remain the browser geometry evidence; CI does not convert optional browser skips into native acceptance.
- [Desktop v0.1.14](https://github.com/changx/hermes-app/releases/tag/v0.1.14) is published, not draft, with `Hermes-0.1.14-macOS-arm64.zip` and its checksum sidecar.
- Downloaded archive SHA-256 matches the published sidecar: `8c274cb7f798b80f91595c28e46ef74d314bfb00f20bfcb3a6507b4e71bd0e11`. The executable is Mach-O arm64. Plist and ASAR package versions are `0.1.14`.
- Packaged CSS confirms intrinsic width, right alignment, the gutter-adjusted 60% cap, gray rounded background and left-aligned prose. Packaged renderer confirms timestamp-only message headers and retained live session pages.
- Mobile public iOS/Android manifests and exact launchAssets passed SDK57/current-code verification. Only Expo restarted; Gateways and installed plugin hashes remained unchanged.

Private evidence: active profile `workspace/chatgpt-style-release/`, including downloaded archive/ASAR, packaged code readback, release metadata, CI logs and mobile service/resource verification. Publication card `t_1a24c734`. The package is unsigned and not notarized. No signing account, App Store, EAS/TestFlight or device installation change. Installed Mac/iPhone visual and keyboard acceptance remains pending.

Desktop rollback: reinstall intact `v0.1.13`. Source style rollback uses `git revert -m 1 8138302`; mobile style rollback uses `git revert -m 1 2883bdb` followed by only an Expo restart. Preserve concurrent main changes and all chat data.

## Latest follow-up: hide Agent reply times (isolated candidate)

Jamie requested removing Agent reply timestamps on both platforms. Candidate `fix/hide-agent-timestamps`, baseline `559ca04`, card `t_626cc866`. This supersedes timestamp retention for assistant messages only. User and system timestamps remain visible. Missing/hidden assistant times leave no empty header. The stored timestamps, identities, ordering, grouping, final background and tools remain unchanged.

The implementation adds a non-assistant guard to the existing desktop/mobile timestamp presentation. Production regressions fail against the baseline and pass after the change. Desktop TypeScript/build and **120/120** tests pass with real Chromium and no skips. Mobile TypeScript and **506/506** tests pass with no skips. Serial iOS/Android exports pass; both exact output bundles and the built desktop renderer contain the assistant timestamp guard. Tests cover commentary, tools, final/direct replies, cold history, user timestamps and system notices. Existing geometry checks retain non-overlap and bubble alignment.

Private evidence: active profile `workspace/hide-agent-timestamps/`, including baseline failures, checks, production DOM preview and exact exports. Isolated root dependencies were installed because the first dependency link did not expose a desktop-local package. No lockfile or dependency graph change. Temporary Metro visibility paths were restored after export. No main merge, push, publication, service restart, version bump or device installation. Native visual review remains pending.

## Latest follow-up: 80% user width and collapsible public work (isolated candidate)

Card `t_5a04dba0`, branch `fix/collapsible-work`, baseline `f748cc9`. Both clients retain hidden Agent timestamps and use an 80% user-message cap, with intrinsic width/height, right alignment, left-aligned content and gray background. Desktop deducts the shared gutters before applying the percentage. Previous 60% records are historical.

Public assistant process messages between explicit final/direct boundaries share a toggle above the first loaded process row and a divider below its title. User follow-ups/system notices remain visible at their original positions. Real running state displays `Working`; final arrival immediately invalidates active expansion overrides and collapses process records before paint. Completed history starts collapsed; a user can reopen the exact commentary, command and attachment components. A later ordinary refresh preserves that choice; the next group is independent. Messages retain their IDs/order and mounted content. No tools are marked successful by the toggle. Internal reasoning remains excluded by the existing projection.

`Worked for {duration}` measures the first **loaded public process** timestamp to the explicit final timestamp, not server/model execution time. No turn ID or execution-duration field is available in the present client contract. Partial pagination measures only its loaded segment. Missing, invalid or backwards time shows `Worked for —`; stopped/legacy process without a final uses `Work recorded`, not a false completed/running claim. A direct reply without process has no invented work header. No server/core changes or fetching outside the page's existing history window.

Verification: shared SDK and both platform TypeScript checks passed; desktop build plus **124/124** tests passed with Chromium and no skips; mobile **507/507** tests passed with no skips/cancellations. Browser production React exercises active/manual collapse, explicit-final automatic collapse, zero collapsed height, divider, exact-content reopen, same-final refresh, new process and cold-page defaults. Production mobile component callbacks test the same transition. Existing browser rich-content/resize checks verify the 80% cap, shrink-wrap, gutters and containment. Mobile history/keyboard/animation regressions remain intact.

Serial, clean iOS/Android exports succeeded. Exact Hermes bytecode artifacts contain `80%`, work title/hidden styles, completion and accessibility strings: iOS `index-b2b36c45906bdd5554086fc346fbc152.hbc`; Android `index-e09fd7b3da79cb35d73babe9bb7c93d0.hbc`. This bytecode inspection does not replace component behavior tests or device acceptance.

Private evidence: active Channel workspace `collapsible-work/`. Initial browser failure was test output exceeding its buffer; remove the inline script before DOM output rather than hiding assertions. Initial mobile history test selected the newly added work header as the message root and stalled during failed renderer cleanup. Keep the original message root stable and select it by content, then verify the same native root survives prepends. Both previously failing cases and full suites now pass. Temporary Metro visibility paths were restored; no lock/version changes.

Not merged/pushed/published; no service restart or plugin/core deployment. Mac/iPhone visual, scrolling, keyboard and accessibility device acceptance remain pending. Expo exports are not independent installers.
