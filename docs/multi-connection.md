# Multi-connection: mobile pairing and Project unread counts

Branch `feat/multi-connection` in `/opt/projects/jamie/_worktrees/hermes-app/multi-connection`, based on main `e6c2d57`. Not merged, not published.

## Confirmed design (Jamie, 2026-10-05)

- All paired Hermes connections connect at the same time. A failure on one connection never affects another.
- Navigation is centered on Projects, not connections. Desktop and mobile show one flat Project list. The Hermes name is secondary text under the Project name. There is no Hermes grouping level and no connection switcher.
- A Project shows a **number**: the count of its sessions that have an unread completed result. One session counts once. Archived sessions do not count.
- Reading rules do not change: only a result that is visible in the foreground is acknowledged. Opening a Project or a list does not clear the count. Other devices clear through the shared directory state.
- Remove + pair again is a new connection. Local drafts and queued messages of the removed connection are deleted. There is no in-place re-pair and no server instance ID.
- The existing multi-session page lifecycle is reused unchanged. Each connection has one WebSocket; each live page adds one `watch` on it.

## Implementation

Shared: `packages/client/src/projectDirectory.ts` counts unread sessions per Project and orders Projects by name, then Hermes name, then ID.

Desktop (multi-connection already existed, see [Desktop Connections](desktop-connections.md)):
- Project rows show the count badge (`#1a66c9`, white digits) and an accessible description.
- Sessions with an unread result are always in the default tree window, so a count never points at hidden rows.
- A Project of a connection that is reconnecting, offline or blocked shows a short hint. The last known count stays.

Mobile:
- `connectionSlots.ts`: the existing connection becomes the `primary` slot with the original SecureStore keys. No pairing again; drafts and outbox keys are unchanged. Other slots use suffixed keys; `hermes-app-connections-v1` lists only slot IDs. Limit: eight connections. A damaged slot is reported; a damaged index is an error, never an empty list.
- `connections.tsx`: one `LivePageClient` and one `MobileOutbox` per connection, each with its own status, retry, errors and pairing task. Foreground connects all; background pauses all.
- Routes carry `connection`. Older routes without it belong to `primary`. Session links open with the saved connection that matches their server. Links to an unsaved server ask the user to add that connection.
- The root Stack is no longer remounted when a connection changes. Removing one connection pops only its routes and viewers; pages of other connections keep scene, scroll and draft.
- Home is the flat Project list with counts and connection hints. Connections that have no directory yet are listed below as pending rows, never as fake Projects.
- Connections screen lists, adds and removes connections with the desktop wording. New channel requires an explicit target Hermes when several exist.

### Leveled Settings (2026-10-06)

Jamie asked to move connections into Settings and organize Settings into levels. The mobile header now has one **Settings** icon (gear); the separate antenna icon is removed.

- **Level 1 — Settings:** section *Connections* lists each saved Hermes with its server and state, then *Add connection*. Section *Appearance* has *Font size* with the current value.
- **Level 2 — a connection:** *Status* (server, state, safe detail), *Agent* (display name on this device), *Default model* (only when online), then *Remove connection* with confirmation. Removing the connection pops its page through route ownership.
- **Level 2 — Add connection:** pairing form; on success it opens the new connection's page, where pairing progress appears.
- **Level 2 — Font size:** device preference.
- First run with no connection uses `/welcome`, a full-screen pairing form outside Settings.
- The gear on a channel or conversation opens that connection's page directly. The gear on the home screen opens level 1. *(Superseded: every gear now opens level 1, and sections are grouped by scope; see [Unified Settings](unified-settings.md).)*
- Routes: `/settings`, `/settings/connection?connection=<slot>`, `/settings/add-connection`, `/settings/font-size`, `/welcome`. The old `/connection` and single `/settings` pages are removed.

No plugin, Hermes core or protocol change.

## Verification (Linux, synthetic fixtures)

- Shared client tests: project directory 5/5.
- Desktop: TypeScript, build, full suite with Chromium and Electron/Xvfb **100/100, 0 skipped**. New Chromium test renders the production tree with two connections, equal raw IDs, an offline connection and old unread sessions. One existing sidebar fixture was renamed because Projects now sort by name.
- Mobile: TypeScript; full suite **94 pass, 0 fail, 1 skipped** (pre-existing skip), three runs. The 17 existing lifecycle tests now run on the real `connections.tsx`; a new test checks two independent clients and outboxes, failure isolation, draft isolation with equal thread IDs, and that removing one connection keeps the other page and scene. Slot storage, legacy migration, route removal and Project rows have unit tests.
- One run of the full mobile suite failed an existing outbox timing test (`polling nonretryable receipt failures…`); it passed in isolation three times and in two further full runs. `outbox.ts` is unchanged. This is recorded as an existing timing sensitivity, not as fixed.
- iOS and Android offline Expo exports succeed.

## Not verified

- No real two-server pairing, real model traffic or device test. iPhone list, header subtitle, keyboard and removal behavior, and Mac visual review remain separate acceptance.
- `navigation.resetRoot` route pruning is tested as a pure state function; the native Stack behavior on iPhone is not yet observed.
