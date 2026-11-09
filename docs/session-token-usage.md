# Session token usage

Requested by Jamie: show each Session's current context size and its cumulative tokens. Later also the cache hit rate of the latest request (plugin 0.2.56). Desktop shows them in the sidebar Session card and in the Session status bar. Mobile shows them on the Session options page.

## Values

Both values come from Hermes core. The plugin reads them and does not count anything itself.

- **Context**: the prompt tokens of the latest model request of the Session's current core session. Core's Gateway stores this value on the session routing entry (`SessionEntry.last_prompt_tokens`) when a turn ends, and `/status` and `/usage` show the same value. Each request sends the compacted context, so this is the context after LCM compaction. It includes the system prompt, summaries, the fresh tail and tool definitions.
- **Total**: the sum over every core session that carried the Thread of `input + cache_read + cache_write + output` tokens (core `CanonicalUsage.total_tokens`, the `sessions` rows in the profile `state.db`). This is billed throughput, not the conversation size: each request sends the context again.

- **Cache hit**: the share of the input of the latest turn's **first** main-model request that came from the prompt cache: `cache_read / prompt_tokens`, where `prompt_tokens = input + cache_read + cache_write` (core `CanonicalUsage`; the same definition as the core CLI status bar). The first request of a turn is the one after the pause since the previous turn, so this number shows whether the cache survived that pause (Anthropic's default cache lives about 5 minutes). Later requests of the same turn reuse the cache of the request before them and almost always hit it, so they are not shown. The plugin records requests from core's documented `post_api_request` hook, which passes the `turn_id` and fires only for successful requests. Table `session_turn_first_requests` (plugin 0.2.57, `metadata.sqlite`) keeps one row per core session: a request replaces the row only when its `turn_id` differs and it is newer. The route takes the Thread's newest turn and gives its earliest row across the Thread's sessions, so a compression in the middle of a turn does not replace the turn's first request. Table `session_last_requests` (0.2.56) still keeps the latest request and the route returns it as `last_request`; the clients do not show it. Auxiliary calls (titles, compression) do not fire this hook, so they never count. Rows idle for 90 days are removed. A request without cache read and without cache write means the provider reported no cache data: the clients show nothing, not 0%. A request that wrote the cache but read nothing is a real miss and shows 0%. The percent is rounded down, so only a full hit shows 100%. A 0.2.56 plugin sends no `turn_first_request`, so the clients show no cache value with it.

The context is unknown (`null`) when the routing entry does not carry this Thread's session or has no value yet: a new Thread, a reset Session, or an old Thread whose session was replaced. The total is then still shown.

The values change only when a turn ends. Clients read them again when a Session gets a new message or stops running. While a Session runs, the last reading stays.

## Protocol

Plugin 0.2.55, capability `thread_usage`. `GET /v1/threads/{id}/usage` returns:

```json
{"usage": {"thread_id": "th_…", "context_tokens": 28202, "total_tokens": 206250929,
  "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "reasoning_tokens": 0, "api_calls": 0}}
```

Plugin 0.2.56 adds `last_request`: `{prompt_tokens, cache_read_tokens, cache_write_tokens, output_tokens, at}` or `null` before the first recorded request. An unknown or archived Thread gives 404. See the plugin's `docs/thread-usage.md`.

Shared client (`packages/client/src/threadUsage.ts`): `supportsThreadUsage`, `threadUsage(threadId)` → `{ contextTokens, totalTokens, cache }` (`cache` is `{ readTokens, promptTokens }` or `null`; `cacheHitPercent`) (`undefined` without the capability), `formatTokens` (28.2K, 125K, 1.2M, 206M) and `exactTokens` (28,202).

## Desktop

- Sidebar Session card: one more line, `Context 28.2K · Cache 99% · Total 206M` (or `Total 206M` without a context), before `Last message`. The card opens at once; the line arrives with the reading. The screen-reader description has the full counts.
- Session status bar: the same text at the right end, after the labels. It keeps its width; the labels give up room first. The tooltip and accessible name give the full counts: `Context: 28,202 tokens in the latest request. Cache: 99% of the input of the latest turn's first request came from the prompt cache (239,459 of 240,051 tokens). Total: 206,250,929 tokens used by this session.` It takes keyboard focus so the tooltip is reachable.
- Readings: `src/renderer/thread-usage.ts`. One reading per Session and version (last message time; not while running), shared by the card and the status bar, kept at most 60 s. A failed read or a server without `thread_usage` shows nothing.
- IPC `desktop:thread-usage`: the main window reads any Session; a Session page reads only its own Session. It resolves `null` when the value is unavailable.

