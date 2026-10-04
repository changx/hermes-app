# Session labels

## Main integration

Jamie authorized merging the verified labels candidates into both local main branches. The App integration starts from `7e54065` and preserves newer persistent-local-draft behavior, original-position red draft text, committed-page ownership and memory-release safeguards. Conflict resolution keeps the directory's stable object identities while adding label fields, combines label IPC validation with window-release checks, and binds the mobile header/editor to the account directory without changing page ownership.

Integration checks passed: shared client TypeScript/build plus 24 legacy, 20 reliability and 119 package tests; desktop TypeScript/build and 143 tests with Chromium; mobile TypeScript and 532 tests with Chromium; iOS and Android exports; 28 plugin-label tests including the actual plugin HTTP/WS and production SDK two-client probe. No tests failed or were skipped. Plugin code is unchanged from candidate `3f22f2a`. Evidence is retained privately in `workspace/hermes-app/session-labels/merge/`. This authorization does not include push, deployment, service restart, signing or native-device acceptance; the running App checkout remains untouched.

The sections below record the initial isolated candidate and its original verification, not the subsequent main-integration state.

This implements the confirmed design for parent-owned task `t_3218e8df`. It is an isolated, unpublished candidate on `feat/session-labels`: App base `b486e13df66d3e054002ab5d5c8800c24f8397a1`, Plugin base `208a07c12be562ba8e027ffc3747f3f93711fae2`. No live checkout, profile, Hermes core, credentials, signing account or deployment was changed.

## Contract and authority

Stable Thread metadata has `markers: string[]` and `markers_updated_at: number`. The timestamp is a nonnegative JavaScript safe integer in client milliseconds, sampled with `Date.now()` only when the user presses Save. The plugin accepts a proposal only when its timestamp is strictly greater than the stored value. It atomically replaces the whole array; `[]` clears it. Equal or older proposals return the current authoritative state without a write or notification. No clock correction or timestamp adjustment is performed. A clock ahead of another device can therefore prevent that device's Save from winning until its clock catches up; the draft remains available.

The first version allows ten exact, unique strings per Thread and thirty extended grapheme clusters per string, with a 1024-byte UTF-8 resource ceiling. Frontend and backend share generated Unicode 17 property tables and pass all 766 official grapheme test cases, including emoji ZWJ, modifiers, flags, keycaps and Indic clusters. Validation rejects whitespace-only strings, invalid Unicode, line/control characters, and bidi embedding/isolate controls. It preserves permitted content exactly, including spaces, case and Unicode normalization. There are no per-label identities, global label dictionary, CRDT, offline label queue, persistent local label metadata or chat cache.

