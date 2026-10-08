# Channel repository AGENTS.md binding

<!-- status-refresh-2026-10-06 -->
> **Current status (verified 2026-10-06):** statements below that backend activation is pending, awaits a restart, or was blocked by the Gateway restart guard are outdated. The development Gateway restarted at 2026-10-05 20:43 PDT and runs plugin v0.2.5 (plugin repository main `6abdaa4`); the related capabilities are live. Physical-device acceptance status is unchanged. See [development environment](dev-environment.md).

Client branch: `feat/channel-repository-agents`; plugin branch: `feat/plugin-repository-agents` (standalone plugin repository history). Both were merged/pushed to main after explicit authorization. Client resources are deployed; backend source/binding are staged, but Gateway activation is still blocked from this active Gateway process. This is not a complete backend release.

## Confirmed behavior

> **Superseded in part (2026-10-08):** clients can now bind a Channel primary path inside `/opt/projects`, and AGENTS.md follows it. The `Channel AGENTS source` label remains a fallback. See [Channel primary path](channel-primary-path.md).

- Channel workspace and code repository remain separate. Workspace files and task outputs keep their existing managed root.
- An explicitly bound Channel's AGENTS.md editor reads and conditionally writes the repository's actual root `AGENTS.md`. No document copy, directory symlink, whole-repository file browser, or additional authority store.
- The root generic `file?path=AGENTS.md` route resolves the same bound file. The root Files listing presents that target once; an old workspace copy is preserved on disk but is not selected or displayed as a second authority. Other relative files still belong to the workspace.
- Binding uses the existing Hermes ProjectDB folder registration with exact label `Channel AGENTS source`. Only local administration can register it; no HTTP request can choose a host path. Multiple bindings fail closed. Unbound Channels retain their original workspace-based behavior.
- Repository guidelines can be read/edited before initializing Files; additive `agents_available` state distinguishes document availability from workspace initialization. Older servers remain compatible.

## Removal of 12 KB restrictions

- Plugin, shared SDK, and native editor no longer impose a special 12,000-byte/character cap. Native TextInput no longer has `maxLength={12000}` and does not truncate input.
- The existing ordinary-file resource guard of **10 MiB of UTF-8 content** remains, rather than offering unbounded allocations. Old servers' negotiated limits are still respected by the editor.
- AGENTS JSON requests/responses have a bounded `6 × 10 MiB + 4096` wire allowance for JSON escaping. Other workspace metadata keeps its smaller limit; other API request limits are unchanged. Invalid Unicode is rejected rather than normalized.
- Original ETag / If-None-Match, conditional conflict detection, atomic publication, exact save readback, lost-response reconciliation and draft protection remain intact.
- The supported initial prompt section stays at 4,000 characters. Oversized rules use the exact repository AGENTS.md path and a full-file read instruction; the UI/edit limit is not a model-context limit. Existing session snapshots remain frozen.

## Local verification

- Shared SDK TypeScript and mobile TypeScript passed.
- Shared SDK suite: **89 passed**.
- Mobile suite: **472 tests, 471 passed, 1 optional Chromium skip, 0 failures**.
- Editor/transport targeted gates: **23 passed**.
- Plugin workspace/repository gates including the real App transport/SDK probe: **34 passed**. Expanded authentication/storage/completed-read selection: **52 passed**.
- Broader non-runner plugin selection: **294 passed, 2 skipped, 0 failures**. These skips are optional SDK gates; the new repository SDK gate was separately explicitly exercised.
- Real loopback HTTP used actual authentication middleware, ProjectDB, separate managed/repository files and native fetch transport. A repository AGENTS document over 12 KB and a >1 MiB Unicode update roundtripped exactly; two-client stale-version rejection, generic-file byte identity, cold reopen, separate workspace, no repository secret-file exposure, symlink/hardlink/FIFO/writable/ambiguous source rejection and two-writer serialization passed. Test data is isolated; no live repository file was modified by this probe.
- Full plugin P1 suite was attempted but did not pass: model-selection tests return 503 and a full run timed out. The first model-selection failure was reproduced on the untouched `7eebd30` plugin baseline with the same test environment. This is not recorded as a full-suite success and is outside this change's scope.
- iOS and Android SDK 57 Expo exports succeeded. They are development bundle artifacts, not signed installation packages or proof of iPhone behavior.

## Deployment boundary

Authorized publication: App main `dfba2f9` retains the independently added edge-to-edge message colors; plugin main `64e49fe` is version 0.2.1. Both GitHub main refs were read back exactly. The running App source was switched to the merged main commit, keeping the earlier local documentation changes in that commit and a named stash backup. Lockfiles were unchanged; no npm ci or full-suite rerun at publication.

The exact plugin archive SHA-256 is `007763f56b1031a2953b837f84dc0a8f216c136238e9c538b09ccb3f5d04c67c`. Only `workspace.py` and `plugin.yaml` changed in the active-profile installation; exact source and code-only rollback/service snapshots were verified. The existing ProjectDB folder registration now labels `/opt/projects/jamie/hermes-app` as `Channel AGENTS source`; the primary managed workspace path was read back unchanged. No files/chat data were moved or erased.

Only Expo was restarted. Public iOS/Android manifests and their exact launchAsset responses returned HTTP 200, SDK 57.0.0, the new repository-guidelines markers and no native 12K character cap. Actual public bundle SHA-256: iOS `182f86f55930b0e3325aa6cf72859cb696ca8894c2322a4d9c295043e0f92a16`; Android `a662b238e0c7a43b740407aa18a6aed05fdc84d4434afdb1c4cbebeb5a772b88`. The initial public readiness/header attempts failed; final exact-resource readback passed. This is Expo Go development publication, not a signed standalone package.

Dev Gateway self-restart was refused by lifecycle protection. It retains PID 2458282 and the old in-memory workspace-only implementation; authenticated public state still reports `agents_bytes=12000` and no repository source. Backend target identity, real model and cold-history post-activation gates cannot be claimed yet. Jamie's Gateway stayed unchanged. Do not restart via detached jobs/signals or another self-managed lane to evade protection.

An independent user terminal can finish activation, after active App tasks end:

```bash
bash /home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/channel-repository-agents/release/activate.sh
```

The script refuses a Gateway-descendant process, checks no active App tasks, restarts only the dev Gateway, then verifies actual repository bytes/versions, authentication, HTTP/WS, same-ID idempotence, a real model message and cold history. It is prepared but has not run; even the attempted combined syntax-check call was intercepted by lifecycle protection. Private evidence and exact rollback code are under the same `release/` directory. Rollback baseline: App runtime `11a9336`, plugin `7eebd30`; restore only affected code/services or use explicit Git reverts, never chat databases.

The authorized extra AGENTS.md link/status synchronization was still refused by protected-file approval timeout. It was not retried via another tool or API; documentation here records the pending index update.

## Origin of the former 12 KB ceiling

Git history identifies plugin `08fca72` as introducing `AGENTS_BYTES = 12000` with the managed file API. Mobile `f2a3347` added shared-client `MAX_AGENTS = 12000` and native `maxLength={12000}`. The historical API documentation calls it a special rules-file resource limit. It was an implementation choice, not a Hermes core or user requirement; initial prompt budget is a separate supported-extension limit.

Physical iPhone long-document scrolling, editing/selection, keyboard, background return, two-device conflict behavior and the unchanged chat network fault matrix remain device acceptance items. No Hermes core or other-profile modification.
