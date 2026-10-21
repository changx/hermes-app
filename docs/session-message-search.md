# Session message search (full text + AI ranking)

Requested by Jamie (2026-10-20): "加全文索引。加 ai 精排。" Example question: "oceanpay 合规改造项目有哪些". Search must find a Session by what was said in it, not only by its title.

## What the user sees

- **Desktop Cmd+K** and **mobile Recents search** get a **Messages** section. It is below the Sessions that match by title and above Files.
- A row shows the Session title, a short excerpt of the best matching message, and the Project (and connection when there are several).
- The first rows come from keywords plus meaning, in about 0.2 s. About half a second after typing stops, an AI model picks and orders the rows again. The section title shows `Messages · AI is ranking…`, then `Messages · ranked by AI`.
- When the AI finds that no Session answers the question, the rows go away and the note "AI found no message that answers this." shows.
- Enter (desktop) or a tap (mobile) opens the Session at the matching message. When only the title or labels matched, the Session opens normally. On mobile a long press gives the Session menu, as on every Session row.
- A Session that already matches by title is not listed again under Messages.
- Labels in the query filter message results too (AND, exact text). A query with labels and no keyword does not search messages.
- While the server still indexes older messages, the note "Older messages are still being indexed. Some may be missing." shows.
- The desktop highlight stays on the same row when the AI order arrives.

## How it works

1. The plugin's embedding service (`hermes-app-embed.service`, a separate process, never the Gateway) keeps a message index: each Session's user and assistant messages in chunks, plus one chunk with title, labels and Project. It ranks chunks by CJK-bigram keywords and by EmbeddingGemma meaning, and merges both per Session (reciprocal-rank fusion).
2. `GET /v1/sessions/search` returns the Sessions in that order with the best message `seq` and an excerpt. It removes archived Sessions and Projects and applies the labels. When the service is down, it answers `available: false` and the App shows nothing extra.
3. `GET /v1/sessions/search/refine` sends the top 30 to a small model (Hermes auxiliary task `hermes_app_search`, default Anthropic Haiku 5.5) and returns the model's pick and order, or none. The result is cached for 10 minutes.
4. Clients: `packages/client/src/sessionText.ts` (API and the merge helper `messageMatches`). Desktop: `ConnectionService.searchMessages/refineMessages`, `DesktopConnections.searchMessages` (every connected server, merged by rank), IPC `desktop:search-messages`, `session-picker.tsx`. Mobile: `app/(tabs)/index.tsx`, `mergeMessageHits` in `recentRows.ts`.
5. Capabilities: `session_search`, `session_search_refine`. Older servers show no Messages section.

## Why not LCM search

LCM search was measured on the same 97 questions: MRR 0.26 (native), 0.72 with Opus at about $12 per 1,000 questions. Its full-text index does not split Chinese words, and few summaries have embeddings. The App index scored MRR 0.83 alone and 0.93 with the Haiku ranking, at about $1.3 per 1,000 questions. Evaluation files: Channel workspace `search-eval-2026-10-20/`.

## Verification

- `packages/client/tests/session-text.test.mjs`: request shape, response checks, capabilities, merge helper.
- `apps/desktop/tests/connections.test.mjs`: several servers, qualified IDs, rank merge, refine only where offered, `none`, failures.
- `apps/desktop/tests/session-search.test.mjs` (Chromium): fast rows, no duplicate of title matches, excerpt, AI ranking state, highlight kept, Enter opens the message, AI none, indexing note, no search for labels only or in Files.
- `apps/mobile/tests/recents-search.test.mjs`: the same on the production Recents tab.
- Plugin: `tests/p1/test_session_search.py`, `tests/embed/test_message_index.py`.
- Real data (jamie, index partly built): "oceanpay 合规改造项目有哪些" lists the four OceanPay compliance Sessions first; "跑步后膝盖疼怎么办" gets AI none.

## Release: plugin v0.2.45, desktop v0.1.101, Expo

- **Plugin v0.2.45** (released by another session, 2026-10-20 20:55): contains `032080c` (message index) and `39f6308` (`/v1/sessions/search`, `/refine`). Gateway restarted at 20:57:47, after the install.
- **Desktop v0.1.101**: release commit `537581c`, tag `v0.1.101`. It also ships the unreleased `fix/search-file-open` commits (`731b31e`, `2ab1478`: a file result opens its Session at the file message), which message results depend on. Candidate checks on the same tree: client 102/102, mobile 233/233 + TypeScript + iOS/Android exports, desktop 242/244 with Chrome and Electron. The two failures (`native-electron` at `label search in the sidebar`; `browser-window-native` `UnknownVizError`) fail the same way on the base `2ab1478`. Tag run `39543800584`: 244 tests, 189 pass, 0 fail, 55 skipped, audit 0. The downloaded zip passed its SHA-256 check; Info.plist 0.1.101; arm64. `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js` and `styles.css` in the ASAR are byte-identical to the local build.
- **Expo**: runtime checkout `fc38f4f` → `537581c` (lockfile unchanged), Expo restarted (PID 1851610 → 3122984, 21:24:00). Public bundles: "AI found no message that answers this" and `sessionText.search(text, query.labels` 0 → 1 on iOS and Android. Gateway PID 3089431 unchanged.
- Evidence: Channel workspace `session-message-search-release/`.
- Rollback: desktop, reinstall v0.1.100; mobile, `git -C /opt/projects/jamie/hermes-app checkout -q --detach fc38f4f && systemctl --user restart hermes-app-expo.service`.
- Open: device acceptance on Jamie's Mac and iPhone. Not done: hide the Session you are searching from (it ranks first for its own test queries).

## Update: AI ranking with TypeSafe Jev (plugin v0.2.46, 2026-10-21)

Jamie found the Haiku ranking too slow ("每次都是 ranking by ai 好半天": 4-8 s). The ranking now uses TypeSafe Jev when the profile has `TYPESAFE_API_KEY` (hermes-app-dev and jamie do).
- How: one request scores each of the 1-2 best excerpts (600 characters, with title and Project) of the top 30 Sessions as "does this excerpt come from the discussion the user is looking for?". A Session takes its best excerpt score; Sessions under 0.3 are hidden.
- Measured on the 97-query set: first-result hits 0.90, MRR 0.93 (Haiku 0.89 / 0.93; search alone 0.77 / 0.83); 94 % of no-match queries show nothing (Haiku 50 %). Real data after deploy: 0.4-0.7 s per ranking on hermes-app-dev and jamie. Evaluation: Channel workspace `search-eval-2026-10-20/jev_*`.
- No client change: the clients still ask for the ranking 0.5 s after typing stops, so "AI is ranking…" shows for well under a second. A later client release can drop that wait.
- `HERMES_APP_SEARCH_RANKER=llm` in a profile `.env`, or no key, keeps Haiku. A Jev failure keeps the first order on screen.
- The embedding service now returns 600-character excerpts (was 300).
- LCM recall uses the same provider: `LCM_RERANK_PROVIDER=typesafe` in the hermes-app-dev and jamie `.env` (was `llm`, gpt-6-luna).
- Activation: needs a `hermes-gateway.service` restart (plugin and LCM settings load at start).

