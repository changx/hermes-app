# P1-05 shared client contract (03-backed)

Status: local test clients, not a product UI or installed app. The pinned Hermes baseline is `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`; protocol version is 1. Source of truth: [P1-03 protocol](protocol.md) and `plugins/hermes_app/adapter.py` in this worktree. P1-04 routes are intentionally absent pending integration.

`packages/client/src/index.ts` is pure TypeScript with injected `HttpTransport`, `SocketFactory`, and a token provider. It imports no Node, Electron, DOM, React, or React Native modules. The caller owns secure credential storage and supplies the token at connection/request time; the client does not persist it. Every HTTP request and WS upgrade uses `Authorization: Bearer`; URL and logs never carry it. A browser native WebSocket cannot set the required header. `tests/client/desktop/transport.mjs` uses Node `ws` to prove the desktop JS target. `tests/client/mobile/transport.js` uses the React Native WebSocket options header; its Node execution uses a deliberate `ws` shim, not a phone runtime.

## Public operations

- `capabilities` requires protocol 1 with durable sync. Channel list/create/update/delete use `/v1/channels`; Thread list/create/get/update/archive use `/v1/channels/{id}/threads` and `/v1/threads/{id}`.
- `send(threadId, clientMessageId, text)` requires a caller-generated unique ID. A retry must repeat the same ID, Thread and exact text. A separate send, even with identical text, needs a new ID. The server returns a durable 202 receipt. `getReceipt` obtains queued, running, completed, failed, interrupted or unknown. Unknown is displayed for user resolution and never triggers an automatic new send or execution retry.
- `history` retrieves bounded pages of original visible refs; `historyAll` follows pages for an invalidation. The map is merged by `ref_seq`, in order. A draft map is separate and is cleared on close. Missing original history and other non-2xx HTTP responses surface as errors.
- `markRead` sends a visible ref and keeps the local ref monotone. The server remains authoritative for unread counts. Project lists are refetched after Channel invalidations; Thread metadata and read counts are refetched from the server after their events.

## Sync sequence

1. Take the first `/v1/snapshot` waterline and retain it while paging the remaining Thread summaries. Then fetch `/v1/channels`.
2. Replay `/v1/sync` from that first waterline. Process each event's referenced entity before advancing the cursor; a failed fetch leaves the last processed cursor intact. A 400 invalid/future/foreign cursor and a nonconsecutive event ID raise `ResyncRequired`. The caller explicitly invokes `resync` to obtain a new snapshot.
3. Open `/v1/events?cursor=<last processed>` through the injected authorized socket. WS event frames trigger serialized HTTP durable replay from the current cursor. Duplicate/old events do not create duplicate refs; entity version and event ID prevent stale fetch responses from replacing newer data.
4. On disconnect, replay HTTP first, then reopen WS with bounded backoff. `close()` aborts owned requests/socket and clears ephemeral drafts. It never calls a stop-execution route. Each `connect()` owns its controller, replay and socket; a completed run releases that ownership. After `ResyncRequired`, the caller can await `resync()` and call `connect()` again on the same client. A late close, handshake or HTTP reply from an aborted run cannot close a newer socket or advance its cursor. The caller should retain the last processed cursor in an identity-scoped cache if persistence is wanted; the SDK keeps it in memory only.

The WS factory buffers frames delivered between handshake and callback registration. The server holds durable state and original message text; the client maps are disposable views. No OpenAI/TUI JSON-RPC or Discord compatibility is involved. The SDK does not yet expose P1-04 approvals, attachments, proactive tasks or a UI state store. After 04 integration, add only routes verified against its actual backend and update both contract tests and this document.

## Validation boundary

`bash scripts/client-check.sh BASELINE` type checks and runs injected transport/reducer tests. `node tests/client/real-gateway.mjs` runs the actual isolated plugin loader and GatewayRunner with a loopback synthetic model: two JS adapters authenticate, create Channel/Threads, send and retry the same ID, receive final history, mark read and replay after a process restart. Android Metro exports a JS bundle containing this new shared module and a native React Native view entry. The mobile network adapter executed in Node with a shim; no phone, APK, background OS behavior, credential vault, or installability is claimed.
