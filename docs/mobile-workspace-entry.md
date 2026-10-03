# Mobile Channel Files and AGENTS.md entry

Current candidate update: [Repository AGENTS binding](channel-repository-agents.md) removes the historical 12,000-byte/native-character ceiling below. An explicitly bound repository root document is editable independently of Files initialization; workspace and repository stay separate. Original-version conflict protection remains. No deployment or physical-device acceptance is implied.

## Scope and candidate

Task `t_5ebd1858`, branch `feat/mobile-workspace-entry`, base `857a0e2`. Mobile-first implementation uses the standalone plugin's workspace contract from `docs/channel-workspace.md` in the plugin repository. No server/core changes, runtime plugin installation, Gateway/Expo restarts, desktop UI changes, dependency/lockfile changes or publication in this implementation step.

Channel retains latest-first sessions, Context link, completed-unread light-blue dot and the existing first-message/attachment composer. It adds a compact Files / AGENTS.md row only after authenticated capabilities explicitly advertise all workspace features and the native transport supports conditional writes. No header prefetch of file bodies. Unsupported direct routes explain unavailability rather than displaying a fake editor or attempting setup.

## Files

- Native Expo Router Files route validates exact channel ID and unmodified relative folder path; folder navigation uses the native Stack. Connection ID + channel + folder key isolates scene state across identities/targets.
- Workspace and Attachments tabs load paginated metadata only. Refresh/re-entry reads server state; selected files alone request bytes. Attachment inventory is available without silently creating a workspace. Listings do not read session messages or acknowledge completed results.
- Workspace creation is a user-triggered “Set up channel files” action; shared SDK POSTs an empty object and reads the exact workspace back. The UI explains that existing files elsewhere are not moved.
- Folder rows navigate deeper; root AGENTS.md opens the dedicated editor, targeting the same file. Existing attachments use their original authenticated Thread/attachment download route, not public/token-bearing URLs.
- Selected small text/source files preview as native selectable text; Markdown reuses the existing renderer. Passive PNG/JPEG/GIF/WebP images require an actual raster signature and reuse the existing native image reader. Text is limited to 64 KiB, images to 10 MiB; unsupported formats/larger files are listed with an honest unavailable-preview message and no eager download.
- One preview owns its unique private Expo cache file; real route departure aborts pending reads and cleans that file. Late completions cannot resurrect it. Temporary background is not route departure, consistent with the existing scene-retention policy.

## AGENTS.md

- Read/create/edit/clear actual root guidelines, separate from short Channel Context. User content is not trimmed, normalized or silently shortened.
- Save uses the original strong ETag, or If-None-Match:* for a missing file, and verifies exact content/version by GET before ending editing. Transport forwards only the permitted precondition headers while keeping existing Authorization ownership.
- A 412 conflict keeps local text and original version; automatic overwrite with a newly fetched version is prohibited. Review saved copy opens a native viewer; replacing the draft with that copy requires explicit confirmation.
- A lost response retains the pending attempted bytes/version. Manual retry first reads the target: identical intended content confirms success without another PUT; unchanged original version permits a conditional retry; a changed version stops for conflict review. If the user edited the local draft after an earlier save actually succeeded, that earlier save is confirmed while the newer text remains editable for a separate save.
- Back/gesture and Cancel guard unsaved content; busy save/setup settles before route removal. Temporary blur, connection recovery or capability loss do not overwrite an editing draft; reads are aborted/fenced on departure. Input is preserved on failures, without raw error text/ETags/IDs in the UI.
- UTF-8 size (not JS character count) respects the server's 12,000-byte maximum, including emoji and Chinese text; invalid/lone surrogate input is not repaired. Scope copy states that saved guidelines are available to new sessions, not that active conversations hot reload them.

## Shared-client contract

`HermesClient.workspace` exposes state/init, listing, guideline read/conditional-save, authenticated bounded file reads, mkdir and Channel attachment inventory. Responses validate exact owner identity, paths, versions, bounded page shape and cursor advancement; Unicode filename cursors use the server's code-point order. These details never enter catalogue/message/checkpoint stores.

`HttpTransport.conditionalRequest` is additive and optional. Existing transports remain type-compatible; safe writes fail explicitly if the method is absent. Native mobile JSON responses on file endpoints are bounded; binary downloads keep their existing Content-Length and 10-MiB checks. Existing sending/synchronization paths and desktop transport are unchanged.

## Verification

- Mobile TypeScript and shared-client TypeScript passed.
- Final mobile suite: 459 tests, 458 passed, zero failures, one optional Chromium table-layout skip.
- Shared-client package suite: 88 passed. Existing client unit/reliability suites separately passed 24 and 20 tests.
- New production-handler UI/preview/transport gates passed 21 tests; shared workspace contract gates passed 9. These use native-view/navigation substitutes and do not prove UIKit behavior.
- Actual candidate SDK plus native fetch transport exercised the isolated real plugin HTTP handlers, ProjectDB and files: conditional create/replace/clear, original-version conflict, UTF-8/file readback, folders and attachment inventory/download passed. No mocked API responses or production chats were used. The pinned Python SQLite runtime emitted its known WAL fallback warning; no core/runtime upgrade was performed.
- iOS and Android Expo exports succeeded; exact generated bundles contain the Files/AGENTS routes, setup, editor/conflict controls, capability gate and save-readback validation. Private hashes/logs are under active-profile `workspace/hermes-app/mobile-workspace-entry/`.
- Optional desktop typecheck was attempted but blocked by the pre-existing/pruned dependency tree missing `@types/node`; not recorded as passed. Desktop UI is outside this scope. Candidate reused/copies existing locked dependencies and repaired only the isolated esbuild optional binary from the matching existing mobile 0.28.1 install; no npm ci or lockfile changes.

## Remaining gates

The deployed backend last checked in this conversation still lacks Workspace capabilities. Local mobile implementation and isolated interoperability do not make the public test entry available; the native row will remain hidden there until the server plugin is installed/restarted externally and mobile candidate is published. No self-Gateway lifecycle workaround was attempted.

iPhone visual/keyboard/long-selection, native folder Stack gestures, actual image zoom, background return, conflict review and two-device saved-guideline editing still require physical-device acceptance. Expo exports are not signed standalone installation packages. Generic upload/edit/rename/delete/trash/search/sharing of all Channel files remain follow-up management work; this iteration delivers browsing/previews and real AGENTS editing, not a complete file manager. It does not bind native Agent execution CWD or migrate existing files.
