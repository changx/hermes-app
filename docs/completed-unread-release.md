# Completed-unread blue dot: publication

<!-- status-refresh-2026-10-06 -->
> **Current status (verified 2026-10-06):** statements below that backend activation is pending, awaits a restart, or was blocked by the Gateway restart guard are outdated. The development Gateway restarted at 2026-10-05 20:43 PDT and runs plugin v0.2.5 (plugin repository main `6abdaa4`); the related capabilities are live. Physical-device acceptance status is unchanged. See [development environment](dev-environment.md).

Jamie authorized main merge and publication, then narrowed the visible marker to **one blue dot without status text**. Accessibility retains `Completed, unread`.

## Source and clients published

- App main and tag `v0.1.10`: `16064912ebf4cfb6281d69ba1050b35c98ec90ee`. Includes feature `2c75d5f`, dot-only correction `2eb471f`, and version metadata. Remote main/tag were read back after push.
- Standalone plugin main: `6988993f8ea032a0a9c7a2ede8a3f8c4b187d9eb`, read back from `changx/hermes-app-plugin`. This merges only the completed-result change onto its already published source main; it does not activate that main's pending workspace feature.
- Expo development entry remains `exps://agent.tuly.space`. Only Expo restarted for client publication. Public iOS and Android manifests and each exact launchAsset returned HTTP 200, SDK 57. Both served bundles contain the directory field, result ACK path, visible-result callback, blue-dot style and accessibility label, and contain no visible `Completed · Unread` string. These checks establish resource publication, not iPhone visual acceptance or an independent mobile install package.
- Desktop [v0.1.10 release](https://github.com/changx/hermes-app/releases/tag/v0.1.10) is published in the existing private repository. macOS arm64 workflow `37065103392` passed checks, dependency audit, packaging and publishing. Downloaded ZIP checksum, ZIP integrity, actual packaged version and ASAR blue-dot/ACK code were verified. Archive `Hermes-0.1.10-macOS-arm64.zip`, 129941294 bytes, SHA-256 `a804c0b02b82f37e53e57410098a03578dc0553cacc3823d89cc9b4ec2cfcd43`. Unsigned/not notarized; no Mac native launch is claimed.

## Backend activation blocked

The active Gateway refused an internal restart because the calling task is its own descendant. No signal, detached process, scheduler, SSH workaround or other bypass was attempted.

**The shared completed/read state is not live yet.** Public authenticated capability readback still reports `shared_result_read=false`. The currently installed plugin remains byte-identical to `6b8fbb6`; neither development nor Jamie Gateway restarted. Client code stays compatible with this older directory response and does not invent blue-dot state locally.

For minimal activation, a deployment branch cherry-picks just this feature onto the exact installed `6b8fbb6` source. Deployment source `62823d9`, only `storage.py`, `live.py`, and `adapter.py` runtime files differ; no workspace APIs or pending workspace manifest changes are included. Focused processing callback, actual authenticated HTTP/WS, shared state, old-ACK and history receipt regressions passed **18 tests**, one optional SDK probe skipped.

The code-only artifact is `hermes-app-plugin-0.1.1-f0e163ba386fb06576eed9213bcd089a04623f4c7698c20989b3b30a8daa7d10.tar.gz`. SHA-256 and every source member were compared to the minimal deployment source. Existing installed source and a code-only rollback copy were read back and verified.

Run from an independent external server shell, after current App tasks finish:

```bash
bash /home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/completed-unread/release/release.sh
```

The script refuses a target-Gateway ancestor, checks queued/running tasks and the exact baseline/artifact, stops only hermes-app-dev, installs/readbacks plugin code, starts only that service, and then checks public authentication, two directory-only observers, same-ID ingress, a real model result, cold history and persistent shared read clearing. It does not restart Expo/Jamie, reload service configuration, upgrade core, touch credentials, restore chat databases or install workspace features. Syntax, artifact preparation and the baseline HTTP/WS mode were exercised; **installation and post-start/model gates have not run**.

## Evidence, rollback and remaining acceptance

Private evidence and operator lane: active-profile `workspace/hermes-app/completed-unread/release/`. Includes source/service/hash baseline, both manifests and exact bundles, desktop ZIP/sidecar/ASAR checks, minimal artifact and rollback code, and authenticated backend baseline without credentials. The deployment remains pending activation.

Client rollback baseline is `9227691148443268538b38c322f7db5910e3ba9a`; use explicit Git reverts of the three client publication commits and restart only Expo. Do not replace history databases. Desktop rollback uses existing v0.1.9 release. Backend has not changed; once externally installed, code-only rollback must use the preserved `6b8fbb6` baseline and restart only the development Gateway externally, retaining all plugin metadata and history.

Backend activation/real-model verification and physical-device visibility/read timing remain unverified. No signed standalone mobile package, production configuration, core update or other-profile deployment is included.
