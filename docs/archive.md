# Channel and Thread archive

Status: implemented on branch `feat/archive` (client and plugin). Not merged or released. Device acceptance is pending.

## Confirmed requirement

2026-10-10, Jamie: the App needs Channel archive and Thread archive. Use the Hermes core archive. Archived Channels and Threads become invisible.

## Behavior

| Item | Server (plugin) | Desktop | Mobile |
|---|---|---|---|
| Thread archive | `DELETE /v1/threads/{id}` sets the plugin `archived` flag (unchanged) and also calls core `SessionDB.set_session_archived` for every core session linked to the Thread. `PATCH {archived:false}` restores both. | Session toolbar **Archive** (unchanged). | Session options **Archive session**; session long-press **Archive session**. Both ask for confirmation. After the archive, Session options returns to the Channel. |
| Channel archive | `PATCH /v1/channels/{id}` with exactly `{archived: true\|false}` calls core `projects_db.archive_project` / `restore_project`. Capability `channel_archive`. | Project settings **Archive project** when the server reports `channel_archive`. Older servers keep **Delete project**. | Channel options **Archive channel** when the server reports `channel_archive`. Confirmation, then the page goes back. |
| Visibility | `/v1/catalogue` and `GET /v1/channels` list only non-archived Channels, so the Threads of an archived Channel are also left out. Live watch, live state and result read treat a Thread in an archived Channel as unavailable. New Threads in an archived Channel get 409. | Archived Threads and Channels leave the tree after the directory refresh. | Same. |

Nothing is deleted: history, attachments, workspace files and core sessions stay. There is no archived list or restore UI yet; restore exists only in the API (`archived:false`). Core CLI `hermes projects restore` also restores a Channel.

## Design notes

- The plugin `archived` flag stays the App's Thread visibility authority. Core's idle sweep also archives sessions (`auto_archived`), so the App must not hide Threads by the core flag.
- The core session mirror is best effort: a failure is logged and the App archive still applies.
- Channel archive does not cascade to its Threads. They are hidden through their parent. Restoring the Channel shows them again.
- Archive does not stop running work.

## Verification

See the plugin repo `docs/archive.md` for server tests. Client tests: `packages/client/tests/channel-archive.test.mjs`, `apps/desktop/tests/project-dialog.test.mjs`, `apps/mobile/tests/channel-archive.test.mjs`, `apps/mobile/tests/session-options.test.mjs`.
