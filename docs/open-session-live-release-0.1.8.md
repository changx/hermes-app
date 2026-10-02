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
