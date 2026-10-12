# Mobile bottom tabs, Recents and Automations

Status: released in client v0.1.65 with plugin 0.2.22 (2026-10-11). Thread origin and Automations need the plugin 0.2.22 to run in the Gateway. Not yet accepted on a real iPhone.

## Confirmed requirements (Jamie, 2026-10-11)

- The phone gets bottom tab navigation. Left to right: Recents, Channels, Automations.
- The tab bar has no unread badges.
- Use the Expo Router native tabs (`NativeTabs`).
- The server marks where a Thread came from. A Thread enters Recents only after the user took part in it. Recents is a plain Thread list: no grouping, no summary rows.
- Recents has a new-conversation icon button. Its page asks for the first message and a channel. The channel of the most recent use is preselected and can be changed. Creating a session from a channel page stays as it is.
- Each channel row in the channel list shows its connection.
- Attachments stay on the device until the user sends; the Thread is created and the files are uploaded only at send.
- The Automations list shows jobs; a job opens the Threads that it produced.

## Behavior

### Recents rule (shared with the desktop sidebar)

`packages/client/src/recents.ts`:

- A Thread is in Recents when the user owns it AND it had activity in the last 24 hours or is running.
- The user owns a Thread when its `origin` is not `automation`, or when `participated` is true (the user sent at least one message in it).
- A server older than plugin 0.2.22 sends no origin. Then every Thread counts as the user's, which was the previous behavior.
- The desktop sidebar Recents (`apps/desktop/src/renderer/thread-navigation.ts`) and the mobile Recents tab (`apps/mobile/src/recentRows.ts`) use this rule.

### Tabs

- `apps/mobile/src/app/(tabs)/_layout.tsx` defines the tab bar. It also sends a device without connections to the welcome page.
- Each tab draws its own header (`TabHeader`): title, tab actions, and the Settings gear.
- Threads, channel pages, settings, the new-conversation page and the automation page are pushed on the root Stack above the tabs. The tab bar is hidden there. Back returns to the same tab and scroll position.
- Tab lists scroll under the native tab bar. The safe-area inset covers only the home indicator, so Recents, Channels and Automations end with `tabListBottomPadding` (`apps/mobile/src/tabInsets.ts`: 96 pt plus the bottom inset). The last row stays visible above the tab bar.
- Route ownership: an emptied root stack falls back to `(tabs)`. Automation pages belong to their connection and close when that connection is removed.

### Recents tab

- Rows from every saved connection, running first, then newest activity (see [todo-flag.md](todo-flag.md); a Todo section is above the list). Each row shows the Thread title, its channel and, with more than one connection, the connection name, then time, Running and the unread dot.
- The list refreshes with the directory and once per minute, so the 24-hour window moves.

### New conversation (from Recents)

- Route `/new-thread`. A Channel field at the top opens a list of every channel with its connection name.
- Preselection: the channel of the user's most recent own activity (any time, not only 24 hours). Automation Threads without a user reply do not count. Without such activity, the first channel in the list.
- The composer is the same `NewTopicComposer` as at the bottom of a channel page, with the same durable first-message path (`MobileOutbox`).
- Before the first send attempt, the text and the selected files are local only. The user can change the channel or the connection and keep both. From the first send attempt until the durable commit, the attempt's Thread and message IDs belong to the selected channel, so the Channel field is locked. This keeps the composer rule: never share files or IDs across channels.
- The page opens the keyboard after the push animation ends (`transitionEnd`), not at mount. The first keyboard of the app process is slow to appear; at mount it ran during the push and the push stuttered.
- After the send, the page is replaced by the new conversation. Back returns to Recents.

### Channels tab

- The previous home list. Every row now shows its connection name, also with one saved connection.

### Automations tab

- Jobs of every connection that has plugin 0.2.22: name, status (Running, Scheduled, Paused, Finished, Last run failed), schedule, next or last run, and the number of unread results. A connection without the capability shows one line that Automations are not available there yet.
- A job opens `/automations/[automationId]`: status, schedule, where it delivers (tap to open the channel), the instructions (hidden until tapped), and the conversations it produced, newest first, with paging.
- Read-only in this version. Creating or changing an automation stays in a conversation with the agent.

## Server contract

See `docs/cron-threads.md` in the plugin repository (`/opt/projects/jamie/hermes-app-plugin`): `origin` and `participated` in the catalogue, `GET /v1/automations`, `GET /v1/automations/{id}`, and the capabilities `thread_origin` and `automations`.

