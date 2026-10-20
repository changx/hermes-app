# Session files, file search and the wider Project modal

Status (2026-10-20): Phase 1 released (plugin v0.2.43, desktop v0.1.99, mobile through Expo). Phase 2 (semantic search) released: embedding service running, plugin v0.2.44, desktop v0.1.100, mobile through Expo. Both plugin releases take effect at the next Gateway restart. See the release record at the end.

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

Design (built 2026-10-20; Jamie: own process and own service, no effect on the Gateway):

1. **Embedding service** `hermes-app-embed.service` (plugin repo `services/embed/`, see its README). Own systemd user unit, own `uv` venv with pinned CPU PyTorch, own model cache and own index database under `~/.hermes/hermes-app-embed/`. The model never loads in the Gateway process.
   - Limits: `MemoryMax=8G`, no swap, `CPUQuota=400%`, `CPUWeight=20`, `Nice=10`, idle I/O. Home is read-only to it except its own folder. Offline (`HF_HUB_OFFLINE=1`).
   - API: an owner-only Unix socket (`embed.sock`, mode 0600); no network port (`RestrictAddressFamilies=AF_UNIX`).
2. **Indexing**: every 30 s the service reads each Hermes App profile's `metadata.sqlite` read-only and embeds new files (same rule as Session files). It never writes plugin data. Per file: a `meta` vector (name, delivering message, Session title; redone when that text changes) and a `content` vector:
   - images; video 8 frames; audio first 120 s; text and code first 64 KB (2,048 tokens); PDF text of the first 5 pages, or the first page as an image when it has no text; other types `meta` only.
   - An item is counted before it starts and skipped after two failed or crashed attempts. Removed files lose their vectors.
3. **Search** (plugin `session_files.py`): only the first page of a query with text asks the service, with a 2 s timeout. Hits pass the same filters as keyword search (archived Sessions and Projects, labels, unsent uploads). A hit counts when its score is at least 0.64 and within 0.06 of the best visible hit. The keyword matches (newest first) and these hits merge by reciprocal-rank fusion (k = 60). The page is `ranked: true`, items carry `rank` 1…n, and there is no cursor.
4. **Fallback**: when the socket is missing, slow or failing, search is keyword-only and unranked, as in Phase 1. No capability flag is needed: the clients follow `ranked`.
5. **Clients**: the SDK validates `ranked` pages (ranks 1…n, no cursor). Desktop (Cmd+K) and mobile (Recents) put ranked hits first by rank, interleaving connections, then unranked hits newest first.

Calibration on the real `hermes-app-dev` files (108 files, 2026-10-20). Each query avoids the words of its target, and the right file ranked first in all 7:

| Query | First hit (score) |
|---|---|
| credit card statement | screenshot in 「查询信用卡月度扣款商户」 (0.700) |
| cholesterol health claim | screenshot in 「图中胆固醇说法的科学依据」 (0.702) |
| cute mascot icon with wings | `1-mochi-wings.png` (0.735) |
| app store rejection notes | `higoon-review-log.md` (0.752) |
| AI girlfriend chat app competitors | `01-crushie-ai.pdf` (0.729) |
| 账单发票 | the two invoice PDFs (0.766, 0.763) |
| 状态栏截图 | `status-bar-many-labels.png` (0.778) |

- Queries with no matching file (「番茄炒蛋怎么做」, "weather forecast for tomorrow") reach only 0.59–0.61. Wrong hits under a right answer score 0.60–0.66. These set the 0.64 floor and the 0.06 margin.
- Through the plugin code on a copy of the data, with the live service, a search takes 150–190 ms. "credit card statement" returns the one screenshot; keyword search alone finds nothing for it. "weather forecast" returns nothing.
- Indexing on this host: about 4.5 s per image and less than 0.2 s per name, at 3.9 GB memory. The service's search answers in 110–330 ms while it indexes.

#### Benchmark on this host (2026-10-20)

Setup: `google/embeddinggemma-2` from Hugging Face, `sentence-transformers` 6.1.0, PyTorch 2.14.1 CPU, 8 threads, float32. Host CPU: Xeon E3-1270 v6 (AVX2; no bfloat16 or AMX hardware). The test environment and data are in the scratch directory; nothing was installed as a service.

