# Session files, file search and the wider Project modal

Status (2026-10-20):

- Done on branches, not merged or installed: plugin Phase 1 API with the label filter (`plugins/hermes_app/session_files.py`, `tests/p1/test_session_files.py`); shared client contracts (`packages/client/src/sessionFiles.ts`); desktop Project modal layout and Files removal; desktop Session files panel; desktop unified search (Cmd+K) and removal of the sidebar search box.
- Also done on the App branch: mobile Channel Files removal, the Session files page and file results in the Recents search.
- Not started: Phase 2 (semantic search).
- Branches: App `feat/session-files`, plugin `feat/session-files`.

## Confirmed requirements (Jamie, 2026-10-20)

1. Each Session keeps the files that belong to it. The App shows them per Session, not per Channel.
2. A **delivered file** is a file that the Agent sends with `MEDIA:`. Intermediate files are not collected. Files that terminal commands create are not tracked unless the Agent delivers them.
3. No extra copy is made. The plugin already copies each `MEDIA:` file into its attachment storage when it is delivered (see [outbound-media.md](outbound-media.md)). That stored file is the Session file.
4. Channel files are removed from the App: the mobile Channel Files Workspace and Attachments tabs, and the Files section of the desktop Project modal. The AGENTS.md editor stays.
5. The desktop Project modal becomes wider. The AGENTS.md editor moves to the right part of the modal.
6. Semantic search uses the open EmbeddingGemma 2 model on the server. File content does not leave the server.

## Session files

Each Session has two lists:

- **Files**: files that the Agent delivered in this Session.
- **Attachments**: files that the user uploaded in this Session.

Data source: the existing `attachments` table. No new file table is added for the lists.

| List | Rule |
|---|---|
| Files | `attachments.thread_id = <thread>` and a `direct_messages` row has `attachment_id = attachments.id` |
| Attachments | `attachments.thread_id = <thread>`, `receipt_id IS NOT NULL`, and no `direct_messages` row refers to it |

- Unattached uploads (an upload that was never sent) are not shown.
- Files that a branched Session can read through `attachment_grants` are shown only in the Session that owns them.
- Each row has: name, MIME type, size, time, availability and the source message reference (`ref_seq`). The App reuses the existing preview, download and `View in conversation` behavior.
- A file whose stored bytes are missing shows as unavailable. Its name and source message stay.

### API (plugin)

- `GET /v1/threads/{id}/files?list=delivered|uploaded&after=<cursor>&limit=<1..200>`
  - Newest first. The cursor is opaque. The response is `{ thread_id, list, items, next_after }`.
- Download and preview use the existing `GET /v1/threads/{id}/attachments/{attachment_id}`.
- Capability: `session_files: true`.

### App entry points

- Desktop: a `Session files` icon button in the Session status bar tools (see [desktop-session-status-bar.md](desktop-session-status-bar.md)). It opens a panel with the `Files` and `Attachments` tabs.
- Mobile: a `Files` row in `Session options` (see [mobile-session-options.md](mobile-session-options.md)). It pushes `threads/[threadId]/files`, a native Stack page titled `Session files` with the same two tabs. A tap previews an available file in the shared viewer (`SessionFilePreview`), which has `View in conversation`.

## Removal of Channel files

- Mobile: the Channel page row becomes `AGENTS.md` only. The Files route, the Workspace and Attachments tabs, and folder navigation are removed. The AGENTS.md editor and its conflict rules do not change.
- Desktop: the Project modal loses the Files section (list, Add files, drop target, staged uploads).
- Server: the workspace API stays, because AGENTS.md uses it and the Agent still uses the Channel workspace folder. `GET /v1/channels/{id}/attachments` stays for older clients. No data is deleted or moved.

## Wider Project modal (desktop)

- Width: `min(1040px, 100%)`. Height: the current limit (`100dvh - 48px`).
- Two columns:
  - Left: Connection (create mode), Title, Context, Primary folder, messages.
  - Right: AGENTS.md editor. It fills the column height and scrolls inside itself.
- If the server does not support Project files, the right column is not shown and the modal keeps the one-column width.
- Below a 760px window width, the columns stack: the editor goes under the other fields.
- Save, Cancel, Archive and the save rules do not change.
- The desktop main process no longer lists or uploads Project files: `addProjectFiles`, its IPC channel `desktop:add-project-files` and the file list in `getProjectWorkspace` are removed.

Verification (desktop): typecheck and build pass. `npm test`: 185 pass, 0 fail, 53 skipped (Chromium suites need `HERMES_TEST_CHROME`). The production `ProjectDialog` was rendered in headless Chrome, and the element boxes were measured:

| Window | Result |
|---|---|
| 1280 px wide | Modal 1040 px. Fields column 368 px on the left. AGENTS.md column 612 px on the right; the editor fills it. |
| 700 px wide | One column. AGENTS.md is under the fields. |
| Server without AGENTS.md support | Modal 620 px, one column. |

