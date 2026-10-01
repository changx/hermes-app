# DESK-FIX-READ-LOOP — desktop blank-window investigation

Status: Review (local candidate only; not merged or released). User reports a blank macOS window after use; Toggle Developer Tools does not respond.

Scope: stop the desktop read-receipt → snapshot → read-receipt feedback loop. No mobile, plugin, Gateway, credentials, or deployment changes.

Acceptance:
- Repeated same-ref snapshots settle without additional read requests.
- Concurrent duplicate calls are suppressed before acknowledgement.
- Higher refs, different threads, and replacement clients can mark read.
- Failed requests remain retryable.
- Desktop typecheck, build, and tests pass.
- Blank-window cause and long-running macOS recovery remain unverified until device evidence is available.

Verification:
- Baseline main source executed with acknowledgement callback re-entering markVisible: 20 identical read requests, stopped only by the probe safety cap; read_ref had already reached 10.
- Candidate regression: acknowledgement callback plus 1000 repeated same-ref calls produces exactly one request. Concurrent duplicate, failed retry, replacement client, higher-ref and different-thread tests pass.
- `npm run check --workspace @hermes-app/desktop`: TypeScript and build passed; 45 tests passed, 0 failed.
- `git diff --check`: passed.
- Regression uses controlled client callbacks; not a real server or macOS renderer endurance test.
- No deployment, Mac SSH, service restart, credential changes, or chat-data changes performed.

Findings: Timeline depends on snapshot.messages array identity. Each main snapshot rebuilds that array. HermesClient.markRead notifies subscribers even when the returned ref equals the existing read_ref. The desktop markVisible path has no equality/in-flight guard. This creates a feedback cycle. The main process has no render-process-gone/unresponsive diagnostics; the React boundary cannot diagnose native renderer termination.
