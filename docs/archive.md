# Channel and Thread archive

Status: released 2026-10-10 — client v0.1.63 / Expo, plugin 0.2.17 (installed; active after the Gateway restart). Device acceptance is pending.

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

## Release (2026-10-10)

- Client: feature `ae97c04`, release `c18246b`, tag `v0.1.63` on origin/main. Rebased after v0.1.62; shared client 46/46, mobile 146 pass/0 fail, desktop 157/157, TypeScript and iOS/Android exports pass.
- Mobile Expo Go: runtime checkout `cbd991c` → `c18246b`, only `hermes-app-expo.service` restarted (PID 599026 → 636237). Public iOS/Android manifests 200, SDK 57.0.0, exact launch assets 200 with `Archive session` and `Archive channel`. Mobile lockfile unchanged.
- Desktop: Mac mini build 124 pass/0 fail/33 skipped, audit 0. [Release v0.1.63](https://github.com/changx/hermes-app/releases/tag/v0.1.63): sha256 sidecar OK, identical to the build, ZIP intact, Info.plist 0.1.63, arm64, ASAR has `desktop:archive-channel` and `Archive project`. Unsigned, not notarized.
- Plugin: `hermes-app-plugin` `886e6c3` + `08e5ec1`, local tag `v0.2.17`; artifact sha256 `c8f397d9…4fd56`; shared `current` 0.2.16 → 0.2.17 for `hermes-app-dev` and `jamie`. Running code changes only after `systemctl --user restart hermes-gateway.service` (all profiles).
- Older servers: the client hides Channel archive without `channel_archive`; Thread archive uses the existing endpoint.
- Evidence: Channel workspace `archive/`; plugin artifact and before-state in `jamie/workspace/hermes-app/archive/plugin-0.2.17/`.
- Rollback: client `git revert ae97c04` + Expo restart, next desktop patch; plugin `current` back to `releases/0.2.16` + Gateway restart. No data restore needed (no schema change).

## Fix: no Delete project flash (v0.1.64)

The Project settings dialog showed Delete project until `getChannelInfo` returned, then switched to Archive project. The desktop connection snapshot now carries `supportsChannelArchive`, so Archive project shows from the first frame. When the capability is still unknown, the dialog shows no removal button until the server answers. Mobile reads the capability when the menu opens and was not affected.
