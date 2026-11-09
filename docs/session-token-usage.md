# Session token usage

Requested by Jamie: show each Session's current context size and its cumulative tokens. Desktop shows them in the sidebar Session card and in the Session status bar. Mobile shows them on the Session options page.

## Values

Both values come from Hermes core. The plugin reads them and does not count anything itself.

- **Context**: the prompt tokens of the latest model request of the Session's current core session. Core's Gateway stores this value on the session routing entry (`SessionEntry.last_prompt_tokens`) when a turn ends, and `/status` and `/usage` show the same value. Each request sends the compacted context, so this is the context after LCM compaction. It includes the system prompt, summaries, the fresh tail and tool definitions.
- **Total**: the sum over every core session that carried the Thread of `input + cache_read + cache_write + output` tokens (core `CanonicalUsage.total_tokens`, the `sessions` rows in the profile `state.db`). This is billed throughput, not the conversation size: each request sends the context again.

The context is unknown (`null`) when the routing entry does not carry this Thread's session or has no value yet: a new Thread, a reset Session, or an old Thread whose session was replaced. The total is then still shown.

The values change only when a turn ends. Clients read them again when a Session gets a new message or stops running. While a Session runs, the last reading stays.

## Protocol

Plugin 0.2.55, capability `thread_usage`. `GET /v1/threads/{id}/usage` returns:

```json
{"usage": {"thread_id": "th_…", "context_tokens": 28202, "total_tokens": 206250929,
  "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "reasoning_tokens": 0, "api_calls": 0}}
```

An unknown or archived Thread gives 404. See the plugin's `docs/thread-usage.md`.

Shared client (`packages/client/src/threadUsage.ts`): `supportsThreadUsage`, `threadUsage(threadId)` → `{ contextTokens, totalTokens }` (`undefined` without the capability), `formatTokens` (28.2K, 125K, 1.2M, 206M) and `exactTokens` (28,202).

## Desktop

- Sidebar Session card: one more line, `Context 28.2K · Total 206M` (or `Total 206M` without a context), before `Last message`. The card opens at once; the line arrives with the reading. The screen-reader description has the full counts.
- Session status bar: the same text at the right end, after the labels. It keeps its width; the labels give up room first. The tooltip and accessible name give the full counts: `Context: 28,202 tokens in the latest request. Total: 206,250,929 tokens used by this session.` It takes keyboard focus so the tooltip is reachable.
- Readings: `src/renderer/thread-usage.ts`. One reading per Session and version (last message time; not while running), shared by the card and the status bar, kept at most 60 s. A failed read or a server without `thread_usage` shows nothing.
- IPC `desktop:thread-usage`: the main window reads any Session; a Session page reads only its own Session. It resolves `null` when the value is unavailable.

## Mobile

Session options page, section `Usage` between `This session` and `App`:

- `Context` — detail `Latest request, after compaction`, value `28.2K tokens`. Hidden without a current value.
- `Total` — detail `All requests in this session`, value `206M tokens`.

The rows are read-only (no chevron). The page reads the values once when it opens. Without the capability, or after a failed read, the section does not show. Screen readers get the full counts.

## Verification

- Plugin: `tests/p1/test_thread_usage.py` (real core SessionDB and plugin Store over loopback HTTP: sums over every session of the Thread only, context from the routing entry only for this Thread's session, null for no entry / zero / another Thread's session, a routing failure keeps the totals, auth, 404, capability, no state database).
- Client: `packages/client/tests/thread-usage.test.mjs` (capability gate, no request to an old server, parsing, rejected mismatches, number format).
- Desktop: `session-status-bar.test.mjs` (position at 1100 and 640 px with ten labels, text, tooltip, no read while running, one read after the turn, total only, nothing without usage), `sidebar-session-card.test.mjs` (usage line, screen-reader text, one read per Session), `session-card-window.test.mjs` (request validation).
- Mobile: `tests/session-options.test.mjs` (rows, values, accessible counts, not buttons, hidden context, hidden section).
- Real data check (read-only): this Thread's sessions in the hermes-app-dev `state.db` sum to the value the route computes. The multiplexed Gateway persists routing entries in the root `~/.hermes/state.db`; the plugin reads the live `SessionStore`, not that file.
- Pending: real-device acceptance on Mac and iPhone.
