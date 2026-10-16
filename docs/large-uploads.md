# Large uploads (chunked, up to 2 GB)

Status: candidate (App branch `feat/chunked-uploads`, plugin branch `feat/chunked-uploads`). Not released. Mac and iPhone checks open.

## What the user sees
- On desktop and phone, you can attach a file of up to 2 GB (2 GiB). Before, the limit was 100 MB.
- Files up to 100 MB upload as before. Larger files upload in parts automatically; nothing changes in the composer.
- A short network drop during the upload does not restart it. The client continues from the last part the server confirmed.
- Pasted files (bytes without a file on disk) keep the 100 MB limit, because the app holds them in memory.
- Phone: files up to 2 GB that you or the Agent sent open in the app (native download to a file). Agent files above 2 GB open their public link in the browser.
- Not included: an upload progress bar. A 2 GB file shows only the uploading state until it is done.
- Not included: resuming after the app is closed. The send retries the upload from the start.

## Why not R2
Cloudflare limits one request body on `agent.tuly.space` to 100 MB. Chunks of 32 MiB each pass through the same connection, so no R2 bucket, credentials, presigned URLs or second copy step are needed. The plugin stays the only file store. Jamie chose this over R2 on 2026-10-16.

## Protocol (plugin `chunked_upload.py`)
- `POST /v1/threads/{id}/uploads` `{name, size}` → `201 {upload: {id, received: 0, chunk_size}}`. Refused: size above 2 GiB (413), less than 1 GiB disk left after the file (507), archived Thread (409).
- `PUT /v1/threads/{id}/uploads/{upload}?offset=N`: the next chunk, at most 64 MiB. A chunk at a wrong offset (a retry after a lost reply) gets `409` with the confirmed `received`. A failed or oversize chunk leaves the partial file at the last whole chunk.
- `GET …/{upload}`: the confirmed `received`.
- `POST …/{upload}/complete` → `201 {attachment}`. A repeated call returns the same attachment.
- `DELETE …/{upload}`: abort.
- State is on disk next to the attachments (`.upload-up_<hex>` + `.json`), so an upload survives a Gateway restart. Boot cleanup removes uploads older than 24 hours.
- Capabilities: `chunked_uploads: true`, `upload_max_bytes`. Unsent uploads per Thread: 16 GiB (eight 2 GiB files).

## Clients
- Shared client `HermesClient.uploadChunked(threadId, name, size, read, signal, onProgress)`. It reads one chunk at a time through `read(offset, length)`, retries network/server failures up to 6 times with backoff, resyncs the offset with `GET`, and deletes the server upload when it gives up. `supportsChunkedUpload` needs the capability and a transport `uploadChunk`.
- Desktop main process: disk files above 100 MiB use `uploadChunked` with `FileHandle.read` at the offset. The renderer and preload allow 2 GB for disk files and 100 MB for pasted bytes (`fileSizeLimit`, preload `isDiskFile`).
- Phone: picked files above 100 MiB use `uploadChunked` with `expo-file-system` `FileHandle` (`offset`, `readBytes`). In-app downloads go up to 2 GiB with native file transfer, else 100 MiB (`appDownloadLimit`).

## Verification (candidate)
- Real desktop transport + shared client against the real plugin routes on loopback: a 250 MiB file in 8 chunks and a 1 GiB file in 32 chunks uploaded, downloaded back and matched byte for byte. The probe process peaked at 247 MiB and 311 MiB RSS, so memory does not grow with the file size. Probe scripts: Channel workspace `chunked-uploads/`.
- Not verified: an upload of a real 2 GB file through Cloudflare from the US networks, iPhone memory during a large upload.
