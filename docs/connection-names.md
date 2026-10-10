# Connection names and Recents attribution

Branch `feat/connection-names` in `/opt/projects/jamie/_worktrees/hermes-app/connection-names`, based on main `ecb66de`. Not merged, not published.

## Requirement (Jamie, 2026-10-09)

- Each connection has a name. The default name is the server's host name. The user can change it.
- The desktop sidebar Recents list shows which connection each Session belongs to.

## Behavior

- The name is a device preference. It is not sent to the server and does not change on other devices. This matches the Agent display name.
- Settings → a connection → **On this device** → **Connection name**. The field shows the host name as a placeholder. A blank name restores the host name. The limit is 40 characters. Control and bidirectional override characters are rejected.
- The name appears wherever the connection name already appeared: Settings rows, Project secondary text, New chat Project list, Project options, mobile header subtitle and mobile home list.
- Desktop Recents: when more than one connection is saved, each row shows the connection name in small muted text to the right of the title, on the same line. The row keeps its one-line height; a long title is shortened first. The row tooltip shows `Project · Connection`. With one connection the name is not shown, the same rule as the Project tree.
- Mobile has no Recents list. Mobile gets the editable name only.
- Removing a connection deletes its name. A later pairing in the same slot starts with the host name again.

## Implementation

- Shared rule: `packages/client/src/connectionName.ts` (`normalizeConnectionName`, `serverHostName`).
- Desktop: `connection-names.json` in the app data folder stores `{ version: 1, names: { <slot>: <name> } }`, with no credentials. `DesktopConnections` applies the name in its projection. `DesktopConnection` rows carry `defaultName` and `customName`. A damaged file falls back to host names and blocks renaming, so it is never overwritten. The Settings window may call the new `desktop:rename-connection` channel.
- Mobile: SecureStore key `hermes-app-connection-name` (primary) or `hermes-app-connection-name.<slot>`. `loadSlots` reads it; an invalid stored value is ignored. `removeSlot` deletes it. `renameConnection` in `connections.tsx` saves, reads back, then updates the runtime name.

No plugin, Hermes core or protocol change.

## Verification

See the commit message and the Channel workspace `connection-names/` folder for logs. Mac and iPhone visual checks are not done.