Not yet checked on the Mac desktop app.

## File search

Search covers delivered files and uploaded attachments in all Sessions of one connection. A result opens its Session at the source message.

### Phase 1: keyword search

- Fields: file name, Session title, Project name and the text of the delivering message. Every query term must match one of these fields. Matching ignores ASCII case.
- Method: a bounded `LIKE` scan over the existing tables. No index table, trigger or backfill is added.
  - Reason: the corpus is small (2026-10-20: 156 attachments on `jamie`, 108 on `hermes-app-dev`). On a copy of the `hermes-app-dev` data, a query took 5–12 ms.
  - `LIKE` also matches one- and two-character Chinese terms. An FTS5 `trigram` index needs at least three characters.
  - If the corpus grows so that the scan is slow, add an FTS5 `trigram` table then.
- Label filter: `labels=<label>` may repeat (up to the Session label limits). The file's Session must have every label, with exact text. This is the same AND rule as the App's Session search. A query can have labels and no text.
- Archived Sessions, archived Projects and unsent uploads are excluded.
- API: `GET /v1/files/search?q=<text>&labels=<label>...&after=<cursor>&limit=<1..50>`. Newest first. Each result has the file row, `thread_id`, `thread_title`, `channel_id`, `channel_name` and `ref_seq`.
- Capability: `file_search: true`.

### Phase 2: semantic search with EmbeddingGemma 2

Model facts (checked 2026-10-20 on [the model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2) and [Google's announcement](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)):

- Open weights, Apache 2.0. 740M parameters: 270M text, 170M vision, 300M audio encoders, loadable separately.
- Text, images, video and audio in one 768-dimension space. Text queries can find images and video.
- 8,192-token context. One image costs 280 tokens; one video frame 140 tokens (about 58 frames); audio 25 tokens per second (about 327 s).
- 100+ languages. Matryoshka output: 768, 512, 256 or 128 dimensions.
- Runs on CPU with `sentence-transformers`.

Host: 8 CPU cores, 31 GB RAM, no GPU. CPU inference is enough for the expected file count.

Design:

1. **Embedding service**: a separate local process with its own `uv` environment (`sentence-transformers`, CPU PyTorch, media decoders). It listens on localhost only. It is not loaded into the Gateway process, so the large dependencies do not enter the Hermes core environment.
2. **Jobs**: after a file is indexed, the plugin queues an embedding job. The service runs jobs in the background. A failed job is retried later and never blocks delivery or chat.
3. **Content by type**:
   - Text, Markdown, CSV, JSON and code: the first 8K tokens, as `title: <name> | text: <content>`.
   - PDF: extracted text; scanned pages as page images.
   - Images: the image.
   - Video: sampled frames within the token budget.
   - Audio: the first 327 s.
   - Other types: name and delivering message text only.
4. **Storage**: 512-dimension float32 vectors in the plugin SQLite database. Search compares all vectors in memory. A vector database is not needed at this scale.
5. **Ranking**: keyword and vector results are merged with reciprocal-rank fusion (RRF). Keyword search keeps working when the service is down.
6. Capability: `file_search_semantic: true`, only while the service is healthy.

Phase 2 needs separate authorization before work starts: a new user systemd service, new Python dependencies in a separate environment, and a model download (about 1.5 GB in bf16). Expected memory use is about 2–3 GB.

### Search entry points (confirmed 2026-10-20)

- Desktop: one search dialog for Sessions and files. Cmd+K opens it; Shift+Cmd+F opens it with files only. The sidebar has a `Search ⌘K` action under `New chat`. The old sidebar search box, its frequent-label row and its sidebar result list are removed.
  - The query is a keyword plus label chips; every part must match. Clicking a label on a Session page opens the dialog with that label.
  - Results: matching labels (choosing one adds a chip), Sessions, then files from every connection that supports `file_search`.
  - Enter opens a Session, or opens a file with the system app. Cmd+Enter opens the file's Session. Option+Enter saves the file. Jumping to the source message is not implemented yet.
- Mobile: the existing Recents search box (keyword plus quick label filter, AND) also searches files. 300 ms after typing stops, every online connection with `file_search` is asked. The results appear in a `Files` section under the matching Sessions, newest first, at most 30. A tap opens the file's Session at the source message. If a server fails, a line under the list says so; the other results stay.

## Open items

- Office documents (docx, xlsx, pptx) content extraction for Phase 2. Not confirmed.

## Delivery order

1. Plugin: Session file lists, keyword index and search API, tests.
2. Shared client: `session_files` and `file_search` contracts.
3. Desktop: Project modal layout and Files removal; Session files panel; search dialog.
4. Mobile: Channel Files removal; Session files page; search page.
5. Phase 2 after authorization.
