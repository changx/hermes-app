# Channel repository AGENTS.md binding

Task: `t_b28f2c2d`. Client branch: `feat/channel-repository-agents`; plugin branch: `feat/plugin-repository-agents` (standalone plugin repository history). This is a verified local candidate, not a deployed App update.

## Confirmed behavior

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

No main merge, push, live binding, runtime plugin replacement, Gateway/Expo restart or public manifest verification was performed. The running Channel still uses the old workspace target until deployment.

When this candidate is authorized for deployment, install the tested plugin into `hermes-app-dev` only, then register this project's repository using the existing local command:

```bash
hermes -p hermes-app-dev project add-folder p_6cf55361 /opt/projects/jamie/hermes-app --label 'Channel AGENTS source'
```

Do not change the primary workspace path or move/delete existing workspace files. Read back the exact ProjectDB registration and authenticated `/agents` bytes against the repository before claiming success. Merge the tested client candidate and restart only the affected development Gateway/Expo services through the approved external operator lane. Verify capabilities, HTTP/WS, history cold read, same-ID idempotence, a real model message, and both public manifests/exact launch assets.

Physical iPhone long-document scrolling, editing/selection, keyboard, background return, two-device conflict behavior and the unchanged chat network fault matrix remain device acceptance items. No Hermes core or other-profile modification.
