# Desktop Automations

Status: candidate on branch `feat/desktop-automations`. Not merged or released. macOS acceptance on Jamie's Mac is open.

## Confirmed requirements (Jamie, 2026-10-11)

- The desktop sidebar gets an Automations section above Recents.
- It lists the automation jobs, like the mobile Automations tab.
- A click on a job opens its detail page with the job's conversation list.
- A click on a conversation opens that conversation's session page.

## Behavior

### Sidebar section

- Order from top: New chat, search box, frequent labels, **Automations**, Recents, Projects. While a search is active, the search results replace all three sections (unchanged rule).
- The section lists the jobs of every connected server that has the `automations` capability (plugin 0.2.22 or later). Order: running first, then latest run, then name (same as mobile).
- Each row uses the Recents row layout: job name; the connection name when several connections exist; a status only when it needs attention (`Running`, `Paused`, `Last run failed`); the unread result count as the blue badge. The tooltip has the full status, schedule and next or last run.
- When no connection offers Automations, the section is not shown. A server that could not be read shows one short line; the other servers' jobs stay.
- The header collapses the list, like Recents. The choice is saved on this device (`hermes.sidebar.automations-collapsed`).
- The list reloads when a connection comes online or goes away, 1.5 s after a directory change (new results, reads), every 60 s, and when the window gets focus.
- Automation Threads stay out of Recents until the user replies in them (existing rule in `packages/client/src/recents.ts`).

### Automation tab

- A job opens in a tab of a third kind, `automation`, next to Session and New chat tabs. One tab per job: a second click activates the open tab. The tab title is the job name. No Session is selected while it is in front.
- The page shows the name, status, schedule with next or last run, where results go (project names), the instructions (hidden until **Show instructions**), and **Conversations**: newest first, with the project, the number of results, Running and the unread dot. **Show more** loads the next page.
- The unread dot and Running come from the live directory, so reading a conversation clears its dot at once. The page also reloads when the tab comes to the front and after directory changes.
- A click on a conversation opens its Session tab (the same path as a sidebar row). A conversation that is no longer in the directory (for example archived) is shown as "No longer available" and cannot be opened.
- A job that the server no longer has shows "This automation no longer exists." Removing the connection closes the tab.
- Read-only, like mobile. Creating or changing an automation stays in a conversation with the agent.

## Implementation

- No plugin or server change. The desktop uses the existing endpoints `GET /v1/automations` and `GET /v1/automations/{id}` through the shared client (`packages/client/src/automations.ts`).
- Status and schedule text moved from `apps/mobile/src/automationText.ts` to `packages/client/src/automationText.ts`. The mobile file re-exports it; mobile behavior is unchanged.
- Main process: `DesktopConnectionService.automations()/automation()` per server; `DesktopConnections.automations()/automation()` merge servers and qualify job, project and Thread IDs like other desktop IDs. A 404 becomes `missing`.
- IPC: `desktop:list-automations` and `desktop:open-automation` accept only the main window. `desktop:get-automation` accepts only an Automation tab and reads that tab's own job; the renderer cannot name another job. Session actions (`send`, `stop`, attachments and others) have no target in an Automation tab.
- Renderer: `renderer/automations.tsx` (`AutomationsSection`, `AutomationPage`); `navigation-panel.tsx` places the section; `shell.tsx` routes `tabKind === 'automation'`.

## Verification

- `tests/native-tabs.test.mjs`: one tab per job, no selected Session, own-job target only, no Session target, title update, conversation opens a Session tab, closed with its connection.
- `tests/connections.test.mjs`: merge of two servers with qualified IDs and order, one failed server, unsupported servers not asked, page qualification, 404 to `missing`, 503 rejected.
- `tests/automations-ui.test.mjs` (Chromium, production components): section order and position, rows, statuses, badge, connection name, row height and indent equal to Recents, automation runs not in Recents, open call, selected row, collapse saved, refresh after a directory change, hidden without support; Automation page content, instructions toggle, live unread dot, unavailable row disabled, conversation click, Show more paging, reload on return, removed job.
