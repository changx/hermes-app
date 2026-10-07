# Mobile PDF attachment viewer

## Problem

A tap on a PDF attachment in a session opened a page with the text "File downloaded. This format cannot be opened in the app yet." `MessageAttachments` only rendered images and text files.

## Change

- `isPdf()` (`apps/mobile/src/attachmentHelpers.ts`) accepts a PDF by name or MIME type and confirms the `%PDF-` signature in the downloaded bytes.
- On iOS, the app copies the downloaded file to a private `.pdf` cache file and opens `PdfViewer` (`apps/mobile/src/Attachments.tsx`). `PdfViewer` uses the existing `react-native-webview`, which renders the PDF with the native WKWebView renderer. JavaScript is off. Navigation to any other URL, including links inside the PDF, is refused. The copy is deleted when the viewer closes.
- On Android, WebView cannot render PDF. The viewer shows "PDF preview is not available on this device yet."
- No new dependency. No plugin or server change.

## Not included

- PDF rendering on Android (needs bundled PDF.js or an external-viewer dependency).
- PDF preview in the channel workspace file page (`WorkspaceFilePreview.tsx`).

## Verification and release

- Commit `800b075`. Mobile TypeScript check passed. Mobile tests: 120 pass, 0 fail, including `tests/attachment-pdf.test.mjs`. iOS and Android exports passed.
- `main` was fast-forwarded to `800b075`. The lockfile did not change, so `npm ci` did not run. Only `hermes-app-expo.service` restarted. Gateway PID/start time and the plugin hash did not change.
- Public iOS/Android manifests and exact launch assets returned HTTP 200 with SDK 57.0.0. Both bundles contain the new viewer text and the `%PDF-` check.
- iPhone check of a real PDF attachment is still open.
- Evidence: Channel workspace `mobile-pdf-viewer/release.log` and the manifests.
- Rollback: `git revert 800b075` and restart only Expo. Chat data is not affected.
