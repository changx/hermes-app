# Session links across clients

## Confirmed scope

Mobile (iOS/Android source) and desktop share a stable conversation link. Copy session link in the conversation header (on mobile, from the header's Session options page); paste as plain text or `[title](URL)` in a message. Click from ordinary message content or the mobile full-message reader to open that conversation through existing navigation. No additional history store, hidden conversation reads, message sends or task execution.

Canonical format:

```text
hermesapp://session/<stable-thread-id>?server=<percent-encoded-paired-server-base>
```

The earlier multi-Hermes design discussion uses App Thread `th_38efff81320041bdb567624b8d97cbda`. Its physical Hermes Session `20261002_184814_fa5d7246` is not a link target. Compression/rollover must not alter the visible Thread destination.

## Implementation

Current page-lifetime rules are defined in [live session pages](live-session-pages.md). Both clients preserve A when opening B. An existing target reuses its original page and removes pages above it. Mobile inline/article/list/file-source navigation uses the shared page-aware navigator. Desktop selection uses its page stack. The earlier single-reader description below is historical.

- Shared `packages/client/src/sessionLinks.ts`: strict builder/parser, scoped native route, bare-prose link recognition. Reject unknown query fields, credentials, fragments, arbitrary paths, dot traversal, physical session IDs and non-loopback plain HTTP.
- Mobile: Markdown links and bare URLs; native inline and article callbacks push existing Expo Router Thread route. Article bridge still accepts bounded AST indices only. Session URLs never become image/video sources. `+native-intent.tsx` rewrites cold/warm installed-app intents. The route waits for saved credentials, verifies the server, and refuses foreign targets before mounting the conversation. Copy uses the actual paired address and selected stable Thread ID.
- Desktop: restricted preload IPC for open/copy, trusted sender checks; select existing catalogue Thread and Channel, then existing single-conversation reader. Wait for credentials/catalogue on cold launch; newest pending target wins, invalid new input/forget/close cancels pending work. Unknown/archived/foreign target leaves selection unchanged. Same selected Thread is not reopened.
- Desktop native lifecycle: macOS `open-url`, other desktop runtime `second-instance`/argv, single-instance lock, focus existing window. Packaged-app-only protocol registration. macOS package declares `CFBundleURLTypes`; development does not change OS protocol associations.

## Boundaries

- Links do not contain credentials and never create authorization or auto-pair another server. Existing server authorization is still authoritative. Mobile's existing pairing navigation guard remains in place for an unpaired device; first-time pairing does not promise automatic continuation of a pending link.
- Current clients have a single paired connection. Foreign links explain the mismatch; they do not implement the separate multi-Hermes feature.
- Server base address is a conservative scope check, not proof of a persistent server instance identity. Address migrations and independent instances behind one address need the future authoritative instance-identity contract. No guessing between hosts.
- Installed mobile apps can register `hermesapp`. Expo Go cannot register this custom app scheme. Message clicks work inside Expo Go through in-app navigation; launching Expo Go from a `hermesapp` link in another app is not claimed.
- Existing historical messages containing only plain physical Session IDs are not rewritten or resolved. Agent replies should use named links with a stable Thread ID and actual paired server address.
- Desktop runtime event paths are implemented, but only macOS packaging exists here. Windows/Linux installers, iPhone/Android installed-app cold/warm invocation, macOS Launch Services invocation and native visual/keyboard/back behavior remain real-device acceptance items.

## Candidate verification

Recorded in the private Channel workspace under `session-links/`. Local implementation only. No main merge, push, deployed bundle, Gateway/plugin/core change, signing or App Store release.

Official API references checked:
- https://docs.expo.dev/router/advanced/native-intent/
- https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
