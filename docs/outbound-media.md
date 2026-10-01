# Agent media delivery and permanent static links

Tracking: `default / t_bf2b66af`. Paired candidates: App `feat/app-media-static`, standalone plugin `feat/plugin-media-static` based on presentation baseline `9b531bb`. User explicitly approved no-expiry static links.

## Contract

The plugin copies only explicitly Agent-delivered media into its existing authoritative attachment storage and publishes `/media/att_<32 hex>/<encoded basename>`. Links contain no token or expiry and can be used by anyone possessing them. No local directory is mounted publicly. Inbound user uploads and old private documents remain authenticated; an additive publication index in the existing metadata database starts empty on upgrade. History retains media after temporary tool-file cleanup, with stable identities and duplicate-delivery suppression. Optional `public_url` metadata is kept by the SDK; the plugin also puts the URL in the media message for older clients.

Desktop adds lazy, authenticated PNG/JPEG/GIF/WebP previews, bounded to three concurrent reads, with fixed preview space and retry/Open/Save behavior. Renderer receives only approved image bytes, not device credentials, filesystem access or arbitrary IPC. CSP, sandbox and context isolation remain unchanged. Mobile's existing authenticated image attachment path and full-image viewer are reused.

## Verified candidate

- Plugin final P1 suite: 279 passed. An initial run exposed nested attachment-index reads locking SQLite under concurrent history; the fix reuses the current transaction and excludes outbound files from user/model input attachments. Final complete suite passed.
- Desktop: TypeScript/build and 75 tests passed; shared SDK TypeScript/build and 38 tests passed.
- Mobile compatibility: TypeScript and 380 tests passed; iOS and Android SDK 57 exports passed. No native mobile UI files changed.
- Real screenshot: the 77,349-byte Mac mini capture was copied by the native adapter, served over actual unauthenticated static HTTP, fetched by the shared SDK and decoded in an actual sandboxed Mac Electron window at 1280 × 820. Returned bytes matched the source SHA-256 exactly; only one image card was present. Controlled input and isolated test server, not a real-model/deployed Gateway test.
- Authenticated WebSocket hello and six actual replay events observed; reconnect retained the same media ref and attachment event. Unauthenticated private API remained 401.
- Linux native launch was blocked by its setuid-sandbox installation; no sandbox permissions were changed or flags disabled. Native rendering was verified on the Mac instead.
- No changes to Hermes core. Runtime publication and final device acceptance are separate gates; candidate checks do not claim that current clients already run this code.

Private evidence and screenshot: active development workspace `workspace/outbound-media/`. Do not commit private screenshots or actual conversation content.
