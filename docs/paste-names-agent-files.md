# Pasted file names and Agent file downloads

Status: released 2026-10-16 except the desktop package. Plugin 0.2.39 installed (`current` → `releases/0.2.39`, files equal to tag `v0.2.39`); it takes effect after the Gateway restart. Expo test entry live at 02:12 PDT (iOS/Android manifests 200, SDK 57, new strings in both bundles). Desktop tag `v0.1.93` (`18c985d`) was pushed, but its queued build was cancelled; these changes ship in desktop v0.1.94 ([Large uploads](large-uploads.md)). Mac and iPhone checks open.

## What the user sees

### Pasted files get their own names (desktop)
- A screenshot or a copied browser image pasted with Cmd+V gets a name like `Pasted 2026-10-16 14.03.22.png`. Before, every such file was `image.png`.
- When the name is already in the draft, or several files arrive in one paste, the next ones get ` 2`, ` 3` before the extension.
- The extension comes from the original name, else from the file type (`image/png` → `.png`). Without either, the name has no extension.
- Files copied from Finder keep their own names and are still sent by path.
- This applies to the Session composer and to the New chat first message. New chat shows the generated name in its file list before Send.
- Drag and drop and the file picker are unchanged.

### Agent files: any size, direct download
- The Agent gives a file with `MEDIA:/absolute/path` in its reply. The App shows it as an attachment, and the message has a permanent download link (`/media/att_…/<name>`).
- There is no size limit on Agent files. The old limit was 10 MiB. Your uploads stay at 100 MiB (Cloudflare request-body limit, see [Attachment size](attachment-size.md)). Downloads are responses, and Cloudflare does not limit them.
- Hermes App now tells the Agent in every session that it can send files this way, with no size limit. The Agent should send the file instead of only naming its path.
- Desktop: Save and Open write the file straight to disk, so any size works. "View file" opens the public link in the browser.
- Phone: a file up to 100 MiB opens in the app as before. A larger file shows "Large file. Tap to download in your browser" and opens its public link in the system browser. The gallery skips such files.

## Implementation
- Plugin `adapter.py`:
  - `send_document` copies the file in a worker thread (`_copy_outbound`), with no size cap. It refuses the copy when less than 1 GiB of disk would stay free (`OUTBOUND_FREE_RESERVE`).
  - `register_platform(..., platform_hint=PLATFORM_HINT)` gives core the platform hint. Core adds it to the system prompt for `hermes_app` sessions (`agent/system_prompt.py _default_platform_hint`).
- Plugin `media.py`: `/media/...` serves any size; the size must still match the index.
- Desktop:
  - `src/renderer/pasted-files.ts` names the pasted files.
  - Preload exposes `isDiskFile(file)`, a boolean only, so the renderer never sees local paths.
  - `src/main/transport.ts downloadFile` streams to a `0600` file and deletes it on failure.
  - `connection-service.ts downloadAttachment` uses it through `LivePageClient.downloadFile`.
- Mobile: `attachmentHelpers.ts tooLargeForApp`/`browserDownloadUrl`; `Attachments.tsx` opens the link with `Linking.openURL`.

## Unchanged
- Upload limit 100 MiB per file, 8 files per message. In-app preview 10 MiB. Channel workspace files and AGENTS.md 10 MiB.
- Files the Agent only writes to disk, without `MEDIA:`, get no link. A public link for a whole folder would publish everything in it.

## Option, not built: uploads above 100 MiB through Cloudflare R2
Cloudflare limits one request body to 100 MB on this plan. R2 accepts one upload up to 5 GiB and a multipart upload up to 4.995 TiB (checked 2026-10-16 at developers.cloudflare.com/r2/platform/limits). Clients that upload straight to R2 through presigned URLs would not pass through the proxied `agent.tuly.space` zone, so the 100 MB body limit should not apply (inference; not measured). Reachability and speed of the R2 endpoint from the China Mobile network are not measured. This needs an R2 bucket, API credentials on the server, and a plugin route that issues upload URLs and then copies the object into attachment storage. It needs Jamie's decision and account setup first.
