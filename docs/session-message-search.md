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

## Status

Not released. Device acceptance on Jamie's iPhone and Mac is pending.
