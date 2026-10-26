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

## Gallery: swipe between attachments (2026-10-13)

Request (Jamie): image and attachment previews on phone and desktop are a continuous sliding view, so the user can switch between files easily.

### Phone

- Tapping a message attachment opens a horizontal gallery. It holds every available attachment of the Thread in timeline order and starts at the tapped file. A swipe moves one file. The header shows the file name and a counter (`3 / 7`).
- Every file type uses the same `FilePreview` page as before. Only the current page and its neighbours are mounted. Each page copies its file to a private cache file and deletes the copy when the page leaves.
- A zoomed image keeps the swipe for panning. Zoom out to move to the next file.
- Video and audio pause when their page is no longer the current page.
- Downloads: one store per Thread page (`apps/mobile/src/attachmentFiles.ts`) serves message thumbnails and the gallery, so a file downloads once. A page that opens shows a spinner while its file downloads. A failed page says so and retries on tap.
- Behaviour change: a tap on a non-image file opens the viewer at once with a spinner. Earlier, the viewer opened only after the download finished.
- Unsent composer images open in the same gallery, in composer order.

### Desktop

- Preview on a message attachment opens the right-side browser with a gallery page (`hermes-preview://<host>/__hermes_gallery__`). It holds every available attachment of the open Session in message order and starts at the chosen file. Files above the 10 MiB preview limit are left out.
- Move with a two-finger horizontal swipe (scroll snap, one file per swipe), the ← and → keys, or the side buttons. The counter is at the bottom. The browser title shows the current file name.
- Images, video and audio are shown directly. Other files load the single-file preview (`/__hermes_item__/<index>/<name>`) in a frame, so PDF, Markdown, text and HTML look the same as before. HTML runs in a sandboxed frame without the preview origin.
- Only the current slide and its neighbours hold content, so a file downloads only when its slide comes near. Downloaded files stay in memory up to 64 MiB for each gallery (least recently used first out). Media pauses when its slide leaves.
- Gallery page CSP: `default-src 'none'`, a fresh nonce for its own script and style, `img-src`/`media-src`/`frame-src 'self'`, no network access.
- A Session with one attachment and the new-chat composer still use the single-file preview.

### Verification

- Phone: TypeScript check passes. Mobile tests: 194 pass, 0 fail, 1 skipped (a Chromium article test that needs `HERMES_TEST_CHROME`). New `tests/attachment-gallery.test.mjs` covers the order, duplicates, unavailable files and page index. iOS and Android exports pass.
- Desktop: `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 npm run desktop:check` passes 196/196 with 0 skipped. The new Electron/Xvfb test `tests/attachment-gallery-native.test.mjs` clicks Preview in a Session with 7 files across two messages. It checks the start slide, the title and counter, that only neighbours download, the sandboxed HTML slide, the → key, a trackpad horizontal scroll over a text frame, a rendered PDF slide, Markdown with a sibling image, video and audio metadata, media pause on leave, reload, and resize. The existing sidebar test now opens its single-file previews directly, because Preview in a message with several files opens the gallery.
- Not yet done: iPhone and Mac checks on the real devices.

