# Project AGENTS.md refused by the server

## Problem

On team01, opening Project settings for the Subotiz project (`sites` profile, `p_d5e78576`) switched the whole connection to "Needs attention".

- The project's primary folder `/opt/projects/subotiz` has mode `2775` (group-writable). `AGENTS.md` exists in it.
- The plugin reads repository AGENTS.md only from folders that are not group- or world-writable. It answers `GET /v1/channels/<id>/agents` with `403 Unsafe guidelines source`.
- The desktop treated every 401/403 as revoked device credentials (`stopIfUnauthorized`). It closed the connection and showed the `blocked` state, labeled "Needs attention".

A missing AGENTS.md is not the cause: the server answers 404 for that, and both clients show an empty editor.

## Behavior (desktop v0.1.142)

- Reading or saving Project AGENTS.md and setting the primary folder stop the connection only on 401. A 403 there is about the resource, not this device.
- When the server refuses AGENTS.md (403), Project settings keep the AGENTS.md tab, show why, and keep its editor read-only. Title, Context and the primary folder still save.
- Other routes keep the old rule (401 and 403 stop the connection).
- Mobile already treated this case as a screen error ("Could not open the channel guidelines") and never blocked the connection; it is unchanged.

The server rule is unchanged. To use the AGENTS.md of a group-writable folder, remove group write on the folder (`chmod g-w`) or change the plugin rule; both need Jamie's decision.

## Tests

- `apps/desktop/tests/project-agents-refused.test.mjs`: 403 keeps the connection online and returns `refused`; 404 is a missing file; 401 still blocks.
- `apps/desktop/tests/project-dialog.test.mjs`: a refused AGENTS.md shows the reason, the editor is read-only, and Context still saves.

## Release record

- 2026-11-17, desktop **v0.1.142** (fix `e4333ce`, release commit `6cacc69`, tag `v0.1.142`). Built on the Mac mini with the detached path: the first direct run of `scripts/macmini-desktop-release.sh` lost SSH during packaging (exit 255) after its Mac mini tests passed (fail 0). The detached build ran the same REMOTE block on the same tag; then `--publish-built`. Signing log: `valid on disk`, `Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`, DMG and app `source=Notarized Developer ID`, staple and validate passed. All 10 `App code SHA-256` lines match a local `npm run build` of `6cacc69`; `dist/renderer/index.js` contains the new refused-AGENTS.md text and `dist/main/index.cjs` the resource-scope rule. Release has the DMG + `.sha256` (checksum OK after download); the update feed answers 200 and now offers 0.1.142.
- Linux gate (worktree from `origin/main` + this fix, Chrome/Electron enabled): 323 tests, 314 pass, 9 fail. The same 8 Chromium tests fail on a clean `origin/main` worktree too (Chrome 149 on this host); `page-menu-native` passed when rerun alone (known flake). New tests: 17/17 pass.
- Open: Mac visual check of the Project settings dialog on team01 Subotiz.
- 2026-11-17, team01: Jamie chose option A. `chmod g-w /opt/projects/subotiz` (2775 -> 2755, same as the other member folders; group `hermes` has no other members). `GET /v1/channels/p_d5e78576/agents` on the `sites` gateway now answers 200. The plugin rule is unchanged.
