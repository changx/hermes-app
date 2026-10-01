# DESK-LOAD-FEEDBACK — first-load feedback

Status: Done for first-load feedback (isolated candidate; not published). User reports v0.1.3 eventually loads after a long wait and explicitly requires user-facing loading feedback, not technical network diagnostics.

Scope: on the latest desktop candidate (including the read-loop fix), show natural English first-load feedback while saved access and the first authoritative conversation snapshot are loading. Suppress misleading empty-list/conversation copy during that wait. Do not expose technical states or create manual reconnect work. No transport, server, mobile, identity, credential, deployment or unrelated UI changes.

Acceptance:
- Startup waiting visibly says `Loading your conversations…` and provides an accessible status.
- Loading ends on real initial snapshot completion, not a timer, socket availability or a nonempty list guess.
- A successful empty snapshot displays normal empty content rather than remaining in loading forever.
- Actionable permanent errors remain visible and are not masked by a loading screen.
- Once data exists, transient reconnect does not replace it with first-load feedback.
- Desktop typecheck/build/regressions pass; native Mac package demonstrates cold startup loading and actual data arrival.
- Full network diagnosis and the original white-window cause are out of scope.

## Verification

- Code commit `45389eb`, latest `0.1.3` candidate including read-loop fix; no mobile/plugin/shared-client/core changes.
- The loading flag is derived from actual initial SDK snapshot completion (cursor establishment), including empty snapshots. This is local desktop IPC, not a server protocol change.
- `npm run check --workspace @hermes-app/desktop`: TypeScript and build passed; all 69 tests passed, 0 failed. Four new regressions cover natural accessible loading, real SDK empty-snapshot completion, actionable errors, and preserving loaded content while reconnecting.
- Native Apple Silicon packaging with pinned @electron/packager 20.3.0 and Electron 44.4.5 succeeded. Installed under `~/hermes-desktop-acceptance/loading-45389eb/installed/Hermes.app`.
- app.asar SHA-256: `3a284e4db83ef60f3bd9ee034f6c668e032098ad7c018469eb8f4dfea84fa53d`. Plist ElectronAsarIntegrity readback confirmed hash `f2a9d2b5cb5d9c88d507a88f951a32b4a938cc1e222f7311e244e6f0c6b3408b`.
- Native waiting-path test used the real HTTPS backend with an eight-second delay in a separate loopback transport relay. No fake API response, synthetic messages or injected App state. The boot debugger only configured test-process transport; App bytes were unchanged.
- During startup wait, real snapshot reported `loadingConversations=true`, accessible loading text was present in the visible renderer, no error banner and zero messages. A private actual screenshot was saved.
- After real initial data arrived, `loadingConversations=false` and the loading status disappeared while the SDK was still syncing. Loading does not wait for a socket or use a timer to guess completion.
- Restored the normal test relay, selected the exact current user conversation, and read back 51 real messages and public tools. Already-loaded content remained visible during subsequent reconnect/sync; first-load text remained absent.
- Initial attempts did not capture the waiting frame because data arrived quickly. One inspector SSH forward had stopped; restarted it. A duplicate lab process created during troubleshooting was stopped before the single-process delayed test. Only the successful controlled native run is counted as waiting-path evidence.
- The temporary delayed relay and reverse tunnel were terminated after verification. The normal restricted relay is retained for the running debug App. No system proxy/DNS/TCC changes, credential reset, profile change, Gateway restart or Expo restart.
- Development Gateway stayed PID 3838784, started Thu 2026-10-01 02:56:09 PDT. Candidate has not been merged, pushed, tagged or released for the user's MacBook.
