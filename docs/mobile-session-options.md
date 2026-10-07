# Mobile Session options page

Kanban: `t_0965eebd`. Branch: `feat/mobile-session-options`.

## Confirmed scope

- The mobile Session (Thread) page shows one header button on the right: an ellipsis icon labeled `Session options`.
- The button opens `threads/[threadId]/options`, a native Stack page titled `Session options`. It uses the grouped Settings style.
- The page holds every function that the Session header offered before:
  1. `This session` → `Labels` (only when the connection supports labels). The row shows the current labels or `None` and opens the existing label editor.
  2. `This session` → `Copy session link`. It copies the stable link and shows the shared copy toast.
  3. `App` → `Settings`. It opens the same Settings home as the gear on the home and Channel pages.
- The route carries the resolved connection slot, so a Session opened from a `server` link still gets the correct connection.
- An archived or missing Session shows `This conversation is unavailable.` and no actions.

## Not included

- Home and Channel headers keep their Settings gear.
- Desktop, plugin, protocol and server behavior do not change.
- The label pills below the Session title and the long-press label entry in the Channel list do not change.

## Verification

- Automated checks: `tests/session-options.test.mjs` (rows, order, editor open/close, copy, Settings) and `tests/settings-levels.test.mjs` (every Settings entry opens Settings home).
- iPhone hand checks (header shows one button, page transition, label save, copy toast, back gesture) are recorded separately. They are not covered by the automated checks.

Results: mobile TypeScript passes. Mobile tests: 109 total, 107 pass, 1 skipped, 1 fail. The failure is `tests/local-draft-storage.test.mjs`. It also fails on `main` before this change, because the repo root has no `node_modules/esbuild`. The iOS and Android exports pass.

## Development release

Released `2703c4c` to `exps://agent.tuly.space` (fast-forward from `d9849f2`, lockfile unchanged). Only `hermes-app-expo.service` was restarted (PID 1292938 → 1389957). The `hermes-gateway.service` PID 1305834 and the hermes-app-dev plugin did not change. The public iOS and Android manifests return HTTP 200 with SDK 57. Each exact launchAsset returns HTTP 200 and contains the new route and page markers. Evidence: private `workspace/hermes-app/mobile-session-options/`. Rollback baseline: `d9849f2`. iPhone acceptance is pending.
