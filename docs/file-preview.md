# In-app file preview

Status: candidate on branch `feat/file-preview`. Not yet released.

## Requirement

Confirmed (Jamie, 2026-10-07): common content opens in the app with one tap. This covers Markdown, HTML, text, PDF, images, video, audio and web links. Unsupported formats say so plainly and offer Save or Open externally where the platform has them.

## Mobile

Session attachments and Channel Files use one viewer, `FilePreview` (`apps/mobile/src/FilePreview.tsx`). `previewKind()` (`apps/mobile/src/filePreviewKind.ts`) chooses the viewer from the file name, then the MIME type. A declared PDF must carry the `%PDF-` signature.

| Type | Viewer |
| --- | --- |
| Image | Zoomable image (unchanged) |
| PDF | iOS WKWebView. Android: "not available on this device yet". |
| Word/Excel/PowerPoint/Pages/Numbers/Keynote/RTF | iOS WKWebView (Quick Look renderer). Android: not available. |
| Markdown | Rendered with the message renderer up to 200 KB; larger files show as text. |
| Text, code, CSV, JSON, YAML, logs, SVG source | Selectable monospace text; the first 1 MiB is shown. |
| HTML | WebView with scripts on, opaque origin, no file access, private storage. Web links open in the in-app browser. |
| Video, audio | `expo-video` native controls. Playback pauses when the page loses focus or the app goes to the background. |

- One tap downloads a non-image attachment and opens it. Earlier, the first tap only downloaded the file. A download that finishes after the user left the page does not open a viewer.
- The viewer works on a private cache copy that keeps the original extension (AVPlayer and WKWebView need it). The copy is deleted when the viewer closes.
- Channel Files previews every supported type up to the 10 MiB transfer limit (earlier: images and 64 KiB text only).
- `http`/`https` links in messages, articles and HTML previews open in the in-app browser (`expo-web-browser`, SFSafariViewController on iOS). Other schemes still use the system handler. New dependency: `expo-web-browser ~57.0.3` (part of Expo Go).

## Desktop

The right-side browser previews attachments through the private `hermes-preview:` scheme.

- PDF: the built-in viewer may load `chrome://resources` scripts, styles, images and fonts, but only for requests from its own frame. Earlier, these requests were blocked and the pane stayed grey.
- Markdown: rendered with the chat message renderer (`MessageContent`), so a Markdown file looks like a reply: GFM tables (same scrollable table layout), task lists, KaTeX formulas, code blocks and Mermaid diagrams. See "Desktop Markdown preview with the reply renderer" below.
- Video (MP4/M4V/MOV/WebM/Ogg) and audio (MP3/M4A/AAC/WAV/FLAC/Ogg/Opus): served with media MIME types and opened in Chromium's media page. The scheme has the `stream` privilege and answers `Range` requests, so seeking works.
- Images, text, HTML and web links: unchanged.

## Not included

- PDF and Office rendering on Android.
- Media streaming above the 10 MiB attachment limit.
- Archive browsing and editing.
- Desktop Channel Files (the desktop has no Channel Files page).

## Verification

- Mobile: TypeScript check; 123 tests pass, 0 fail, including `tests/file-preview-kind.test.mjs`. iOS and Android exports pass.
- Desktop: `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 npm run desktop:check` passes 103/103 with 0 skipped. The Electron/Xvfb test checks a rendered PDF page (attachment and `https`), rendered Markdown without scripts, H.264 video metadata and a seek through `Range`, and WAV audio metadata. Without the PDF fix, the test fails at "PDF page rendered".
- Not yet done: iPhone check of each type; Mac check of the installed app. Linux Electron results do not prove macOS behaviour.

## Desktop fix: compressed attachment downloads (2026-10-08)

