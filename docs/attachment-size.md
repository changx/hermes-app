# Attachment size

Status: released 2026-10-15 (desktop v0.1.91, Expo test entry, plugin 0.2.38 installed). The server limit takes effect after the Gateway restart. iPhone and Mac checks open.

## What the user sees
- A message attachment can be up to 100 MB (100 MiB) on desktop and phone. Before, the limit was 10 MB.
- One message still takes up to 8 attachments.
- A larger file is refused before upload with "over 100 MB" (phone) or "each between 1 byte and 100 MiB" (desktop).
- The phone shows image thumbnails on its own only for images up to 10 MB. A larger image downloads when tapped.
- In-app preview keeps its 10 MB limit:
  - Desktop: the preview gallery and image thumbnails leave out files above 10 MB. Save and Open work up to 100 MB.
  - Phone: video, audio, images and PDF of any allowed size open from the downloaded file. Text, Markdown and HTML above 10 MB show "This file is too large to preview in the app."
- Unchanged: Channel workspace files (10 MiB), AGENTS.md (10 MiB text), outbound files from the agent (10 MiB), pasted clipboard images on the phone (10 MiB).

## Why 100 MiB
App connections reach the server through Cloudflare (`agent.tuly.space`). Measured on 2026-10-15: POST bodies up to 104,857,600 bytes reached the origin (401); 104,857,601 bytes and more got 413 from Cloudflare. A larger limit needs a chunked upload protocol. Jamie chose 100 MB.

## Implementation
- Plugin 0.2.38 (`hermes-app-plugin` `docs/attachment-size.md`): 100 MiB per upload, 1 GiB unsent uploads per Thread.
- Shared client (`packages/client/src/index.ts`):
  - Upload and download deadlines grow with the file size: the normal request deadline plus the bytes at 128 KiB/s (`TRANSFER_BYTES_PER_SECOND`). 100 MiB adds about 13 minutes. Before, every transfer had 15 s.
  - Optional transport methods `uploadFile` / `downloadFile` move a local file without reading it into JS memory. `HermesClient.uploadFile`, `downloadFile` and `supportsFileTransfer`; `LiveSessionClient` and `LivePageClient` forward them like `upload` / `download`.
- Phone:
  - `transport.ts` implements them with expo-file-system `File.upload` (binary body, foreground session) and `File.downloadFileAsync`. It exposes them only when the running app has the native `FileSystemUploadTask` (expo-file-system 56+); otherwise attachments use the old byte path.
  - `attachmentFiles.ts uploadSource` sends a picked file through `uploadFile`; `AttachmentFiles.load` downloads into the cache file and reads only the first bytes for the PDF signature.
  - Limits in `attachmentHelpers.ts`: `MAX_ATTACHMENT_BYTES`, `MAX_CLIPBOARD_IMAGE_BYTES`, `MAX_THUMBNAIL_BYTES`.
- Desktop:
  - `shared/attachment-input.ts`: `MAX_ATTACHMENT_BYTES` (100 MiB), `MAX_PREVIEW_BYTES`, `MAX_WORKSPACE_FILE_BYTES` (10 MiB).
  - The main process checks every file first, then reads and uploads one file at a time, so at most one 100 MiB file is in memory.

## Verification (local)
- Shared client: `scripts/client-check.sh` 88/88; new `tests/attachment-transfer.test.mjs`, new page-forwarding test in `live-pages.test.mjs`.
- Phone: new `tests/attachment-size.test.mjs` (picker and send limits at 100 MiB ± 1, native file upload/download paths, transport headers).
- Desktop: new tests in `attachment-paste.test.mjs` (11 MiB and 100 MiB disk files upload, 100 MiB + 1 is refused before any upload) and `transport.test.mjs` (100 MiB upload accepted, + 1 refused, workspace write keeps 10 MiB).
- Plugin: real loopback HTTP test accepts exactly 100 MiB and refuses one byte more without a partial file.
- Open: real 100 MB upload from the iPhone and the Mac through `agent.tuly.space`.

## Release (2026-10-15, authorized by Jamie: "合并发布", plugin option 1 "你可以继续发布了")
- App: `main` fast-forwarded `0427855..aae8d82`, tag `v0.1.91`. Tag run 38713493695 succeeded (215 tests, 165 pass, 0 fail, 50 skipped on the runner; audit 0). `Hermes-0.1.91-macOS-arm64.zip`: checksum OK, Info.plist 0.1.91; ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js`, `dist/renderer/styles.css` byte-identical to the local build. The release also carries the shared-client part of the mobile battery fix (`b2f52e2`), already live on Expo.
- Expo: runtime checkout at `aae8d82`, lockfile unchanged, `hermes-app-expo.service` restarted (PID 416273 → 637989). Public iOS and Android manifests 200, SDK 57.0.0, launch assets 200; markers `over 100 MB` (1), `FileSystemUploadTask` (2), `too large to preview in the app` (2) on both. Gateway PID 116641 unchanged.
- Plugin 0.2.38 (`bc50692`, tag `v0.2.38`; also ships the `hermes-app:channels` skill from 0.2.37): `current` → `releases/0.2.38` for jamie and hermes-app-dev; release dir identical to `git archive v0.2.38`. P1 delta against `main`: 0 new failures (30 pre-existing on both). Active after Jamie restarts `hermes-gateway.service`.
- Evidence: `~/.hermes/profiles/jamie/workspace/hermes-app/2026-10-15-attachments-100mib/`.
- Rollback: App `v0.1.90` / `0427855` (runtime checkout + Expo restart); plugin `ln -sfn releases/0.2.36` on `current`, then Gateway restart.