| Item | Result |
|---|---|
| Load | Text encoder only: 2 s, 1.4 GB RSS. All encoders: 3–9 s, 3.6 GB RSS. Peak during the media tests: 4.8 GB. |
| Text | Query 58 ms. Document of 512 tokens 0.73 s; 2,048 tokens 4.4 s; 8,000 tokens 32 s. 32 documents of 256 tokens: 14 s. |
| Image | Default budget 4.9 s; 70 tokens 0.86 s; 1,120 tokens 35 s. |
| Video (30 s clip) | 8 frames 19 s; 16 frames 37 s. The default (up to 32 frames) used more than 15 GB and was killed. |
| Audio (3 s clip) | 0.44 s. |
| Text retrieval, Chinese ⇄ English | 12 documents, queries in the other language: recall@1 = 1.0 at 768, 256 and 128 dimensions. |
| Text → image, video, audio | 12 items (photos, generated invoice, chart and code images with Chinese and English text, two videos, speech, a tone): recall@1 = 0.917, recall@3 = 1.0, for Chinese and English queries. |
| Mixed index | 12 documents and 12 media items, 36 queries: recall@1 = 0.944, recall@3 = 1.0. |

- The only miss in every run: the query "photo of the Golden Gate Bridge" ranked a zoom video made from the same photo first (0.780 against 0.766). This is a test-set duplicate, not a wrong match.
- Limits: the test set is small and hand-made. It shows that the model works on this host. It does not measure quality on Jamie's real files.

Consequences for the design:

- Use float32. bfloat16 is emulated on this CPU and was much slower.
- Limit video to 8 frames (about 19 s per video) and images to the default budget or less. Never use the default video settings.
- Limit document text to about 2,048 tokens (4.4 s), not 8K.
- Run the service in its own systemd unit with a memory limit (for example `MemoryMax=8G`). A test run from the agent terminal ran inside the Gateway cgroup and reached 20.6 GB before the kernel killed it.
- With the 2026-10-20 file counts (about 150 files per profile), a first full index takes minutes, not hours. New files are indexed in the background in seconds.

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

## Release record (2026-10-20)

- Plugin v0.2.43 (`d92a4de`): pushed with its tag, packed and installed through the shared `current` link (`releases/0.2.43`; profiles `emma`, `hermes-app-dev`, `jamie`, `nan`). No schema change. It takes effect after the next `hermes-gateway.service` restart; until then servers report no `session_files` / `file_search`, and the clients keep the features hidden.
- Desktop v0.1.99 (`87d82f8`): Mac mini run 39413063266 succeeded (241 tests, 188 pass, 0 fail, 53 skipped; audit 0). The downloaded zip passes `sha256sum -c`, Info.plist shows 0.1.99, and all 35 ASAR `dist/` files equal the local build of the same commit.
- Candidate checks before the tag: `client:check` passed; `desktop:check` with Chromium 233 pass, 0 fail, 8 skipped; mobile `tsc` and `npm test` (229 pass, 0 fail); iOS and Android `expo export` built.
- Mobile: runtime checkout fast-forwarded to `87d82f8` (lockfile unchanged); `hermes-app-expo.service` restarted (PID 1720561). Public bundles on iOS and Android (SDK 57): `No matching conversations or files`, `You have not sent files in this session.` and `hermes-session-file-` rose from 0 to 1; `Could not load channel files. Try again.` fell from 1 to 0. Gateway PID unchanged (1953184).
- Not checked: Jamie's Mac and iPhone; the features after the Gateway restart.

## Release record, Phase 2 (2026-10-20)

- Embedding service `hermes-app-embed.service`: installed from plugin commit `0a7c3df` (`~/.hermes/hermes-app-embed/app/VERSION`), running in its own cgroup with `MemoryMax=8G`. 0 restarts, 0 failed files. It needs no Gateway restart.
- Plugin v0.2.44 (`62e35f3`): pushed with its tag and installed through the shared `current` link (`releases/0.2.44`; profiles `emma`, `hermes-app-dev`, `jamie`, `nan`). The plugin pack contains only `plugins/hermes_app`; the service code is not in the Gateway's plugin folder. It contains v0.2.43. Both take effect at the next Gateway restart (the Gateway still runs since 2026-10-18 00:37 PDT).
- Desktop v0.1.100 (`0a2c2db`): Mac mini run 39424860576 succeeded (241 tests, 188 pass, 0 fail, 53 skipped; audit 0). The zip passes `sha256sum -c`, Info.plist shows 0.1.100, and all 35 ASAR `dist/` files equal the local build.
- Candidate checks: plugin `test_session_files.py` 8 pass and `tests/embed` 6 pass; `client:check` 95 pass; `desktop:check` with Chromium 233 pass, 0 fail; mobile `tsc` and `npm test` 230 pass, 0 fail; iOS and Android `expo export` built.
- Mobile: runtime checkout fast-forwarded to `0a2c2db` (lockfile unchanged); `hermes-app-expo.service` restarted (PID 1851610). Public bundles on iOS and Android: the new source comment `(semantic search) first by rank, interleaving connections, then the newest` 0 -> 1 and `file.rank ?? Infinity` 0 -> 2. Gateway PID unchanged (1953184).
- Not checked: Jamie's Mac and iPhone; semantic search through the live plugin after the Gateway restart.
