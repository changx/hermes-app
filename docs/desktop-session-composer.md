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

Client-only isolated branch `feat/desktop-session-composer`, based on `f14b251`. No main merge, deployment, remote push, release, native installation, plugin/shared-server protocol changes or Hermes-core modification.

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
