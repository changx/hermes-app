# Desktop session composer and left user bubbles

## Desktop Session code background correction

The latest desktop request sets Session code backgrounds to `rgb(245,245,250)`. This supersedes the earlier blue-tinted inline/fenced code colors. Inline code, single-line/multiline fenced and indented code, and existing safe tool command blocks use the same background. Nested fenced `code` remains transparent so the enclosing `pre` supplies one surface. Foreground colors, fonts, padding, radii, wrapping, message content and behavior stay unchanged. Mobile and browser-side HTML rendering are outside this correction.

Candidate `fix/desktop-code-background`, card `t_a3d4c44b`, starts from main `142381c` independently of the pending browser-sidebar candidate. The production-DOM regression fails on the baseline's inline `rgb(220, 229, 240)` and passes after correction. Chromium checks user/direct/final messages, inline/table code, single-line/multiline fences, indented blocks and safe commands at 720/1280/1800px, including forced dark mode. Desktop typecheck/build and **49/49** tests pass with Chromium headless-shell and Linux/Xvfb Electron enabled, zero skips. An initial parallel Electron extraction caused `Text file busy`; completing the locked binary installation and rerunning the same checks passed. Evidence: channel workspace `desktop-code-background/`, including computed colors and failed/successful logs. No main merge, release, mobile/plugin/core change or service restart. Installed macOS visual acceptance remains pending.

## Desktop clipboard attachment paste

### Published: Desktop v0.1.30

Jamie authorized main merge and publication. Candidate `9e8b9ca` was fast-forwarded into main with version commit/tag source `6bc013065daa2a10b3159659f8e99cc69f971af5`. Main retains the prior session-tail fix `0a617d4`. Only version metadata changed in the release source after candidate verification; the dependency graph is unchanged. No mobile deployment occurred.

