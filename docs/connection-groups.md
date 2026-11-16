# Connection groups

Branch `feat/connection-groups` in `/opt/projects/jamie/_worktrees/hermes-app/connection-groups`, based on main `bde13c1`. Not merged, not published.

## Requirement (Jamie, 2026-11-16)

- Keep Sessions and Projects of different connections apart, for example work and home. Today the sidebar mixes them.
- A **connection group** is a named set of connections, for example Work and Home.
- Each connection belongs to one group at most.
- When the user switches groups, the tabs of the other groups are hidden. They come back when the user switches back.
- Desktop and mobile both get groups.

This changes one point of [multi-connection.md](multi-connection.md): "no connection switcher". Navigation stays centered on Projects. The group only decides which connections the lists show.

## Behavior

### Rules (both platforms)

Shared module: `packages/client/src/connectionGroups.ts`.

- A group has a name and a list of connections. The name rule is the same as for connection names: trimmed, 1–40 characters, no control or bidirectional override characters. Names are unique, without regard to case.
- This version supports 8 groups.
- **All** shows every connection. All is not a group; it is the state "no active group".
- A group shows only its own connections. A connection without a group shows only in All.
- With no groups, nothing changes: there is no switcher, and every list shows every connection.
- Deleting a group moves its connections to "no group". If the deleted group was active, All becomes active.
- Removing a connection removes it from its group. A later pairing in the same slot starts without a group.
- Groups are a device preference, like connection names. They are not sent to a server and do not change on other devices.
- Groups never change what a connection does. Every saved connection stays connected, receives results, runs tasks and keeps its open pages.

### What the active group limits

| Area | Desktop | Mobile |
| --- | --- | --- |
| Projects | Sidebar Project tree | Channels tab |
| Recents and Todo | Sidebar sections | Recents tab |
| Search (titles, messages, files) | ⌘K search | Recents search |
| Automations | Sidebar section and Automations tab | Automations tab |
| New chat / new conversation | Project list of the page | Channel list of the page |
| New Project / new channel | Connection list of the dialog | "Create in" list |
| Tabs | Tab strip, ⌘Tab, tab menu | — (mobile has no tabs) |

Settings always lists every connection.

### Unread results of other groups

- The switcher shows a blue dot when a connection of another group has a completed, unread result.
- In the switcher menu, each group with an unread result has a dot.
- All has no dot. All already shows every connection.

### Desktop

- The switcher is the footer of the left sidebar (Jamie, 2026-11-16). It stays at the bottom edge and does not scroll with the lists. It shows the active group's name and a chevron. A click opens a native menu: All, each group (the active one is checked), then **Edit Groups…**, which opens Settings > Groups. On macOS the checked group opens over the switcher, like a pop-up button.
- **Settings > Connections > Groups**: add, rename and delete groups; choose the group of each connection.
- Tabs: the tab strip, ⌘Tab and the tab menu (Close Tabs to the Right, Close Other Tabs) use only the active group's tabs. Hidden tabs stay open with their page, scroll position and draft.
- Each group remembers its last active tab. When the user switches back, that tab becomes active again.
- The Automations list tab belongs to every group. It reloads when the group changes and lists the active group's jobs.
- A Session link (`hermesapp://…`) to a connection of another group first shows that group, then opens the Session.
- A new chat starts on a connection of the active group.
- Storage: `connection-groups.json` in the app data folder, `{ version: 1, state }`, with group names and slot IDs only. A damaged file shows every connection and blocks group changes, so it is never overwritten.

### Mobile

- The switcher is in the header of each tab (Recents, Channels, Automations), left of Settings. It shows the active group's name and a chevron.
- iOS: a tap opens an action sheet: All, each group (the active one has a check mark), **Edit Groups…**, Cancel. Android: a list sheet with the same choices.
- **Settings > Connections > Groups**: the groups with their number of connections, and a field that adds a group. A group opens its own page: its name, a checklist of connections, and Delete group. Choosing a connection that is in another group moves it to this group.
- Each connection's page has a **Group** row in "On this device". It opens Settings > Groups.
- Pages that are already open (a Thread, a channel) stay open when the group changes.
- Storage: SecureStore item `hermes-app-connection-groups`, `{ version: 1, state }`. A damaged item shows every connection and blocks group changes.

## Implementation

- Shared: `packages/client/src/connectionGroups.ts`. It has no imports, so desktop (esbuild) and mobile (Metro and Node tests) load it the same way.
- Desktop main:
  - `connection-index.ts`: `ConnectionGroupStore` (save, read back, compare).
  - `connections.ts`: group state and changes. `current()` prefers a connection of the active group. `visibleConnectionKeys()` and `activeGroupId()` for the tab manager. Automations, message search and file search ask only the active group's connections. The snapshot carries `connectionGroups` (with `unread` slot IDs) and each connection's `groupId`.
  - `tab-manager.ts`: narrows `channels`, `threads` and `connections` of the main window, and `channels` and `threads` of tab pages (a tab keeps its own connection). Hides other groups' tabs and restores each group's last tab.
  - `index.ts`: `desktop:add-group`, `desktop:rename-group`, `desktop:remove-group`, `desktop:assign-group` (Settings window only) and `desktop:group-menu` (main window only).
- Desktop renderer: `GroupSwitch` in `navigation-panel.tsx`, placed by `native-workspace.tsx` below the sidebar's scrolling lists; `group-settings.tsx`; Settings page `groups`.
- Mobile: `connectionGroupStore.ts`; group state and `shownConnections` in `connections.tsx`; `GroupSwitch.tsx` in `TabHeader`; `GroupSettings.tsx` with routes `/settings/groups` and `/settings/group?group=<id>`.

No plugin, Hermes core or protocol change.

## Verification (Linux, synthetic data)

- Shared rules: `packages/client/tests/connection-groups.test.mjs`, 8/8.
- Desktop: TypeScript and build pass.
  - `native-tabs.test.mjs`: a new test switches between two groups. It checks hidden tabs, the restored tab of each group, narrowed lists, the tab menu, and that a hidden connection's selection does not activate its tab. 10/10.
  - `sidebar-groups.test.mjs` (Chromium): no switcher without groups, switcher in the sidebar footer at the bottom edge and New chat still first in the list, unread dot only for another group, All without a dot, menu position. Pass.
  - Full suite with `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 xvfb-run -a npm test`: 307 pass, 11 fail, 0 skipped. Unchanged `main` on this host: 307 pass, 10 fail. The same 10 tests fail on both. The eleventh ("production right browser previews attachments") passes alone on both trees; it fails only under the load of the full run.
- Mobile: TypeScript passes. Full suite 281 pass, 0 fail, 1 skipped (the existing skip). New: `connection-groups-store.test.mjs` 3/3, `group-settings.test.mjs` 3/3. Three test harnesses got the new fields and modules.
- `expo export --platform ios --platform android --no-bytecode` passes. Both bundles contain the group storage key and the switcher text.

## Not verified

- No Mac or iPhone check yet: switcher look, native menu and action sheet, Settings pages, keyboard on the Groups pages.
- The Settings > Groups page on desktop has no Chromium test. The existing Settings Chromium tests already fail on unchanged `main` on this host.
- No test with two real servers.
