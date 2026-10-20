# Mobile Channel Files and AGENTS.md entry

> Superseded for Files (2026-10-20): the Channel Files route, its Workspace and Attachments tabs and `WorkspaceFilePreview` are removed. Session files replace them; see [session-files.md](session-files.md). The AGENTS.md entry below is still current.

Current candidate update: [Repository AGENTS binding](channel-repository-agents.md) removes the historical 12,000-byte/native-character ceiling below. An explicitly bound repository root document is editable independently of Files initialization; workspace and repository stay separate. Original-version conflict protection remains. No deployment or physical-device acceptance is implied.

## Scope and candidate

Branch `feat/mobile-workspace-entry`, base `857a0e2`. Mobile-first implementation uses the standalone plugin's workspace contract from `docs/channel-workspace.md` in the plugin repository. No server/core changes, runtime plugin installation, Gateway/Expo restarts, desktop UI changes, dependency/lockfile changes or publication in this implementation step.

Channel retains latest-first sessions, Context link, completed-unread light-blue dot and the existing first-message/attachment composer. It adds a compact Files / AGENTS.md row only after authenticated capabilities explicitly advertise all workspace features and the native transport supports conditional writes. No header prefetch of file bodies. Unsupported direct routes explain unavailability rather than displaying a fake editor or attempting setup.

## Files

- Native Expo Router Files route validates exact channel ID and unmodified relative folder path; folder navigation uses the native Stack. Connection ID + channel + folder key isolates scene state across identities/targets.
- Workspace and Attachments tabs load paginated metadata only. Refresh/re-entry reads server state in the background without clearing a retained scene: re-read the loaded window, publish only after all pages validate, retain unchanged row/array identity and the mounted list, and use native visible-content anchoring. Failed refresh keeps the previous list with an error. Target/client/tab changes release the old scene. Selected files alone request bytes. Attachment inventory is available without silently creating a workspace. Listings do not read session messages or acknowledge completed results.
- Channel attachment previews use the explicit route-owned `workspace.readAttachment` API and the original authenticated Thread/attachment download endpoint. They do not use `LiveSessionClient.download`, whose open-conversation guard remains unchanged. Reading one selected attachment never opens/subscribes to its conversation or populates chat caches.
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

## Files return/attachment fix verification

Candidate branch `fix/channel-files-preview`, base `591ffc2`.

- Root cause: Channel previews invoked the conversation-scoped `LiveSessionClient.download` without an open conversation. The earlier interoperability probe used the base `HermesClient` and therefore missed this guard. The updated probe uses the actual live client.
- Actual isolated plugin HTTP + native transport verified authenticated inventory and selected attachment bytes with `currentThreadId === null`, empty message/attachment caches, and the ordinary conversation download still rejected. Existing guideline conditional-save/conflict/readback and file/folder checks also passed. Synthetic files were written to an isolated ProjectDB/home and removed after the probe; no live chats were used.
- Production component tests verify the same list instance/data/row handler survives unchanged return/refresh, changed/deleted/new row reconciliation, loaded-page retention, refresh failure, aborted late reads, tab/client/channel/folder isolation and selected attachment preview/cache cleanup.
- Mobile suite: 479 tests, 478 passed, zero failed, one optional Chromium skip. Shared client suite: 91 passed. Mobile and shared-client TypeScript passed. iOS/Android exports passed and exact generated bundles contain the explicit attachment reader and retained-refresh markers.
- Dependency discovery initially blocked tests on the pruned root esbuild optional binary and Metro on external dependency symlinks. Reused the matching existing mobile binary via `ESBUILD_BINARY_PATH` and worktree-local dependency copies. No package/lockfile changes or repeated installs.
- Not merged, deployed or restarted as part of this fix. No server/plugin/core changes. Supported formats/size limits are unchanged. Native iPhone anchor/gesture/preview acceptance remains pending; component substitutes and exported bundles do not prove UIKit behavior.
- Private evidence: active Channel workspace `channel-files-fix/`.

## Attachment source navigation candidate

Branch `feat/attachment-origin`, based on Files fix `941a5f5`. Matching server candidate is `feat/plugin-attachment-origin`, based on plugin `64e49fe`. No merge, publication or runtime restart is implied.

- An attachment reader on a server advertising `attachment_origin` and `history_around` resolves its selected attachment through `/v1/channels/{id}/attachments/{attachment_id}/source`. The SDK validates the exact Channel, attachment, Thread and positive safe `ref_seq`. File bodies and conversation messages are not prefetched by this metadata read.
- `View in conversation` pushes the existing native `/threads/[threadId]` route with a validated `messageRef`. Ordinary Workspace files, unpublished/ambiguous sources and old servers do not offer a guessed link. Unsupported preview formats can still have a valid source link.
- The plugin maps inbound attachments to their actual user-message reference and outbound documents to their direct-message reference. Shared receipt IDs do not redirect outbound files to the user input. Missing source references, archived Threads or foreign Channels yield no source.
- Target entry subscribes only the selected Thread and reads a bounded 31-reference `around_ref_seq` window first, never latest-first or a full transcript scan. Server-owned older/newer cursors support explicit continued reading. Background/realtime reconciliation uses `through_ref_seq` to reread only the loaded range; unseen newer messages remain behind an explicit later-page/latest action.
- The target window exists before FlashList mounts. Its native `initialScrollIndex` positions the target once; a short static highlight distinguishes that message. Target mode does not resume tail-follow just because the user reaches the bottom of the loaded window. Later pages and new output do not reposition the user; normal entry, sending and explicit latest navigation retain latest behavior.
- Reader bytes, mounted selectable text/Markdown/image and owned private cache survive a covering conversation route. Native Back returns to that same reader. Actual viewer removal or target/identity replacement aborts requests and cleans the cache. No second cached conversation is retained.
- Regression coverage: actual plugin HTTP/WS + production LiveSessionClient/native transport, user vs Agent provenance, cold reopen/session rebinding, revoked device and foreign-reference negatives, bounded windows/explicit later pages/range foreground reads, late/failed source opens, exact native route validation, retained reader and one-shot native-index/highlight callbacks. Initial-completion invalidation and older-range-vs-newer-page races also have SDK regression coverage.
- Final local checks: plugin 328 passed / 2 optional skips; SDK 94 passed; mobile 485 passed / 1 optional Chromium skip; mobile/shared TypeScript and dual Expo exports passed. Exact generated bundles contain source/action/target/range markers. Component/native-view substitutes are not physical iPhone acceptance.
- Physical iPhone target positioning with tall rich content, native Back/gesture, image/text reading-position retention and weak-network recovery remain pending. Deployment needs the matching plugin plus mobile client; no core or lockfile changes.

## Remaining gates

The deployed backend last checked in this conversation still lacks Workspace capabilities. Local mobile implementation and isolated interoperability do not make the public test entry available; the native row will remain hidden there until the server plugin is installed/restarted externally and mobile candidate is published. No self-Gateway lifecycle workaround was attempted.

iPhone visual/keyboard/long-selection, native folder Stack gestures, actual image zoom, background return, conflict review and two-device saved-guideline editing still require physical-device acceptance. Expo exports are not signed standalone installation packages. Generic upload/edit/rename/delete/trash/search/sharing of all Channel files remain follow-up management work; this iteration delivers browsing/previews and real AGENTS editing, not a complete file manager. It does not bind native Agent execution CWD or migrate existing files.
