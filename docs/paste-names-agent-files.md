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

### Download progress (candidate `feat/download-progress`)
- Desktop: after you choose where to save, the attachment card shows a thin bar and `Saving… 44% · 67 of 150 MB`. Open externally shows `Downloading…`. Save and Open are disabled until it finishes; the bar goes away when the file is complete. Jamie asked for this on 2026-10-17 after a 150 MB Save showed nothing but a `.partial` file in Finder.
- Desktop: the incomplete file is now a hidden dot file (`.<name>.<random>.partial`) next to the target, so Finder shows only the finished file.
- Phone: a file downloading into the app shows `Downloading… 44% · 67 of 150 MB` on the message row, and the same text under the spinner in the full-screen viewer. It uses `File.createDownloadTask` progress when the running app has it; otherwise the old download runs without a percentage.
- Shared client: `downloadFile(threadId, id, destination, signal, onProgress)`, forwarded by `LiveSessionClient` and `LivePageClient`. Desktop main sends at most about 5 updates a second, only to the window that asked.
- Not included: a Cancel button for a running download, and upload progress in the composer.

#### 发布结果（2026-10-17）
- Desktop v0.1.96：commit `da91140`，tag run `39083579524` success（CI 237 tests, 186 pass, 0 fail, 51 skipped Electron env tests; audit 0）。Zip `sha256sum -c` OK，Info.plist 0.1.96，ASAR 中 `dist/main/index.cjs`、`dist/preload/index.cjs`、`dist/renderer/index.js`、`styles.css` 与本地已验证构建逐字节相同。
- Expo：runtime checkout `2ef92ef` → `da91140`，Expo PID 2883696 → 1374009。iOS/Android manifest 200，SDK 57.0.0，launchAsset 200，标记 `progressLabel`=5、`createDownloadTask`=3（两平台；发布前 runtime 源码为 0）。Gateway PID 755805 不变，插件未改。
- 候选检查：client 90/90，mobile 218/218，desktop 237/237（含 Chrome/Electron env），iOS/Android export 通过；公网真实路径 150 MB 下载 3.4 s，sha256 一致，进度 0→100%。
- 待 Jamie 设备验收：Mac 上 Save/Open 进度条和 Finder 不显示 `.partial`；iPhone 上下载百分比。
- 证据：`~/.hermes/profiles/jamie/workspace/hermes-app/20261017-download-progress/`。回滚：桌面重装 v0.1.95；手机 `git revert 2e42696` 后重启 `hermes-app-expo.service`。

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