- Symptom (Jamie, desktop 0.1.48): Preview of `REPORT.md` on the `hermes-jamie.tuly.space` connection showed "The file could not be previewed." Save and Open externally used the same download.
- Cause: Cloudflare compresses text replies on that zone (`content-encoding: br`) and removes `Content-Length`. The desktop transport refused any download without `Content-Length` ("Attachment size is unsupported."). This affected every compressible type (Markdown, text, HTML, JSON, CSV …), on every desktop action. Images and video are not compressed, so they worked. The dev zone `agent.tuly.space` does not compress, so dev checks did not show it.
- Fix (`apps/desktop/src/main/transport.ts`): the download asks for `Accept-Encoding: identity`. If a proxy still compresses, the decoded body is read with a 10 MiB bound, and `Content-Length` is compared only for an uncompressed reply. Preview, image thumbnails, Save and Open externally compare the bytes with the attachment's authoritative size.
- Proof: the real client path (desktop transport + `LivePageClient` + `previewResponse`) against the `jamie` connection fails with the old code ("Attachment size is unsupported.") and renders `REPORT.md` (11,592 bytes) with the fix. New transport test covers br without `Content-Length`, gzip, plain, and a decoded body above 10 MiB.
- Not changed: SVG still opens as "cannot be previewed" (security decision). Mobile has the same strict `Content-Length` check in `apps/mobile/src/transport.ts`; on a compressing zone, mobile downloads of text files fail in the same way. A server-side alternative for both clients is `Cache-Control: no-transform` on attachment replies in the plugin.

Release v0.1.49 (2026-10-08, authorized by Jamie: "merge and redeploy"): `main` fast-forwarded `59d42fe..2ab4d64`, tag `v0.1.49`, tag run 37761812840 succeeded. Release `Hermes-0.1.49-macOS-arm64.zip`: checksum OK, Info.plist 0.1.49, arm64; ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js`, `dist/renderer/styles.css` byte-identical to the local build. `desktop:check` before release: 137/137. Previous release for rollback: `v0.1.48`. macOS check still open.

## Desktop Markdown preview with the reply renderer (2026-10-08)

Request (Jamie): Markdown attachments must look like reply text, including tables and other advanced formats.

- The `hermes-preview:` page for a Markdown file is a small HTML page. It holds the file text in a JSON script element and loads the app's own `markdown-preview.js`, which renders `MessageContent` (the reply renderer) with the reply styles (`styles.css`) and KaTeX CSS/fonts.
- The app files come from `dist/renderer` through a fixed path, `/__hermes_preview__/`. Only `markdown-preview.js`, `styles.css`, `katex.css` and `fonts/KaTeX_*.woff2` are served. Attachment names cannot contain `/`, so the path never names an attachment.
- Security: CSP `default-src 'none'`, `script-src` with a fresh nonce for each page, no `unsafe-eval`, no network access (`connect-src` unset), `base-uri 'none'`. Raw HTML in the file is skipped. The JSON is escaped so file text cannot close the script element. The page has no app API.
- Difference from replies: a preview shows images. Web images and plain file names of image attachments in the same Session (PNG, JPEG, GIF, WebP) are allowed; replies still show `[Image: …]`.
- Files above 1 MiB show as plain text. If the script cannot run, the source text appears after 1.5 s.
- Replies: the app page did not load KaTeX CSS, so formulas in replies had no KaTeX layout. `katex.css` and the woff2 fonts are now part of the renderer build and loaded by `index.html`.
- Same as replies, by design: headings H1–H3 use the body font size (bold), and a Mermaid diagram scales to the full width.

Verification: `desktop:check` (Chromium + Electron/Xvfb) 137/137. The Electron test opens a Markdown attachment with a table, inline and display formulas, a Mermaid diagram, a JS code block, a task list, a sibling image, `<script>` and an `onerror` image. It checks the reply table layout, KaTeX CSS and font loaded, the diagram SVG, the image, that only the app script exists, no injected code ran, no horizontal overflow, and that the page cannot fetch other app files. It also checks that a formula in a chat reply uses KaTeX CSS. Jamie's real `REPORT.md` renders through the same component (14 headings, 1 table with 8 rows, 11 lists). macOS visual check is still open.

Release v0.1.50 (2026-10-08, authorized by Jamie: "合并发布"): `main` fast-forwarded `26c544d..2012436`, tag `v0.1.50`, tag run 37766563230 succeeded. Release `Hermes-0.1.50-macOS-arm64.zip`: checksum OK, Info.plist 0.1.50; ASAR main, preload, renderer `index.js`/`index.html`/`styles.css`/`katex.css`/`markdown-preview.js` byte-identical to the local build; 20 KaTeX fonts included. Desktop-only: Expo, plugin and Gateway not touched. Rollback: `v0.1.49`. macOS visual check still open.
