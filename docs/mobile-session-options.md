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
