# Unified Settings

Candidate branch `feat/unified-settings`, based on `main` at `b7a96a0`.

## Requirement

Jamie asked for one Settings experience across the app, not separate settings for each feature. Settings take effect in different places, so the app groups them by **where a change takes effect**, not by feature.

## Scopes

| Scope | Meaning | Settings |
| --- | --- | --- |
| On this Hermes · all your devices | Stored by the connected Hermes profile. Every paired device sees the change. | Default model |
| On this device, for one connection | Stored only in this app, separately for each connection. | Agent display name (mobile), Remove connection |
| This device, for every connection | Stored only in this app; applies to all connections. | Font size; App icon; Shortcuts (desktop, fixed) |

Status (server address, connection state, safe detail) is shown, not edited, and appears first on each connection page.

Not in Settings: Channel description, AGENTS.md, files and topic labels. They belong to one Channel or Thread and stay in place where that object is edited.

## Structure (same on both apps)

1. **Connections:** list of saved connections with state, and Add connection.
2. **One connection page:** *Status* → *On this Hermes · all your devices* (Default model) → *On this device* (Agent display name on mobile; Remove connection).
3. **This device:** Font size; App icon (see [app-icon.md](app-icon.md); mobile shows it only in builds with the native module, not in Expo Go); Shortcuts on desktop only.

Labels and order are the same on both apps. Desktop has no Agent display name because the desktop interface does not show a custom Agent name; the setting is added only when desktop uses it.

## Entry points

- Mobile: every gear (home, Channel, conversation) opens Settings home (`/settings`). A connection page is reached only from Settings home, so Back always returns there. A source test enforces this.
- Desktop: one Settings window (gear button or Cmd/Ctrl+,). Left navigation has two groups, *Connections* (All connections, then one item per connection) and *This device* (Font size, Shortcuts).

## Desktop behavior changes

- The top-level *Default agent model* page and its *Agent connection* picker are removed. The model is edited on the connection's own page, so the target is explicit.
- First open (or a remembered former model page) selects the current connection's page; without a paired connection, *All connections*. The default follows the real snapshot when the window's first snapshot is empty.
- Each connection's page is mounted on first visit and kept while Settings is open, so a model draft or warning survives page switches. A removed connection returns to *All connections*.
- Remove moved from the list row to the connection page, with the same confirmation and readback.
- Navigation ids for connections are escaped; stored ids are not used as raw selectors.

No plugin, server, protocol or Hermes core change.

## Verification (Linux)

Evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/hermes-app/channels/p_6cf55361/unified-settings/`.

- Mobile: TypeScript passes; full tests 107 (106 pass, 1 Chromium-only skip); Settings, router and multi-connection tests 30/30. New checks: scope order on Settings home and the connection page, model inside the Hermes scope, name inside the device scope, every gear targets `/settings`.
- Mobile iOS and Android Expo exports pass; both bundles contain the new scope labels and no longer contain the removed duplicate model sentence.
- Desktop: `desktop:check` with real Chromium and Linux/Xvfb Electron, 100/100 (`desktop-check-2.log`). The Chromium test covers grouped navigation, scope groups, model inside the Hermes scope, open from list, former model page migration, removed connection fallback, keyboard wrap across groups and the three window widths. The native test covers model load and save through real preload/IPC on the connection page, explicit second-connection model read, removal from the connection page and return to the overview.
- The first desktop run failed two Electron tests. One was a corrupt Electron download (`resources.pak`), fixed by reinstalling Electron. The other was a real defect: the Settings window's first snapshot was empty, so the default page was fixed too early. The default now follows the real snapshot; the rerun passes.

Not verified: iPhone layout and Mac window appearance. Screenshots were saved but not visually reviewed in this session.
