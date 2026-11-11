# Persona & memory (SOUL.md, USER.md, MEMORY.md)

Status: released 2026-11-10. Plugin v0.2.62 (`hermes-app-plugin` `858fea3`), App v0.1.134 (`f757452`). The plugin loads at the next Gateway restart; see [Release record](#release-record).

## Requirement

Jamie (2026-11-10): for each connection, the client can show and edit `SOUL.md`, `USER.md` and `MEMORY.md`. Release directly after the change. Follow-up: the desktop connection page becomes tabs, because the page had too much content and these files need large text editors.

## How Hermes core uses the files (checked against `~/.hermes/hermes-agent` at `local/main` 272c0ccea4)

- `SOUL.md` is `<profile>/SOUL.md`, identity slot #1 of the system prompt (`agent/prompt_builder.py`). Core seeds a default file when it loads the config of a profile that has none. The core dashboard writes it with `utils.atomic_write_text(path, content, preserve_mode=True, create_mode=0o644)` (`PUT /api/profiles/{name}/soul`).
- `USER.md` and `MEMORY.md` are the built-in memory store in `<profile>/memories/` (`tools/memory_tool_store.MemoryStore`). Entries are separated by `ENTRY_DELIMITER` (`"\n§\n"`). Every write holds the file lock `MemoryStore._file_lock` (a separate `.lock` file) and uses the atomic writer `MemoryStore._write_file`. The memory tool refuses entries that match the strict threat scan (`_scan_memory_content`) and additions over the character limit (`memory.memory_char_limit`, default 2200; `memory.user_char_limit`, default 1375). `memory.memory_enabled` and `memory.user_profile_enabled` turn a file off.
- Core reads all three files when a session builds its system prompt and keeps that snapshot for the session. A change applies to new conversations. A running conversation keeps the text it started with.

## Design

Server: `plugins/hermes_app/profile_files.py` in `hermes-app-plugin`. No core change.

| Route | Result |
| --- | --- |
| `GET /v1/profile-files` | `{files: [{kind, name, content, version, exists, limit?, used?, enabled?}]}` for `soul`, `user`, `memory`, in this order |
| `PUT /v1/profile-files/{kind}` with `{content, version}` | `{file}`. Errors are JSON `{error, message}` |

- The routes act on the adapter's own profile, in the profile runtime scope that `env_keys` uses (`gateway.run._profile_runtime_scope` under multiplexing). A body that names a profile gets 403.
- `version` is the SHA-256 of the file bytes, or empty when the file does not exist. A save must send the version that the user edited. When the agent or another device changed the file, the save gets 409 `version_conflict` and nothing is written. For memory files the version check runs inside the core memory file lock, so a save never overwrites an entry that the agent saved meanwhile.
- `SOUL.md` is saved as the dashboard saves it. `USER.md` and `MEMORY.md` are parsed into entries (a line that holds only `§` separates entries; entries are trimmed; empty and repeated entries are dropped), checked with the core threat scan (400 `blocked_text`) and the profile's character limit (400 `over_limit`), and written with the core memory writer. A file that is already over its limit may get shorter, but not longer.
- A symlinked file is not replaced (400 `managed_file`). Text is at most 100,000 characters (400 `invalid_text`); the request body is at most 1 MiB.

## Clients

- Shared client: `supportsProfileFiles`, `profileFiles()`, `saveProfileFile(kind, content, version)`, and `memoryEntries`, `memoryUsed`, `profileFileSaveError` in `packages/client/src/profileFiles.ts` (the same entry rules as the server, for the live character count and plain error texts).
- Desktop: connection page tab **Persona & memory**. One sub-tab per file, with the editor always open. The status line shows the size against the limit and *Turned off on this Hermes* when the profile config turns a file off. A dot marks a sub-tab with unsaved changes. Save (also Cmd+S), Discard changes, and Load latest version after a conflict. The main process checks the kind, text and version (`src/main/profile-files-ipc.ts`).
- Mobile: connection page row **Persona & memory** (`settings/profile-files`) lists the three files; each opens its editor page (`settings/profile-file?file=…`). The text field fills the page and scrolls by itself, so the caret stays above the keyboard. Save is in the header. After a conflict the draft stays on screen until the user taps Load latest version. Removing the connection closes both pages (`routeOwnership.ts`).

## Limits

- A conflict does not merge. The user loads the latest version and makes the change again.
- The client does not run the threat scan; it shows the server's refusal.
- `HERMES_APP` profiles on other hosts (team01) need the plugin release before the clients show the feature. Clients hide it when the capability is absent.

## Verification

- Plugin: `tests/p1/test_profile_files.py` with core at `local/main`: list with versions and config limits, core-seeded SOUL.md, entry normalization read back by core `load_on_disk_store`, stale version after a real core memory add (409, file unchanged), limit, threat scan and input refusals, shrink of an over-limit file, symlink, multiplex scope that writes only the adapter's profile, capability.
- Shared client: `packages/client/tests/profile-files.test.mjs`. Desktop: `tests/profile-files-ipc.test.mjs`, the Chromium Settings test (`tests/settings-layout.test.mjs`: connection tabs, file sub-tabs, live count, over-limit block, draft kept across tabs, versioned save), and the Electron Settings tests. Mobile: `tests/profile-files-settings.test.mjs` and the route test in `tests/multi-connection.test.mjs`.

## Release record

- Candidate checks: plugin `tests/p1/test_profile_files.py` 10/10 (with `test_env_keys`, `test_workspace`, `test_model_settings`: 46/46). The full plugin suite has the same 39 failures on unchanged `main` (core `tui_gateway/server.py` `NameError: _flush_sessions_before_exit` at exit, and tests after that crash); this branch adds no other failure. Shared client 134/134. Desktop with Chrome and Electron: 299 tests, 296 pass; the 3 failures are timing checks outside Settings (`native view tracks drag 380`, `Cmd+G wraps`) that pass when run alone. Mobile `tsc` OK, `npm test` 262 pass, 0 fail; iOS and Android `expo export` OK.
- Plugin v0.2.62: `main` and tag `v0.2.62` (`858fea3`) pushed. Installed from `git archive v0.2.62` (plus the release `README.txt`) to `releases/0.2.62` on this host and team01; tree hash `479bc683…` on both. `current` points to 0.2.62 on both hosts. Neither Gateway was restarted: this host's `hermes-gateway.service` is PID 3136091 (started 2026-11-10 04:52:42 PST) and still runs 0.2.61. Clients hide Persona & memory until the capability appears.
- Mobile: `hermes-app-expo.service` restarted (PID 3111269 → 3914592, 22:54:48 PST). Public iOS and Android manifests: HTTP 200, SDK 58.0.0; both launch bundles (HTTP 200) contain the Persona & memory page and `/v1/profile-files`.
- iOS TestFlight app: update `6994d1e0` (commit `f757452`, runtime `b32a4b59…`) published and signed; the public manifest serves it (HTTP 200), bundle HTTP 200, 13.8 MB.
- Desktop v0.1.134: built on the Mac mini (second attempt; the first lost the connection to Apple after notarization). Developer ID signed, notarized (`Accepted`), stapled; `spctl` accepted for the DMG and the app. DMG SHA-256 `12b6313b92d154840eac15509b8e50257f010494143568365fa55c0360c4704c`. GitHub Release `v0.1.134`. Update feed: 0.1.133 gets 0.1.134 (update zip SHA-256 `ccd9d737…`); 0.1.134 gets 204.
- Rollback: plugin `current` back to `releases/0.2.61` and a Gateway restart; mobile `git revert` and Expo restart, iOS `publish.mjs rollback`; desktop: publish a higher version.
- Open: Gateway restart on this host and team01; real device check on iPhone and Mac.
