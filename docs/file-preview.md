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
- Markdown: rendered to static HTML in the main process (`react-markdown` + `remark-gfm`). Raw HTML is escaped. The page CSP has no `script-src`.
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
