# Lighter completed-unread dot

Jamie reported that the session-list blue dot looked almost black. Mobile and desktop dot-only styles now use `#4DA3FF` instead of `#2960ad`; dimensions remain 7px/pt, no visible label was added, and directory/read semantics are unchanged.

Published source/tag: `926b797b845a7d8d3bc6b9c700e8933ec98c5ba0`, `v0.1.11`; feature correction `cd754c0`. Rollback baseline: `ed5298a17d611f0c3976839d2416f19a334214e7`. Only Expo restarted. Installed plugin hash set, development/Jamie Gateway PID/start time, fixed core and mobile lockfile were read back unchanged. Root desktop lock changes contain version metadata only; mobile dependencies were not reinstalled during publication.

Candidate mobile/desktop TypeScript checks and targeted list-marker tests passed (3 mobile, 2 desktop). Both iOS and Android exports passed. Public manifests and each precise launchAsset returned HTTP 200, SDK 57; the actual `unreadDot` style in both bundles was checked for `#4DA3FF` and absence of its previous color, with no visible status text.

Desktop [v0.1.11](https://github.com/changx/hermes-app/releases/tag/v0.1.11) is published as an unsigned/non-notarized macOS arm64 development build. Workflow `37071785460` passed. Downloaded ZIP, checksum, package version and actual ASAR CSS color were verified. ZIP SHA-256: `f59b3ffd4a4df0b064beaf504ce07355d436f287e228b8379b4f0fb15f7bae7b`.

Private evidence: active profile `workspace/hermes-app/lighter-unread-dot/`. iPhone visual appearance and Mac native launch remain physical-device acceptance, not claims derived from exports. This pure client change does not install plugins or require Gateway activation.