## Mobile

Session options page, section `Usage` between `This session` and `App`:

- `Context` — detail `Latest request, after compaction`, value `28.2K tokens`. Hidden without a current value.
- `Cache hit` — detail `First request of the latest turn`, value `99%`. Hidden without cache data.
- `Total` — detail `All requests in this session`, value `206M tokens`.

The rows are read-only (no chevron). The page reads the values once when it opens. Without the capability, or after a failed read, the section does not show. Screen readers get the full counts.

## Verification

- Plugin: `tests/p1/test_thread_usage.py` (real core SessionDB and plugin Store over loopback HTTP: sums over every session of the Thread only, context from the routing entry only for this Thread's session, null for no entry / zero / another Thread's session, a routing failure keeps the totals, auth, 404, capability, no state database).
- Client: `packages/client/tests/thread-usage.test.mjs` (capability gate, no request to an old server, parsing, rejected mismatches, number format).
- Desktop: `session-status-bar.test.mjs` (position at 1100 and 640 px with ten labels, text, tooltip, no read while running, one read after the turn, total only, nothing without usage), `sidebar-session-card.test.mjs` (usage line, screen-reader text, one read per Session), `session-card-window.test.mjs` (request validation).
- Mobile: `tests/session-options.test.mjs` (rows, values, accessible counts, not buttons, hidden context, hidden section).
- Real data check (read-only): this Thread's sessions in the hermes-app-dev `state.db` sum to the value the route computes. The multiplexed Gateway persists routing entries in the root `~/.hermes/state.db`; the plugin reads the live `SessionStore`, not that file.
- Pending: real-device acceptance on Mac and iPhone.

## Release record (2026-11-09)

Authorized by Jamie ("合并发布").

- Plugin: repository `main` `e260221`, 0.2.55 package `hermes-app-plugin-0.2.55-6786c8f1….tar.gz` (sha256 check passes). Extracted to `plugin-releases/hermes-app/releases/0.2.55`; files equal the source. `current` 0.2.54 → 0.2.55 (shared by every profile). Gateway not restarted (PID 1434745, started 2026-11-08 19:11:03 PST); waits for Jamie. Until the restart, the running plugin is 0.2.54: the clients do not see `thread_usage` and show nothing.
- App: `main` `45c6871` (feature) and `85b1a60` (desktop version), tag `v0.1.123`, pushed atomically. Rollback branch `rollback/thread-usage-before-release` (`8c8bb4c`).
- Expo Go: only `hermes-app-expo.service` restarted (PID 576909 → 1722152). Public iOS and Android manifests 200, SDK 58.0.0; launchAssets 200 (iOS 12861827 bytes, Android 12952881 bytes); both contain the Usage section text and the `/usage` route.
- TestFlight: iOS update `2c99cf16-1088-4dea-a4d0-5507a833ca0c`, runtime `b32a4b59…` (build 2), commit `85b1a60`. The public manifest returns this id with `expo-signature`; bundle 200, 13754991 bytes, SHA-256 equals the record.
- Desktop v0.1.123: run 42595509778. Attempts 1 and 2 failed in the staple check: the connection to Apple CloudKit dropped (`NSURLErrorDomain -1005`, Error 68), the same failure as v0.1.122. A check from the Mac mini between the attempts reached `api.apple-cloudkit.com` normally. Attempt 3 passed every step: tests 268 (207 pass, 0 fail, 61 skipped), `npm audit` 0 vulnerabilities, `spctl` `source=Notarized Developer ID`. Release published (`Hermes-0.1.123-macOS-arm64.dmg`); the downloaded DMG passes `sha256sum -c` and equals the runner's DMG. The runner's app: Info.plist 0.1.123, Developer ID Application (team 4R5932XFRV), its ASAR contains `desktop:thread-usage`, `status-usage` and the usage text.
- Rollback: plugin `current` back to `releases/0.2.54`, then a Gateway restart; App `git revert 45c6871`, restart Expo, TestFlight `rollback --to bb9bbdf1-17ff-46ec-b7ef-2aaccc3da9ef`; desktop reinstall v0.1.122.
- Pending: Jamie restarts `hermes-gateway.service`; then check authenticated capabilities (`thread_usage`) and `/v1/threads/{id}/usage` on hermes-app-dev and jamie. Mac (install v0.1.123) and iPhone (Expo Go reload; TestFlight two cold launches) acceptance.

