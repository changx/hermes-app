# Mobile Workspace entry and minute times: publication

Jamie authorized publication after the local merge-only step. Published client source: `11a933684e805a9a1cc3d1996f60fb641f49f9e4`, including Files/AGENTS `f2a3347`, minute-time `1314a60`, and the already deployed failed-send recovery `03a3735` / integration `201b589`. This avoids reverting the other task's live recovery fix.

## Scope and gates

- Runtime source moved from detached `0e87ea496951bb7c4c8d2a6e9b26eb2555e21576` to exact integrated main source `11a9336`. Main remains checked out in the mobile-workspace-entry worktree; source was pushed to origin/main and read back.
- Only the existing Expo service restarted. Both Gateway PID/start states, installed plugin hashes, fixed core commit and mobile lock hash were read back unchanged. No npm ci, plugin copy/install, Gateway operation, phone-data clearing, message resend or chat-database write.
- Reused earlier complete candidate gates. Because main had since integrated failed-send recovery into App.tsx, the combined source received an additional mobile TypeScript check and 44 targeted timestamp/workspace/preview/recovery/lifecycle/notice/English tests, all passing; not a repeated full-suite release gate.
- Both combined native exports succeeded with explicit Router root and cleared Metro build cache. Public iOS and Android manifest plus each exact launchAsset returned HTTP 200 and SDK/runtime 57.
- Served modules verify exact `<1m`, no seconds in visible/accessibility absolute time, fixed 60000ms relative refresh, native Files/AGENTS routes, capability-gated links, original-version conditional writes, readback/conflict/draft controls, retained failed-send durable-identity recovery/notice reconciliation, and retained light-blue completed-unread dot.

## User entry and remaining boundary

Entry: `exps://agent.tuly.space` (Expo Go testing, not an independent signed installation package).

Client deployment is complete; server Workspace deployment is not. Authenticated public capabilities and live WS were read again after publication and still show Workspace false. Thus Files/AGENTS code is served but its ordinary entry remains hidden until the backend advertises the real APIs. This client release did not bypass the separate self-Gateway restart guard or claim the server interface live.

Physical iPhone minute updates, folder navigation, guidelines keyboard/selection/conflict handling and preview/background behavior remain separate acceptance. Resource readback is not proof of native usability.

Private before/after service/source/plugin/lock evidence, exact manifests/bundles/module excerpts and `verification.json`: active-profile `workspace/hermes-app/mobile-workspace-entry/release/`. Candidate integration logs/exports are `publication-*` files in its parent.

Rollback baseline is the previously published recovery source `0e87ea4`; if authorized, explicitly restore that runtime source and restart only Expo, retaining all chat/outbox data. A source-publication rollback must revert the applicable client commits on main, not reset user databases or move existing desktop release assets.
