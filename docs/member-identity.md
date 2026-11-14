# Team member identity

The Hermes App plugin decides who sends each message (plugin `docs/sender-identity.md`, 0.2.65 and later). A paired device speaks as the member that an administrator bound it to. Personal and project profiles use the same rule. The client never sends or sets a name.

## Sender labels (desktop 0.1.137, iOS update 8ab54059)

- A user message with `sender` shows a small sender label above the bubble. The leading `[member] ` marker is removed from the displayed, copied and edited text.
- A 403 `device_not_bound` send keeps the draft and shows: "This device is not linked to a team member. You can read but not send."

## Current identity (read-only)

Connection settings show who this connection speaks as. Desktop: the General tab, Status group. Mobile: the connection page, Status section.

| `GET /v1/me` | Shown |
|---|---|
| `auth: device`, `member` set | "Speaking as" + member name |
| `auth: device`, `member: null` | "Not linked to a team member" (warning colour), with "You can read but not send. Ask an administrator to link this device." |
| `auth: admin` | "Administrator token": messages are not attributed to a team member |

- The row appears only when the server has the capability `member_identity` and the connection is online. A failed read hides the row; the connection is unaffected.
- There is no edit control. An administrator changes a binding on the server (team01: `~hermes/.hermes/team/device-bind.sh <profile> bind <device_id> <member>`). New devices are paired for a member: `pair-code.sh <profile> <member>`.
- Code: `packages/client/src/memberIdentity.ts` (parse and text), `HermesClient.memberIdentity()`, desktop `ConnectionIdentity` in `apps/desktop/src/renderer/connection-settings.tsx` (IPC `desktop:get-member-identity`), mobile `ConnectionIdentity` in `apps/mobile/src/SettingsScreens.tsx`.
- Tests: `packages/client/tests/member-identity.test.mjs`, `apps/desktop/tests/member-identity.test.mjs`, `apps/mobile/tests/settings-levels.test.mjs`.