Release v0.1.79 (2026-10-13, authorized by Jamie: "合并发布"): `main` fast-forwarded `6c061ba..bfe60e6`, tag `v0.1.79`, tag run 38398865964 succeeded (196 tests, 148 pass, 0 fail, 48 skipped; audit 0). Release `Hermes-0.1.79-macOS-arm64.zip`: checksum OK, Info.plist 0.1.79; ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js`, `dist/renderer/styles.css` byte-identical to the local build. Expo: runtime checkout at `bfe60e6`, `hermes-app-expo.service` restarted (PID 14073 → 210935); public iOS and Android manifests 200, SDK 57.0.0, launch assets 200, marker `Tap to try again` present on both. Gateway PID 3564617 and plugin hash unchanged. Rollback: `v0.1.78` / `6c061ba`. iPhone and Mac checks still open.

## Not included

- PDF and Office rendering on Android.
- Desktop in-app preview above 10 MiB. Attachments can be up to 100 MiB ([Attachment size](attachment-size.md)); larger files use Save or Open on desktop. On the phone they download to a file and video/audio/images/PDF open; text above 10 MiB shows a too-large notice.
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
- A Mermaid diagram scales to the full width, as in replies. Headings: see "Document typography" below.

Verification: `desktop:check` (Chromium + Electron/Xvfb) 137/137. The Electron test opens a Markdown attachment with a table, inline and display formulas, a Mermaid diagram, a JS code block, a task list, a sibling image, `<script>` and an `onerror` image. It checks the reply table layout, KaTeX CSS and font loaded, the diagram SVG, the image, that only the app script exists, no injected code ran, no horizontal overflow, and that the page cannot fetch other app files. It also checks that a formula in a chat reply uses KaTeX CSS. Jamie's real `REPORT.md` renders through the same component (14 headings, 1 table with 8 rows, 11 lists). macOS visual check is still open.

Release v0.1.50 (2026-10-08, authorized by Jamie: "合并发布"): `main` fast-forwarded `26c544d..2012436`, tag `v0.1.50`, tag run 37766563230 succeeded. Release `Hermes-0.1.50-macOS-arm64.zip`: checksum OK, Info.plist 0.1.50; ASAR main, preload, renderer `index.js`/`index.html`/`styles.css`/`katex.css`/`markdown-preview.js` byte-identical to the local build; 20 KaTeX fonts included. Desktop-only: Expo, plugin and Gateway not touched. Rollback: `v0.1.49`. macOS visual check still open.

## Desktop Markdown preview: document typography (2026-10-26)

Report (Jamie): Markdown file previews on desktop render badly.

Cause: the preview page loads the app's `styles.css`. That file resets `h1`–`h3` to the body size with no margin (app chrome) and uses the compact chat-reply rules. Measured in Chromium before the fix: H1, H2, H3 and H4 all 16 px like the body; H1–H3 margin 0; blockquote with no rule or colour (only a 40 px indent); default inset `hr`; table cells with 2 px side padding and equal fixed-width columns; code at body size.

Fix (desktop only, scoped to `main.markdown-preview`; chat replies do not change):

- Headings: H1 1.85em, H2 1.45em (both with a bottom rule), H3 1.2em, H4 1.05em, H5 1em, H6 0.9em muted; weight 650; margin 1.6em above, 0.6em below.
- Body: line height 1.65; blocks 1em apart; list items 0.3em apart; task lists without bullets.
- Blockquote: 4 px left rule, muted text. `hr`: one 1 px line.
- Tables: columns size to the content (`table-layout: auto`), cells 6 px × 13 px, light header and striped rows. GFM column alignment is kept. The table still scrolls inside its region.
- Code: inline and block code at 0.875em; blocks have 14 × 16 px padding.
- Page: maximum width 880 px; side padding `clamp(16px, 4vw, 32px)`.

Verification: `tests/browser-sidebar-native.test.mjs` now checks H1 > H2 > body size and the blockquote rule (it checked body-size headings before). Computed styles in Chromium at 720 px after the fix: H1 29.6 px, H2 23.2 px, H3 19.2 px, H4 16.8 px, body 16 px, code 14 px, blockquote rule 4 px, cells 6 × 13 px.

## Desktop Mermaid diagrams (2026-10-26)

Report (Jamie): Mermaid diagrams in the Markdown preview are broken. The same renderer draws diagrams in chat replies, so replies had the same faults.

Causes, measured in Chromium with the old code:

- The diagram sanitizer removed Mermaid's `<style>` element and every `style` attribute. Flowchart, state, ER and gantt shapes fell back to black fills (13 black shapes in one flowchart); edges had no stroke.
- The sanitizer removed `refX`, `refY`, `markerWidth`, `markerHeight`, `orient` and `marker-end="url(#…)"`, so arrowheads were lost or misplaced.
- With `max-width` removed, `width="100%"` stretched every diagram to the pane width: `graph TD; A-->B` became 630 × 1159 px.
- The diagram sat inside a `pre.code-block` (grey background, monospace, `white-space: pre`). Labels measured in one font were drawn in another and spilled out of their nodes.

Fix (`apps/desktop/src/renderer/message-content.tsx`, `mermaid-engine.ts`, `styles.css`):

- The app page CSP is `style-src 'self'`, which blocks `<style>` and `style` attributes in markup. Mermaid's CSS is now applied as an adopted stylesheet (`CSSStyleSheet.replaceSync`), and each `style` attribute through `element.style.cssText`. CSSOM changes are not blocked by `style-src`. The CSS loses `@import`, `url()`, `expression(` and backslash escapes. The sheet is removed when the diagram unmounts. Rules are scoped by Mermaid to the diagram id.
- Mermaid measures labels while it renders, before its blocked `<style>` can apply. The diagram renders once to get its CSS, adopts it, and renders again with the same id. Without this, a cylinder label in a flowchart was shifted by half its width.
- Marker geometry attributes are allowed. `marker-start`/`marker-end` keep only `url(#id)`.
- Mermaid uses the app font for measuring and display.
- A Mermaid block is no longer wrapped in `pre.code-block`.

Verification: new `tests/mermaid-diagram.test.mjs` renders flowchart, sequence, small graph and state diagrams in Chromium under the app CSP. It checks no black shapes, labels inside their shapes, edge lines with arrowheads, natural size and no code-block wrapper. It fails on the old code and passes on the new code. The Electron preview test also checks the natural size and no black shapes. A manual check of flowchart, sequence, class, state, ER, pie and gantt diagrams, with and without the strict CSP, found no black shapes and no labels outside their shapes. `desktop:check`: 256/256.
