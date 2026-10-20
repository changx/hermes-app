# Mobile Session options page

Branch: `feat/mobile-session-options`.

## Confirmed scope

- The mobile Session (Thread) page shows one header button on the right: an ellipsis icon labeled `Session options`.
- The button opens `threads/[threadId]/options`, a native Stack page titled `Session options`. It uses the grouped Settings style.
- The page holds every function that the Session header offered before:
  1. `This session` → `Labels` (only when the connection supports labels). The row shows the current labels or `None` and pushes the label editor page (see below).
  2. `This session` → `Files` (only when the connection supports Session files). It pushes `threads/[threadId]/files`, the Session files page (see [session-files.md](session-files.md)).
  3. `This session` → `Copy session link`. It copies the stable link and shows the shared copy toast.
  4. `App` → `Settings`. It opens the same Settings home as the gear on the home and Channel pages.
- The route carries the resolved connection slot, so a Session opened from a `server` link still gets the correct connection.
- An archived or missing Session shows `This conversation is unavailable.` and no actions.

## Label editor page

Branch: `feat/mobile-labels-page`.

- The label editor is a pushed native Stack page, `threads/[threadId]/labels`, titled `Labels`. It replaces the earlier bottom-sheet modal.
- Both entries push this page: the `Labels` row on Session options, and `Edit labels` in the Channel list long-press and accessibility menu. The route carries the connection slot.
- The page uses the grouped Settings style. It shows the Session title, the current labels with Edit and Remove, an input row with Add or Update, `Existing labels` for reuse, and `Clear labels`.
- `Save` is in the header. A confirmed save returns to the previous page. Back discards the draft. While a save runs, Back and the swipe gesture are disabled.
- A failed or different authoritative result keeps the draft on the page with a short message. Offline or unavailable sessions disable editing.
- The label filter in the Channel list stays a bottom sheet.

Verification: mobile TypeScript passes. Mobile tests: 112 total, 111 pass. The only failure is the known `tests/local-draft-storage.test.mjs` failure (no repo-root `node_modules/esbuild`). New `tests/session-labels-page.test.mjs` covers header Save, add/reuse, mismatch handling and the offline state. The iOS and Android exports pass. iPhone checks of the transition, keyboard and back gesture are pending.

Development release: `f50d113` was released to `exps://agent.tuly.space` (fast-forward from `a806d5d`, lockfile unchanged). Only `hermes-app-expo.service` was restarted (PID 1389957 → 1462471). The `hermes-gateway.service` PID 1305834 and the plugin did not change. The public iOS and Android manifests return HTTP 200 with SDK 57. Each launchAsset returns HTTP 200, contains the new route and page markers, and does not contain the old sheet text. Evidence: private `workspace/hermes-app/mobile-labels-page/`. Rollback baseline: `a806d5d`. iPhone acceptance is pending.

## Session menu on every Session row

Requested by Jamie: every Session row opens the Session menu on a long press, wherever the row shows, unless the row turns it off explicitly.

- Rows with the menu: the Channel list, the Recents tab (Todo, Recent and search results), and the conversation list on an Automation page.
- One item list and order everywhere (`src/sessionMenu.ts`): `Mark as todo`/`Remove todo`, `Rename session`, `Edit labels`, `Archive session`. The todo and label items show only when the connection supports labels. Archive asks first.
- Rename: the Channel list keeps its inline rename field (all platforms). Recents and Automation pages use the system text prompt, which exists only on iOS, so Android has no rename there.
- Each row gets the hint `Open session. Long press for options.` and the same items as screen-reader actions. While an action runs, the long press and the actions wait.
- Recents and Automation pages use `useSessionMenu` (`src/useSessionMenu.ts`). Each action runs on the row's own connection. A failed action shows a short message on the page. The Automation page reloads its list after a change, because that list is a page snapshot.
- A row turns the menu off with `disabled: true` on its menu target.
- Message links to a Session (`hermesapp://session/…`) are links in text, not Session rows; they have no Session menu.

Verification: `tests/session-menu.test.mjs` (item order, label support, busy wait, archive confirm, every row list uses the shared menu), `tests/recents-search.test.mjs` (Recents rows on each connection), `tests/channel-archive.test.mjs` (Channel list). iPhone acceptance is pending.

Development release: `cd8007d` (merge of `fix/recents-long-press`) was released to `exps://agent.tuly.space`, lockfile unchanged. Only `hermes-app-expo.service` was restarted (PID 2680628 → 2761470). The `hermes-gateway.service` PID 2694627 and the plugin did not change. The public iOS and Android manifests return HTTP 200 with SDK 57. Each launchAsset returns HTTP 200 and contains the new hint and archive text. Evidence: private `workspace/hermes-app/20261012-recents-long-press/`. Rollback baseline: `576327a`. iPhone acceptance is pending.

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
