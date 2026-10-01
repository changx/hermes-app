# DESK-FIX-READ-LOOP — desktop read acknowledgement feedback fix

Status: Done for the loop defect (automated regression, native macOS package and real-device verification). Code is now included in `main` following the user's code-only submission request. This submission does not package or publish a GitHub Release. This does not close the separate blank-window investigation.

## Scope and source

- User requested fixing the confirmed loop, then explicitly directed using the latest version instead of 0.1.2.
- Latest baseline: `origin/main` / `v0.1.3`, commit `ba06a9b130c9f507243cbbde3403184267e8fd69`; remote readback still matched at verification end.
- Code commit: `b903cb7` on `fix/desktop-latest-read-loop`.
- Only read-feedback main/renderer behavior, regression tests and this evidence changed. Latest tree navigation and silent network recovery are retained.
- No mobile, shared-client, plugin, Hermes core, Gateway or Expo changes. No GitHub release or signature/notarization work.

## Acceptance and implementation

- Repeated same-ref snapshots settle without additional read requests: confirmed automatically and on the Mac mini.
- Concurrent duplicates are suppressed before acknowledgement: per-client in-flight tracking, tested automatically and over real renderer IPC.
- Higher refs, different threads and replacement clients can mark read: regression tests and real new-message/thread-switch verification.
- Failed requests remain retryable: in-flight tracking is removed on failure; automatic regression passes; renderer rechecks after visibility/connection state changes.
- Renderer effect depends on the visible ref, selected thread, following and connection state instead of the cloned messages-array identity.
- Main skips refs already covered by the authoritative shared client's read_ref. No timer is used to pretend acknowledgement succeeded.

## Automated verification

- Isolated locked desktop dependency install; no edits to another worktree's node_modules.
- `npm run check --workspace @hermes-app/desktop`: TypeScript, main/preload/renderer build, 65 tests passed; 0 failed/skipped.
- Includes latest silent-network-recovery tests plus five read-feedback regressions: 1,000 identical calls, racing duplicates, retry after failure, replacement client and invalid/missing selection.
- `git diff --check`: passed.

## Native macOS package

- Built runtime from the isolated source commit; used the existing pinned @electron/packager 20.3.0 on the Apple Silicon Mac mini to produce the final package with Electron 44.4.5.
- The Linux cross-package was not used as the final artifact because it warned that asar integrity enforcement was unavailable there.
- Native installed executable readback: Mach-O 64-bit executable arm64; plist version 0.1.3; ElectronAsarIntegrity present.
- app.asar SHA-256: `e5bfa0cebbe4de2636cdd71e419370226a25cf0765f96cda49fa4ea5fecd6765`.
- Final archive: `Hermes-0.1.3-read-loop-b903cb7-macOS-arm64.zip`.
- Archive size: 128,994,093 bytes; SHA-256: `d8b81baa2059c40475635849d7fed147547febc086f958ceddf9e69d8011953e`.
- Mac source archive and copied Linux artifact hashes match. Initial SCP timed out; resumed with rsync and verified the completed copy.
- Unsigned development candidate, not a replacement for the published v0.1.3 archive. Retained privately in the active development workspace and Mac acceptance directory.

## Real Mac verification

- Reused a copy of only the previously authorized test user-data directory; no new administrator/device credentials sent to the renderer and no user's MacBook changes.
- Network test plumbing retained from the preceding investigation: restricted SSH loopback CONNECT relay and process-local proxy dispatcher, with end-to-end TLS checks. Original system DNS/proxy/TCC settings unchanged. This validates the loop fix, not uninstrumented system-proxy support.
- Installed the real fixed .app and confirmed the debugger identifies Hermes/0.1.3.
- Selected the exact current conversation: `th_7a57f5511766427cb1f565904a54b584`, channel `p_6cf55361`.
- Initial foreground sample: 50 real messages and public tools. Read requests were exactly 1 before and after a 60-second observation; state reached online, no error banner, root remained mounted.
- First batch of 100 duplicate renderer calls encountered a newly advanced ref and generated exactly one additional request (counter 1 → 2), not 100.
- In a separate existing test thread, the real desktop submitted a message and displayed the actual model reply `DESKTOP_READ_LOOP_FIXED_OK`; running became false. No test message sent to the user's current conversation.
- Foregrounding the new reply advanced the read counter to 3. A second batch of 100 calls to that already-confirmed ref left it exactly 3.
- Returned to the user's current conversation. Final sample after 584,867 ms on that visit: online, 57 messages, no error banner, root mounted. Total counter across both threads and new refs was 7; no runaway loop.
- Renderer-exit events: none. Unresponsive events: none. DevTools opened and isDevToolsOpened readback confirmed true, then closed normally.
- Development Gateway unchanged: PID 3838784, start Thu 2026-10-01 02:56:09 PDT. No service restart.
- Screenshots and diagnostic scripts/logs remain private and are not committed.

## Remaining boundary

The read-feedback defect is fixed and exercised on the latest desktop baseline. This does not prove that every cause of the user's original blank window is fixed, and no long-duration memory-stability or automatic crash-recovery claim is made. Code-only submission to `main` uses `[skip ci]` because its push workflow otherwise packages the app. The previously verified native artifact has not been published for installation on the user's MacBook; no new package or Release is created by this submission.