## Release record: cache hit rate (2026-11-09)

Authorized by Jamie ("合并发布").

- Plugin: repository `main` `3f1c17e`, 0.2.56 package `hermes-app-plugin-0.2.56-8b4c7349….tar.gz` (sha256 check passes), extracted to `plugin-releases/hermes-app/releases/0.2.56`; files equal the source. `current` 0.2.55 → 0.2.56. Gateway not restarted (PID 1836940, started 03:27:45 PST); waits for Jamie. The restart creates the table `session_last_requests` in each profile's `metadata.sqlite` (additive; no existing data changes). Hit rates show only after the next model request of a session.
- App: `main` `2f39171` (feature) and `83ffe37` (version), tag `v0.1.125`. Another session had released desktop v0.1.124 (`a1e4a6f`, catalogue reply limit) before; this branch was on top of it. Rollback branch `rollback/cache-hit-rate-before-release` (`16d99de`).
- Expo Go: only `hermes-app-expo.service` restarted (PID 1722152 → 1838713). Public iOS and Android manifests 200, SDK 58.0.0; launchAssets 200 (iOS 12863863 bytes, Android 12954917 bytes), both contain the Cache hit row and `last_request`.
- TestFlight: iOS update `4f5ed937-04be-4979-85a7-19edb6ddd3b6`, runtime `b32a4b59…`, commit `83ffe37`. Public manifest returns this id with `expo-signature`; bundle 200, 13756279 bytes, SHA-256 equals the record.
- Desktop v0.1.125: run 42609420711 passed at the first attempt: tests 269 (208 pass, 0 fail, 61 skipped), `npm audit` 0, `spctl` `source=Notarized Developer ID`. The downloaded DMG passes `sha256sum -c` and equals the runner's DMG; the app is 0.1.125, Developer ID Application (team 4R5932XFRV), its ASAR contains the cache text.
- Rollback: plugin `current` back to `releases/0.2.55` and a Gateway restart (the extra table can stay); App `git revert 2f39171`, restart Expo, TestFlight `rollback --to 2c99cf16-1088-4dea-a4d0-5507a833ca0c`; desktop reinstall v0.1.124.
- Pending: Jamie restarts the Gateway; then check `last_request` after one model request. Mac (v0.1.125) and iPhone acceptance.

## Release record: cache hit rate of the turn's first request (2026-11-09)

- Plugin 0.2.57: `main` `9e4ce55`. Package `hermes-app-plugin-0.2.57-f59b004c….tar.gz`, installed at `~/.hermes/plugin-releases/hermes-app/releases/0.2.57` (equal to the source tree); `current` points to it. New table `session_turn_first_requests`; the route adds `turn_first_request`. Plugin P1: usage route 11/11; the full suite has the 20 test-setup failures that `main` already had.
- App: `main` `f0aab5c` (feature), `a9858bc` (v0.1.126), tag `v0.1.126`. Client 118/118, desktop 269 (208 pass, 0 fail), mobile 251 (250 pass, 0 fail); type checks pass.
- Expo Go: `hermes-app-expo.service` restarted (PID 1838713 → 1874302).
- TestFlight: iOS update `ca8e951d-7ecc-407e-b51d-adc440dbab05`, runtime `b32a4b59…`, commit `a9858bc`, bundle 13756302 bytes; the bundle contains `turn_first_request` and the new subtitle.
- Desktop v0.1.126: run 42614129030. The first attempt failed at staple (Error 68, CloudKit) after notarization; the rerun passed. Release assets: `Hermes-0.1.126-macOS-arm64.dmg` (146964492 bytes) and its `.sha256`.
- Rollback: plugin `current` back to `releases/0.2.56` and a Gateway restart (the extra table can stay); App `git revert f0aab5c`, restart Expo, TestFlight `rollback --to 4f5ed937-04be-4979-85a7-19edb6ddd3b6`; desktop reinstall v0.1.125.
- Pending: Jamie restarts the Gateway; then check `turn_first_request` after one model request. Mac (v0.1.126) and iPhone acceptance.