- [Desktop v0.1.30](https://github.com/changx/hermes-app/releases/tag/v0.1.30) is published, not a draft. Assets: `Hermes-0.1.30-macOS-arm64.zip` and `.sha256` sidecar.
- Existing tag CI `37248833278` and main CI `37248832621` passed macOS arm64 toolchain, checks, audit, packaging and archive verification, then failed because Actions artifact storage quota was exhausted. No old artifacts were deleted and no billing setting was changed.
- Additive manual workflow `.github/workflows/desktop-direct-release.yml` builds an existing version tag on macOS arm64, verifies an explicit source SHA, runs the same gates, then uploads directly to Release without Actions artifact transfer. It refuses an existing release and never moves a tag. Workflow commits `9f00435` and `66163d9` leave application sources unchanged. The first direct attempt failed on macOS Bash empty-array expansion under nounset; the fixed workflow uses a nonempty argument array.
- [Direct release run 37249121112](https://github.com/changx/hermes-app/actions/runs/37249121112) passed all gates and publication. The tagged application source remains `6bc0130`; the workflow ran from main `66163d9` and checked out that exact tagged source.
- Downloaded archive passed sidecar SHA-256, complete ZIP CRC, Mach-O arm64 and plist/ASAR version `0.1.30`. Packaged main, preload and renderer are byte-identical to the verified candidate build. Both paste handlers, File byte conversion, main validation, tab target checks and upload cleanup are present. SHA-256: `742d721eed09119ab45d035f1df057261d8983d4f44c01833695d1088a81184b`.
- Runtime checkout/dirty AGENTS.md, Expo/Gateway PID/start-time readbacks, installed plugin code hashes and mobile lockfile hash are unchanged. No service restart, plugin/core/other-profile write, Mac installation, signing or notarization.

Private evidence: Channel workspace `desktop-paste-attachments/release/`, including failed/successful CI logs, immutable downloaded assets, archive/code verification and before/after snapshots. Installed macOS Cmd+V, Finder copied files and keyboard review remain pending. The archive is an unsigned, non-notarized Apple Silicon development build. Rollback package is intact v0.1.29; source rollback requires an explicit scoped revert of `9e8b9ca`, not clearing drafts or chat data.

The following paragraphs record candidate-stage behavior and checks, not an unpublished current state.

Candidate `feat/desktop-paste-attachments` starts from main `0a617d4`. Card: `t_5b6da349`. This is a desktop-only implementation, not a published update.

- Paste clipboard files or screenshots into the Message textarea or the New chat first-message textarea. Handle the native `paste` event, not a global Command-V key interceptor. Pure text keeps the browser default. File-bearing paste does not insert an accompanying filename/path into the message text.
- Existing conversations upload to the requesting tab's exact Thread and retain attachments in the existing persistent draft. Paste does not send. New chat retains files locally until explicit submit, then uses the authoritative created Thread for upload and send. Existing text remains unchanged.
- Keep eight files per message and 1 byte–10 MiB per file. Reject known draft capacity/size overflow before upload. Keep existing busy protection, failure feedback, partial-upload cleanup, tab target authorization and authenticated transport.
- Preload keeps disk-backed files as validated paths. For a pathless clipboard File, preload reads its bytes and sends only its filename and bounded Uint8Array through the existing attachment IPC. Main validates the complete request and actual disk-read bytes before any upload. No global clipboard access, new renderer filesystem access, generic IPC, external clipboard service or temporary screenshot file.
- Root/desktop dependency graph and lockfile remain unchanged. Isolated locked dependencies were installed because the existing dependency link lacked Node/React type declarations. No mobile, plugin, Hermes core, main merge, version bump, signing, service restart or publication.

Verification: desktop TypeScript and main/preload/renderer build pass. `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 npm run desktop:check` passes all **48 tests**, with zero failures/skips. Six new production-component/preload/main-service regressions cover pure-text fallback, exact target, draft preservation, explicit send, remaining capacity/size rejection, duplicate busy paste, error recovery, New chat deferred upload, mixed disk/byte files, invalid IPC payloads and partial cleanup. The native Electron/Xvfb test writes a real OS clipboard image and uses WebContents paste in both production textareas. It verifies contextBridge File handling, draft persistence, no automatic send, removal and real plain-text paste. Transport/storage remain controlled fixtures; this is not live backend or macOS device acceptance.

Test corrections: replace invalid PNG fixture with a native bitmap, use the pinned Electron ClipboardItem API, wait for the disabled composer to become ready before refocusing for text paste, and wait for attachment-removal layout before the existing reading-anchor assertion. Add bounded retries for the sidebar Chromium profile cleanup race; do not weaken its UI assertions. Earlier failed runs remain in private evidence.

Local artifact: isolated worktree `apps/desktop/dist`. Private evidence: Channel workspace `desktop-paste-attachments/`. macOS screenshot Cmd+V, Finder copied files, native menu paste, multiple-file paste and installed-app keyboard behavior remain device review items. No new macOS installer or Release is claimed.

## Desktop default font size candidate

### Simple desktop text-size settings (published in v0.1.23)

Jamie authorized main merge and publication. Verified candidate `065de52` was fast-forwarded into main; release source and tag `v0.1.23` are `535935ecc6c924dd7898cfc6b26237cce4902bab`. Only desktop/root version metadata changed after candidate checks; the dependency graph and verified application sources are unchanged.

- [Tag workflow 37186467078](https://github.com/changx/hermes-app/actions/runs/37186467078) passed macOS arm64 checks, dependency audit, native packaging and publication. Release-source main workflow `37186467068` also passed.
- [Desktop v0.1.23](https://github.com/changx/hermes-app/releases/tag/v0.1.23) is published, not a draft. Downloaded `Hermes-0.1.23-macOS-arm64.zip` passes sidecar SHA-256, ZIP CRC, arm64 executable and plist/ASAR version `0.1.23`. Packaged CSS is byte-identical to the verified candidate; renderer markers confirm default 16, Settings/Text size, 12–24 options, local read/write, startup initialization, reset and save-failure messaging.
- SHA-256: `9fe6e8a56cbb92f7b86faed7958d1e7027e86eb3becaf465febcfdbf83694a78`. Private readbacks, CI logs, downloaded archive and verifier: Channel workspace `desktop-font-settings/release/`.
- No mobile deployment, plugin/core change, service restart or Mac installation. Expo and development Gateway PID/start-time readbacks are unchanged. The archive remains unsigned and not notarized; Mac keyboard/visual acceptance is still pending. Rollback package is intact `v0.1.22`; do not clear device preferences, drafts or chat data.

The following paragraphs record the candidate implementation and automatic checks before publication.

Latest request supersedes the fixed 18.4px proposal: provide a simple local setting with **16px default**. Candidate `feat/desktop-font-settings` continues from `880095b`; card `t_5b1d1261` tracks the update.

- Open the bottom-left Settings gear, then choose Text size from 12–24px in 1px steps. Changes apply immediately to interface, message text, code and tool commands. Reset to 16 restores and saves the default. Settings is also available before pairing.
- Save only the non-sensitive device preference in renderer localStorage under `hermes.desktop.font-size`. Initialize the CSS variable before React mounts; reopening the app restores the value. Invalid/out-of-range values use 16 without overwriting storage. Failed reads/writes show a clear message in Settings; failed saves keep the current text usable without claiming persistence.
- Use a native modal dialog rendered into document.body, outside sidebar selectors. Focus enters Text size and returns to the Settings button on close. Suppress background application shortcuts while this dialog is open. Do not add zoom shortcuts, server fields, credential access or dependencies.
- Preserve existing margins, padding, gaps, sidebar widths and icon/button dimensions. Retain the previous necessary relative text line heights and label clipping-height adaptation; no page zoom or layout redesign.
- Desktop TypeScript/build and all **153 tests pass**, with no failures/skips. Production Chromium checks actual Settings interaction, 12/16/18/24px UI/content/code/tool text, unchanged spacing/icons and message DOM identity, default reset, saved value readback, cold restoration in a second browser process, pre-pair access, focus restoration and storage failure/recovery. Existing narrow/wide typography, draft and label/layout regressions also pass.
- Candidate-check evidence: Channel workspace `desktop-font-settings/check.log`. Publication is recorded above; Mac installed-app and keyboard/visual acceptance remain pending. No mobile/plugin/core/main-process changes or service restarts.

### Font-only follow-up: 18.4px (not published)

Jamie reported that three `alt+=` presses make the text readable but enlarge spacing, then restricted the fix to font size and existing fixed line heights. Candidate `fix/desktop-font-18-4` starts from `b4cf2d8`; card `t_5b1d1261` continues tracking the same feedback.

The pinned [Electron 44.4.5 Zoom In role](https://github.com/electron/electron/blob/v44.4.5/lib/browser/api/menu-item-roles.ts) adds 0.5 to zoomLevel per action. [Chromium's conversion](https://github.com/chromium/chromium/blob/main/third_party/blink/common/page/page_zoom.cc) is `1.2 ** zoomLevel`. Assuming a 100% start and that the user's key triggers this role, three actions give `14 * 1.2 ** 1.5 = 18.40347793217358px`, approximately 18.4px. This is not a readback of the user's shortcut binding or zoom state.

- Set the shared UI/content default to 18.4px and remove the two remaining 14px text overrides. No zoom controls, settings, persistence, spacing redesign or platform/server changes.
- Replace fixed composer/tool text line heights with 1.5. Replace fixed label line height with 1.15; its clipping containers follow the line plus unchanged 4px vertical padding. Do not change margins, padding, gaps, sidebar widths, icon sizes, button dimensions or input height limits.
- TypeScript/build and all 149 desktop tests pass, with zero failures/skips. Chromium checks production text at 720/1280/1800 widths, line heights, original composer padding, unchanged 42px icon buttons, draft non-overlap and existing label/layout regressions. The one-line textarea naturally grows to about 47.6px to fit the text; this is not page zoom.
- Evidence: Channel workspace `desktop-font-18-4/check.log`. No main merge, release, service restart or Mac installation; real-device visual acceptance remains pending. The v0.1.22 record below describes the prior 14px publication.

### Authorized publication: v0.1.22

Jamie authorized main merge and desktop packaging/publication. Candidate `f0f99bc` was fast-forwarded into main; release source and tag `v0.1.22` are `222436c918588a5537af761d975b98c9b089145f`. Only desktop/root version metadata changed after candidate verification; dependency graph, mobile and shared client source are unchanged.

- [Tag workflow 37184663874](https://github.com/changx/hermes-app/actions/runs/37184663874) passed macOS arm64 checks, dependency audit, packaging and publication. Main workflow `37184663825` also passed.
- [Desktop v0.1.22](https://github.com/changx/hermes-app/releases/tag/v0.1.22) is published, not a draft. Downloaded `Hermes-0.1.22-macOS-arm64.zip` passes sidecar SHA-256, ZIP CRC, arm64 executable, plist/ASAR version `0.1.22` and byte-exact packaged CSS comparison with the verified candidate. SHA-256: `646a89c44b97f0a18da914d8c9b950e2a5d6de308a33b366a909db2f742379ea`.
- No mobile deployment or service restart. Expo and development Gateway PID/start-time readbacks are unchanged. No plugin, Hermes core, signing or device installation changes.
- Private evidence: Channel workspace `desktop-font-14/release/`. The package remains unsigned and not notarized; installed Mac visual acceptance is pending. Rollback package is intact `v0.1.21`; source rollback requires an explicit revert, not storage changes or replacement of published assets.

The following paragraphs describe the pre-publication candidate checks, not the current publication state.

Jamie requested a desktop default of **14px for UI and content**. Candidate `fix/desktop-default-font-14` starts from main `d675836`; tracking card `t_5b1d1261`.

- Root text, native form controls, navigation, dialogs, status text, timestamps, labels, draft text, message paragraphs/lists/tables, inline/fenced code and tool commands use the shared 14px default. Preserve icon sizes, colors, layout rules and behavior. Mobile is unchanged. This supersedes the earlier desktop 11px draft-text size only.
- Chromium computes the production components' text size at widths 720, 1280 and 1800. The regression fails on the baseline's 16px root and passes after the change. Existing browser geometry and draft non-overlap tests also pass.
- Desktop TypeScript, build and all 149 tests pass, with no failures or skips. Private evidence: Channel workspace `desktop-font-14/baseline.log` and `desktop-font-14/check.log`.
- Candidate only: no main merge, publication, service restart or Mac installation. Installed macOS visual acceptance remains pending. The build produces desktop main/preload/renderer assets, not a newly published macOS installer.

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

At the candidate stage, not merged/pushed/published and no service restart or plugin/core deployment. Publication is recorded below. Mac/iPhone visual, scrolling, keyboard and accessibility device acceptance remain pending. Expo exports are not independent installers.

## Published: Desktop v0.1.15 and mobile test entry

Jamie authorized main merge and release. `f748cc9` (hide assistant times) and `62755a1` (80% width/public-work toggle) were fast-forwarded into main with release commit `abb2faf108b50d7c40480cee0593609c972cd6dc`. Root/desktop/lock versions now agree at 0.1.15; the lockfile diff changes only those version fields, not dependency graph. The verified candidate production sources are unchanged. Remote main and tag `v0.1.15` were read back at that code commit.

- [Desktop v0.1.15](https://github.com/changx/hermes-app/releases/tag/v0.1.15) is published, not draft. macOS arm64 CI `37161338038` and main CI `37161337233` both succeeded, including checks, audit, packaging and checksum gates. Downloaded archive SHA-256 `0f5973228303d36e456268d73b7c256a763e9aee555ace77d9f945d79129bf49` matches the published checksum. Top-level app plist/ASAR version is 0.1.15 and its binary is arm64. Packaged code/CSS confirms 80% intrinsic bubble, divider, hidden assistant time, work labels, explicit completion expansion guard, toggle and preserved live pages. The package is unsigned and not notarized.
- Mobile `exps://agent.tuly.space` is updated at the same code commit. Public iOS/Android SDK57 manifests and their exact launchAssets returned HTTP 200 and contain all changed production presentation paths. iOS SHA-256 `25ba27442f39de4a8ef7c838ad349774c7596acb20015051cfcf0a2e7464a9ff`; Android `e205600b79635eee776afc0510a886a1e672526dab5900816b4cc0de1fa2b84c`. The initial request during restart returned 502; later readiness and both complete asset checks passed. Only Expo restarted (PID 3172610 → 3631682); both Gateway service snapshots, installed development plugin hashes and mobile lockfile remain unchanged.

Evidence: active Channel workspace `collapsible-work/release/`, including baseline snapshots, downloaded archive/ASAR, CI log, packaged verifier and per-platform manifests/exact JS bundles. Device installation, signing/notarization, Gateway/plugin/core changes, App Store and TestFlight are not included. Mac/iPhone visual/keyboard/accessibility acceptance remains pending. Mobile is Expo Go testing, not an independent installer. Desktop rollback: reinstall v0.1.14; source rollback requires scoped reverts of these two client commits and an Expo restart, preserving unrelated main work and all chat data.
