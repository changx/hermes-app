# Consistent file-tool compact captions

**Publication update:** merged in code release `6ce95ed`, with mobile resources deployed and read back; see [combined release](client-layout-tools-blur-release.md). Desktop source is merged, but no new desktop install package was published. The candidate boundary below is historical; native acceptance remains pending.

Card `t_bdaf101d`; candidate based on main `7fefae5`, independent of pending new-topic/new-channel layout branch. Jamie's screenshot shows `Editing path=/opt/...` alongside `Editing /opt/...` while Reading already displays basenames.

## Confirmed cause

Read-only inspection of the installed development plugin's `tool_timeline.py::_discord_caption` confirms direct path arguments are fed to the core preview formatter, while V4A multi-file patch uses its existing safe `path=... · path=...` detail as a synthetic path. Both clients prefer the resulting `caption`, bypassing their compact file-detail formatter. That formatter previously shortened only Reading to a basename; Writing and Editing merely capped the original detail, also retaining `path=`.

## Client-only correction

- Shared `compactFileDetail` now handles write/edit safe summaries as file paths: remove the known `path=` prefix, extract Windows/POSIX basenames, join multiple filenames, preserve omission markers and apply a Unicode-safe 40-character preview budget.
- Path text truncated upstream becomes `Path truncated`; do not guess a missing filename from an incomplete directory path.
- No raw arguments or V4A patch bodies are read. Ignore unrelated key/value fields and JSON-shaped summaries rather than displaying them as filenames. This is presentation normalization of already-safe server detail, not a replacement for server redaction.
- Shared `compactToolCaption` prefers those safe file details over preformatted server captions for compact file rows. Read line-range context remains supported. Non-file captions, terminal blocks, icons, call IDs and order stay unchanged.
- Mobile and desktop use that same helper. Mobile expanded reader retains full safe detail and its existing arrow entry; desktop title retains full safe detail. No full-path shortening in expanded details.
- No plugin, protocol, server, Hermes core, lifecycle, editor-layout or dependency/lockfile change.

## Executed verification

Evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/edit-tool-filenames/`.

- Shared formatter + production mobile component tests: 33/33. Covers namespaced tools, direct/prefixed/legacy paths, multiple files, Windows/Unicode, truncated paths, metadata/JSON exclusion, caption override, terminal/non-file preservation, details navigation and full paths in expanded HTML.
- Full serial mobile suite: 382/382; mobile TypeScript passed.
- iOS/Android Expo exports passed; exact exported bundles contain the new helper/truncated-path marker and hashes are saved in `export-verification.json`.
- Desktop typecheck/build and tests: 73/73. New test executes the production shell via React SSR and checks visible basenames despite both kinds of server caption, with original safe paths preserved in titles.
- Shared client checks passed: 24/24, 20/20 and 36/36, with the script's exact existing read-only Hermes baseline SHA guard satisfied.
- First desktop check failed because the copied current dependency tree lacked mermaid. Installed root locked dependencies offline in this isolated tree with lifecycle scripts disabled; no lockfile change, no live tree install. Rerun passed. First client check required HERMES_BASELINE; provided the existing pinned baseline, then passed. Original failure logs retained.
- `git diff --check` passed. These tests/exports are not iPhone visual acceptance, a native macOS run or signed installation packages.

## Delivery boundary

Not merged, deployed, pushed or signed. No service restart. Pending layout candidate remains untouched on its independent branch. Publishing the mobile fix requires authorization, integration against then-current main and public iOS/Android manifest/exact launchAsset verification. Native compact-row appearance and expanded detail navigation remain iPhone acceptance.
