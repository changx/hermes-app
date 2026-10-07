# Desktop Connections in Settings

Initial candidate: `feat/desktop-settings`, extending the Settings candidate at `a726d0e`. Published as [Desktop v0.1.32](desktop-release-0.1.32.md). Mac installation remains unperformed.

## Confirmed product behavior

Settings → Connections is the connection manager. It lists saved Hermes servers with their live state and supports Add connection and Remove. First-run pairing remains available as onboarding.

- Add uses the existing device-pairing protocol: HTTPS origin, one-time pairing code and device name. It never replaces a saved connection. Duplicate server origins are rejected. This version supports up to eight saved connections, including pending and failed entries.
- Rows show the server address and real SDK state: Online, Connecting, Syncing, Reconnecting, Offline, Needs attention, or Pairing. Pending pairing can be cancelled. Expired or rejected pairing reports its safe error on the corresponding row.
- Remove requires explicit confirmation. It removes only that connection's saved credential, open native tabs, local drafts and outbox entries. It does not delete server conversations, revoke remote devices, or clear another connection's drafts. An active upload/message operation must finish before removal.
- For an authorization failure, Remove followed by Add intentionally clears that connection's local drafts and queued messages. Preserving them through an in-place re-pair flow is not a requirement.
- A cleanup failure retains the local identity for an explicit retry. A damaged connection index produces an error instead of silently overwriting the list.
- Sidebar shows Projects and recent Sessions from all connected servers directly. Connection attribution is secondary text under the Project name, not another tree level or a switch-first menu. Newly discovered Projects expand automatically without reopening a manually collapsed existing Project.
- Tabs remain bound to connection identity plus Thread ID. Activating another connection's tab does not destroy or reload an existing view. New chat routes by the chosen Project, even when another connection was active.
- Default agent model has an explicit Agent connection selector when several saved connections are authorized. Reads/writes use that exact connection; changing the active tab cannot redirect a pending model mutation.
- New project always displays its destination connection. Multiple saved identities require an explicit choice; a single identity is visibly preselected. Offline or removed targets cannot submit and never fall back to another account. The form retains its selection and text when tabs change. Main-process creation requires the selected identity, validates it before mutation and reads the exact created Project back from the same client before reporting success. Ambiguous failures retain the form and block duplicate submission; users must check the selected server's Project list first.

## Implementation and compatibility

`DesktopConnections` owns one `DesktopConnectionService` and SDK client per account. Main/preload IPC still validates sender authority. Only the workspace renderer can add or remove connections. Renderer snapshots contain public addresses, device identities and status, never authorization credentials.

The former `connection.secure.json` remains the primary account's encrypted credential file. Its raw Project/Thread keys and existing draft/outbox identity remain unchanged. Additional accounts use validated random local slot IDs and separate `connection-<slot>.secure.json` files. `connections.json` stores only slot IDs and credential-free HTTPS origins.

Additional UI Project/Thread IDs are qualified by local slot ID. The main process removes this qualification before sending a wire request or saving a per-account draft. Thread links retain the real server and unmodified Thread ID. Equal raw Project/Thread IDs on two servers cannot collide in tabs, lists or routing.

All accounts share one serialized local draft store and one serialized outbox store. Each account still addresses only its own identity. Credential writes/deletes are serialized within each slot. Pairing generations and abort guards prevent a late save or capability response from reopening a removed account.

Workspace draft discovery aggregates accounts without remounting the workspace when tabs switch. Per-tab draft hydration and persistence remain scoped to the owning identity. Session-label editor ownership comes from the Project's connection, not the active tab.

## Verification and limits

Evidence: Channel workspace `desktop-settings/`. The new tests use equal raw IDs on two connections and exercise the production renderer, preload, IPC, native WebContentsViews and real atomic files.

- Final full desktop check, including explicit New Project target selection, with Chromium and native Linux/Xvfb Electron enabled: **93 pass, 0 fail, 0 skipped**. TypeScript and production build pass. The unsigned macOS arm64 package builds; packaged main, preload, renderer and CSS bytes equal the final build. Evidence: `project-target-full.log` and `project-target-package.log` in the Channel workspace.
- Service tests cover account-qualified projection, per-account model and action routing, raw on-disk draft keys, stale identity rejection, exact deletion scope, cleanup retry, duplicate rejection and index read/write failure.
- Pairing tests cover removal during pending credential save and a late successful capability response after removal.
- Native Electron tests add a connection through Settings using a local HTTP pairing fixture. They check two live rows, explicit model target selection, direct combined sidebar visibility, retained DOM/drafts, peer-only background actions/New chat sends, independent status changes, confirmation/cancel, exact removal scope and fresh-manager storage restoration.
- SDK connection streams are controlled fixtures. Linux secure-storage availability failed in the initial run; the native test replaces only the safeStorage provider with test AES-GCM. Production retains Electron safeStorage with no plaintext fallback. File envelopes, isolation and restoration are exercised, but this does not verify macOS Keychain or a cross-process Keychain restart.
- Failure/retry logs are retained. No production credential, model default or server data was changed. Desktop publication is verified in [v0.1.32](desktop-release-0.1.32.md). Real multi-server pairing, macOS Keychain, Mac visual acceptance and signing remain separate gates.
