# Generated titles and Session search

## Behavior

Desktop and mobile create automatic conversations with `New topic`. The plugin generates the display title and `title_alphabet` in one structured auxiliary-model request. `title_alphabet` is Latin transliteration, not an English translation. Chinese uses untoned pinyin syllables; other scripts use conventional Latin transliteration. Latin technical identifiers remain unchanged.

The plugin owns metadata on the stable Thread. A transaction saves title and alphabet together. Manual rename clears stale alphabet, increments a revision and starts alphabet-only generation for the exact new title. Both automatic title and alphabet-only writes check the captured title/revision and archive state, so a late result cannot overwrite manual edits, including rename-away-and-back. Model failure leaves a usable deterministic title and an empty alphabet. Retries are bounded. Existing titles are not bulk-renamed or backfilled by this release.

Catalogue readers carry `title_alphabet` through the shared client and desktop snapshot. Older servers may omit it. Search reads directory metadata only; it does not open message bodies or build another authoritative history store.

The desktop Session picker serves Cmd+K and Find a session. It matches original titles, Latin transliteration with or without separators, initials and Channel names. Matching folds case and Latin accent marks. Results prioritize title matches, full transliteration, then initials. Result labels remain original titles. There is no separate mobile Session search UI in this change.

The input retains focus while Up/Down select a result. Selection is visibly highlighted and scrolls into view. Enter opens the selected Session and closes only after successful selection. Escape closes without switching. Queries reset selection; empty results do not activate anything. IME composition leaves arrows, Enter and Escape to the input method. Pointer and keyboard share one selection state. The picker exposes combobox/listbox/option semantics.

## Verification and publication boundary

Focused production Chromium checks cover Chinese/full/compact/initial search, non-Chinese transliteration, accent folding, arrows, Enter, Escape, IME, malformed catalogue metadata and actual desktop New topic submission. Plugin checks cover structured model payload, invalid alphabet fallback, cold reads, title-revision races and two authenticated directory-only WebSocket clients. A real Hermes auxiliary-model call exercised the production adapter and isolated cold directory read.

An existing native-command test previously stopped on an older identical final reply before the submitted message was published. Its wait now requires the exact expected input/reply pair; no assertions or tested operations were removed.

Private evidence: Channel workspace `title-alphabet/`. Merge and artifact publication do not prove backend activation. The current development Gateway owns this task and cannot safely restart itself. Plugin activation and migration require an independent operator and a stopped-profile backup. No Hermes core or other profile change is included. Native-device acceptance, signing and independent mobile packages remain separate gates.