Unicode data and license provenance are retained in the generated tables. Regeneration uses `scripts/build-label-graphemes.py SOURCE_DIRECTORY PLUGIN_WORKTREE`, with official [UCD 17 data](https://www.unicode.org/Public/17.0.0/ucd/) supplied separately. The script writes identical TS/Python ranges and conformance fixtures; neither runtime needs another segmentation dependency.

Authenticated endpoints are `GET /v1/threads/{id}/labels` and `PUT /v1/threads/{id}/labels`. PUT accepts only `{markers, markers_updated_at}`. Detail responses include exact `thread_id` and `project_id`. The server rejects unavailable or archived Threads and missing/archived parent Channels, including a parent becoming unavailable during input parsing. Device revocation and profile-selection denial use existing authentication. The normal JSON request bound remains 64 KiB. The plugin advertises `session_labels: true`.

Catalogue rows carry both metadata fields; an older catalogue omitting both receives compatibility defaults `[]` and `0`. A partial or malformed pair fails strict shared parsing. A committed save emits existing `directory_changed`; it emits no conversation-content hint, even for a subscribed living page. The plugin changes only its Thread label columns and existing private publication bookkeeping. Title, running, completed-unread, last-message time, history, model context and physical-session lineage are unaffected.

The shared SDK requires negotiated capability, an online connection and an available exact target. It validates PUT identity, reads the same detail endpoint back, then adopts the authoritative catalogue. It never assigns a proposed array to directory state or applies a second timestamp merge. Duplicate saves, closed connection owners, cancellation and mismatched identities fail confirmation. The account directory supplies living page headers without fetching unopened bodies or replacing page-owned messages/windows.

## Desktop and mobile behavior

Desktop extends the current Channel → Thread tree. A single line of small pills sits below the title and disappears when empty. Hidden labels become `+N` using actual rendered text and available-width measurements; long pills truncate. Pills cannot intercept the row click. Existing running and completed-unread indicators retain their behavior and styles. Right-click or keyboard context menu offers Edit labels, and the Session header has the same entry.

The top Labels popover searches unique exact labels from available Threads on the current connection. Multi-selection uses OR, with a separate No labels choice and Clear filters. Filtering occurs before display batching. An active filter includes all time, starts with 24 matches and adds 24 per Load more. Empty Channels disappear and matching branches expand. Filtering never closes the current page. Connection changes reset the filter and immediately discard any old connection's label dialog.

Mobile retains the latest-first Channel Session list and its existing composer/navigation. Its compact filter uses only that Channel's labels, with the same OR/No labels rules. Session long-press and accessibility menus add Edit labels; the Session header menu contains Edit labels and Copy session link. Pills use native layout measurements and scale their height with measured text. The editor remains separate from the timeline, composer, attachments and drafts.

Both editors use accessible modal dialogs/sheets, with local add/edit/remove/clear, existing-label reuse, exact duplicate prevention, Save and Cancel. Label draft edits are online only. A failed or unconfirmed save, including authoritative state differing from the draft, preserves the draft and gives a short English message. Busy guards prevent duplicate submissions. No label proposal enters the message outbox or persistent storage.

## Verification and artifacts

All data below is from synthetic fixtures. The production plugin adapter actually binds an isolated HTTP server; two newly paired devices subscribe with directory-only WebSockets. Independently, two production App SDK clients use its actual authenticated HTTP/WS transport. Whole replacement, clear, stale/equal proposals, notification/readback, unavailable targets, strict validation and credential revocation are exercised. The SDK probe records 25 requests, no body reads and no opened pages. Store tests reopen SQLite, cover legacy migration/concurrent replacement and compare unrelated directory/history metadata before and after saves.

Hermes baseline is pinned by `scripts/client-check.sh` and Plugin `scripts/pack-plugin.sh` to `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`, read only at `/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`. Existing installed dependencies were copied into the isolated App worktree; dependency graphs were checked before copying, and lockfiles were not changed. Mobile dependencies are local copies so Metro does not follow outside-workspace dependency symlinks.

The final command/result and artifact manifest is retained privately under `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-labels/verification.json`, with raw `logs/`, synthetic `plugin-evidence/`, packaging `probes/` and `artifacts/` alongside it. Required gates:

| Gate | Command | Result |
| --- | --- | --- |
| Pinned Plugin P1, all SDK opt-ins enabled | `uv run --no-project --offline --python "$baseline/.venv/bin/python" python -m pytest -q tests/p1` | 366 passed, zero skipped; 57 existing library warnings |
| Shared client regression script | `npm run client:check -- "$baseline"` | Passed TypeScript/build, legacy and reliability checks |
| Shared package individual cases | `node --test --test-isolation=none packages/client/tests/*.test.mjs` | 117 passed, zero skipped |
| Desktop normal gate, Chromium enabled | `HERMES_TEST_CHROME=/opt/google/chrome/chrome npm run desktop:check` | 133 passed, zero skipped; TypeScript/build passed |
| Mobile TypeScript/full tests, Chromium enabled | `npm run check --prefix apps/mobile`; `HERMES_TEST_CHROME=/opt/google/chrome/chrome npm test --prefix apps/mobile` | 524 passed, zero skipped; TypeScript passed |
| Mobile exports | `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npm run export:ios --prefix apps/mobile`; same with `export:android` | Both exports passed; local outputs in `apps/mobile/dist/ios` and `apps/mobile/dist/android` |
| Formatting/review | `git diff --check` in both worktrees | Clean; changes reviewed for identity, capability, input, event and page/composer boundaries |

P1 environment: `HERMES_BASELINE="$baseline"`, `HERMES_APP_SDK_ROOT="$app"`, `OPEN_SESSION_SDK_PROBE="$app/tests/client/open-session-plugin.mjs"`, `SESSION_LABELS_SDK_PROBE="$app/tests/client/session-labels-plugin.mjs"`, and private `P1_EVIDENCE_DIR`/`P105_EVIDENCE_DIR`. `PYTHONDONTWRITEBYTECODE=1` and task-local `UV_CACHE_DIR` avoid modifying the baseline. Probes use the provided `TMPDIR`. Socket/Chromium checks require normal sandbox approval; rejected actions must not be bypassed.

Desktop interaction tests execute production React components in Chromium, including measured chip widths at 180/260/420px, filter/batch/tree behavior, modal add/edit/remove/reuse/clear, failed/stale saves, duplicate submissions, Session-header entry, immediate connection isolation and preserved composer/page/scroll position. Mobile tests execute the production components with native-layout fixtures; they do not substitute for real-device layout or keyboard verification.

An unsigned macOS arm64 `.app` is packaged using existing Electron 44.4.5. The normal `npm run desktop:package:mac` encountered a network DNS failure while fetching checksum metadata. The private `probes/package-candidate.mjs` uses the same packaging options and the exact cached Electron ZIP instead; no dependencies were installed or lockfiles modified. This Linux packaging path cannot embed the macOS ASAR integrity digest requiring `codesign`. The resulting unsigned ZIP, integrity/identity/hash checks and plugin-only archive are recorded in the private artifact manifest. Source/app versions remain 0.1.18 and plugin version 0.2.1; these are local candidates, not release tags.

Pending gates: iPhone/Android/macOS device interaction and scrolling/keyboard/font accessibility; independent mobile installation packages; macOS signing/notarization and mobile signing; authorized plugin/client deployment and public-entry verification. Exports and unsigned packaging do not complete those gates. No merge, push, install, restart, signing or publication was performed.
