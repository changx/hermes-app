# Open-session-live v0.1.8 publication

Jamie authorized merging all verified open-session-live work and publishing it.

- App implementation: `dd19443`; prior published main/rollback: `f7434a7` / v0.1.7.
- Standalone plugin: `6b8fbb6` (includes retained outbound-media and lifecycle declarations); prior remote plugin main: `9b531bb`.
- Candidate checks: three TypeScript projects, SDK 73/73, desktop 93/93, mobile 412/412, no skipped layout gates; actual plugin/SDK HTTP/WS 6/6; iOS/Android exports. Device/RSS/signing acceptance remains separate.
- Desktop uses the existing macOS arm64 GitHub workflow and version 0.1.8; no dependency updates or signing-account actions.

## Required server activation

Both new clients require capability `open_session_live: true`; they do not fall back to cache/replay synchronization. The backend plugin must therefore be activated before using these clients.

The release session runs inside `hermes-gateway-hermes-app-dev.service`. The execution environment explicitly rejects restarting the owning Gateway from inside its own process. Do not bypass that guard using detached jobs, another service or SSH. Prepare the active-profile plugin with a private rollback snapshot; perform activation from an independent external terminal, then verify authenticated capabilities/catalogue/WS before switching the Expo entry.

Keep the current Expo runtime checkout at v0.1.7 until activation is verified. Remote main publication and native packaging do not prove the running backend/phone entry was updated.

No Jamie Gateway, Hermes core, credentials, authentication configuration, ingress, signing or app-store changes are included. Actual CI/release/installation outcomes and hashes are recorded privately under the active profile's `workspace/hermes-app/open-session-live/release/`.

## Verified mobile publication outcome

The development Gateway was activated outside the release session. Authenticated public capabilities now advertise `open_session_live: true`; catalogue and the matching null-watch WebSocket handshake passed. Only after that verification was the runtime checkout moved to the published `96b1b8a` source and only Expo restarted.

Both public SDK57 iOS/Android manifests and their exact launchAssets returned HTTP 200. The served App module contains the scoped client, conversation open/release ownership, retained user drafts and durable-input path, with no App read reporting or hidden-history directory. Both Gateway PIDs/start times remained unchanged during mobile deployment. Entry: `exps://agent.tuly.space`.

Publication is complete for the existing Expo Go test distribution, not a signed standalone mobile installer. iPhone gestures, keyboard/network fault matrix and native RSS acceptance remain pending. Retain `f7434a7` and the private plugin rollback snapshot; do not roll back the backend's compatible old-client routes or authoritative chat data.