## Verification

- Shared client: `npm run client:check` (includes `packages/client/tests/automations.test.mjs`).
- Desktop: `npm run desktop:typecheck`; `apps/desktop/tests/sidebar-recents.test.mjs` covers automation Threads in Recents.
- Mobile: `npm run check` and `npm test` in `apps/mobile` (`tests/recents-tab.test.mjs`, `tests/tab-list-insets.test.mjs`, route ownership in `tests/multi-connection.test.mjs`); `npx expo export --platform ios` builds.
- Open: real iPhone check of the native tab bar (Expo Go), list bottom insets above the tab bar, the channel picker sheet, and the keyboard on the new-conversation page.

## Release record

- 2026-10-11, client `v0.1.65` (`7165fa2`), plugin `v0.2.22` (`8234b69`).
- Plugin: installed through the shared `plugin-releases/hermes-app/current` link for `hermes-app-dev` and `jamie`. Online backups of both `metadata.sqlite` files are in the private evidence folder (`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/20261011-202212-automation-origin/`). The migration was run on copies of both databases first: only `threads.origin` and the `delivery_jobs` table change; `integrity_check` ok; 0.2.21 still reads and writes a migrated copy, so a code rollback needs no data restore. Active after the next `hermes-gateway.service` restart.
- Plugin P1 suite (baseline venv): every failure also fails on `main` in the same session; no new failures.
- Mobile: Expo service restarted on `7165fa2`; public iOS and Android manifests 200 (SDK 57), both bundles contain the Recents, Automations and native-tabs code.
- Desktop: built on the Mac mini (126 pass, 0 fail, audit 0), 29 packaged `dist/` files identical to the local build (source maps are excluded by design), published as GitHub Release `v0.1.65`; the downloaded zip equals the checked zip.

## Search and quick label filter (candidate)

Requested by Jamie: the Recents tab gets the same search and quick label filter as the desktop sidebar.

- **Search box** under the Recents header ("Search"). The keyword uses the desktop matching (`sessionQueryScore`): title, label text, transliteration, then channel name. While a keyword or a label is active, the list shows matching conversations from every listed, non-archived Thread of every connection (not only the last 24 hours, automation Threads included). Best match first; ties go running first, then newest activity. The clear button empties the box and the labels and restores Recents. Dragging the list dismisses the keyboard; taps on results work while the keyboard is up.
- **Quick label filter** under the search box: the 5 labels on the most listed Threads (same rule as the desktop frequent labels, `frequentSessionLabels`; only connections that support labels). A tap adds the label to the search, a second tap removes it; several labels are AND. A selected label stays in the row (shown as selected) even when it is no longer among the five.
- **Cards** show their labels (`LabelPills`) when the connection supports labels. (Later replaced: cards show only the todo flag; see [todo-flag.md](todo-flag.md).)

Verification: `apps/mobile/tests/recents-search.test.mjs` covers the rules (search beyond 24 hours, AND labels, keyword on title and label text, archived excluded, automation searchable, label support per connection, quick-label ranking) and the production Recents tab with stand-in views (quick label tap, pressed state, AND, second tap, keyword, no-match text, Clear, card labels). The screen check fails on the old screen. Mobile suite 153 passed; TypeScript passed; iOS and Android exports contain the new strings. iPhone acceptance is pending.
- 2026-10-11, mobile client `afd6b5e` (Expo entry): tab-list bottom clearance above the tab bar and new-conversation keyboard after the push. Public iOS/Android manifests and launchAssets returned 200 with SDK 57 and the new code; only Expo restarted. iPhone check open.
- 2026-10-11, mobile client `99b1388` (Expo entry): new-conversation start retries temporary network/timeout/429/5xx failures (4 attempts, idempotent client thread ID) before it shows an error; salvaged from `fix/new-topic-retry`. Also added the confirmed push design document (not implemented). Public iOS/Android manifests and bundles returned 200 with SDK 57 and the new code; only Expo restarted. iPhone check open.
- 2026-10-11, desktop v0.1.67 (`89a1f82`): version-only Release, no desktop or shared-client change since v0.1.66; it marks `main` after the new-topic retry and push design doc. Mac mini workflow run 38210548252: 161 tests, 127 pass, 0 fail, 34 skipped, audit 0; zip uploaded direct at 89.6 Mbps. Downloaded zip passes sha256, Info.plist 0.1.67. Two newest Releases kept.
