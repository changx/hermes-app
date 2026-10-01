import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/main/connection-service.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopConnectionService } = module.exports;

const fixture = () => {
  const published = [];
  const storage = [];
  const removed = [];
  const calls = [];
  const service = new DesktopConnectionService((snapshot) => published.push(snapshot));
  service.phase = "connected";
  service.connectionState = "online";
  service.connection = { version: 1, baseUrl: "https://example.com", id: "abcdef0123456789abcdef01", token: "hidden" };
  service.selectedChannelId = "channel-a";
  service.selectedThreadId = "thread-a";
  service.listedThreads.set("thread-a", { id: "thread-a", project_id: "channel-a", title: "First", archived: false });
  service.outboxStore = {
    async list() { return []; },
    async put(_identity, record) { storage.push(structuredClone(record)); },
    async remove(_identity, id) { removed.push(id); },
    async clear() {},
  };
  service.client = {
    channels: new Map([["channel-a", { id: "channel-a", name: "Alpha" }]]),
    threads: new Map(),
    messages: new Map([["thread-a", []]]),
    receipts: new Map(),
    interactions: new Map(),
    attachments: new Map(),
    supportsLatest: true,
    async send(threadId, clientMessageId, text, attachmentIds) {
      calls.push(["send", threadId, clientMessageId, text, attachmentIds]);
      return { id: "receipt-a", client_message_id: clientMessageId, thread_id: threadId, state: "queued", durable: true };
    },
    async getReceipt(id) {
      calls.push(["receipt", id]);
      return { id, client_message_id: service.outbox[0].id, thread_id: "thread-a", state: "unknown", durable: true };
    },
    async markRead(threadId, refSeq) { calls.push(["read", threadId, refSeq]); },
  };
  return { service, storage, removed, calls, published };
};

test("send persists before transport, keeps a stable identity, and reconciles one durable message", async () => {
  const { service, storage, removed, calls } = fixture();
  await service.sendMessage({ text: "Hello", attachmentIds: [] });
  assert.equal(storage[0].state, "pending");
  assert.equal(storage[1].state, "sending");
  assert.equal(calls[0][0], "send");
  assert.match(calls[0][2], /^desktop:[0-9a-f-]{36}$/);
  assert.equal(storage.at(-1).id, calls[0][2]);
  assert.equal(storage.at(-1).receiptId, "receipt-a");
  const optimistic = service.snapshot().messages;
  assert.equal(optimistic.length, 1);
  assert.equal(optimistic[0].id, `client:${calls[0][2]}`);
  assert.equal(optimistic[0].optimistic, true);

  service.client.messages.set("thread-a", [{ id: "server-a", ref_seq: 1, role: "user", text: "Hello", client_message_id: calls[0][2] }]);
  service.reconcileOutbox();
  await Promise.resolve();
  const reconciled = service.snapshot().messages;
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, `client:${calls[0][2]}`);
  assert.equal(reconciled[0].optimistic, undefined);
  assert.deepEqual(removed, [calls[0][2]]);
});

test("unknown delivery is reconciled by receipt and is not blindly resent", async () => {
  const { service, calls } = fixture();
  service.client.send = async (threadId, clientMessageId) => {
    calls.push(["send", threadId, clientMessageId]);
    return { id: "receipt-unknown", client_message_id: clientMessageId, thread_id: threadId, state: "unknown", durable: true };
  };
  await service.sendMessage({ text: "Uncertain", attachmentIds: [] });
  const id = service.outbox[0].id;
  assert.equal(service.outbox[0].state, "unknown");
  await service.retryMessage(id);
  assert.deepEqual(calls.map(([kind]) => kind), ["send", "receipt"]);
  assert.equal(service.outbox[0].id, id);
});

test("history fetch does not mark read until the renderer reports a visible ref", async () => {
  const { service, calls } = fixture();
  service.olderCursor = "older-a";
  service.client.historyWindow = async (threadId, cursor) => {
    calls.push(["history", threadId, cursor]);
    return { messages: [], older_cursor: null };
  };
  await service.loadOlder();
  assert.deepEqual(calls, [["history", "thread-a", "older-a"]]);
  await service.markVisible(19);
  assert.deepEqual(calls.at(-1), ["read", "thread-a", 19]);
});

test("archived threads are removed from projection and selection falls back deterministically", async () => {
  const { service } = fixture();
  service.listedThreads.set("thread-b", { id: "thread-b", project_id: "channel-a", title: "Second", archived: false, last_message_at: 2 });
  service.client.archiveThread = async (id) => ({ id, project_id: "channel-a", title: "First", archived: true });
  service.client.historyWindow = async () => ({ messages: [], older_cursor: null });
  await service.archiveThread("thread-a");
  assert.equal(service.snapshot().threads.some(({ id }) => id === "thread-a"), false);
  assert.equal(service.snapshot().selectedThreadId, "thread-b");
});

test("cross-channel tree and switcher retain all summaries and select the correct parent", async () => {
  const { service, calls } = fixture();
  service.client.channels.set("channel-b", { id: "channel-b", name: "Beta" });
  service.client.threads.set("thread-b", { id: "thread-b", project_id: "channel-b", title: "Other", archived: false, last_message_at: 10 });
  service.client.historyWindow = async (id) => { calls.push(["history", id]); return { messages: [], older_cursor: null }; };
  assert.deepEqual(new Set(service.snapshot().threads.map(({ channelId }) => channelId)), new Set(["channel-a", "channel-b"]));
  await service.selectThread("thread-b");
  assert.equal(service.snapshot().selectedChannelId, "channel-b");
  assert.equal(service.snapshot().selectedThreadId, "thread-b");
  assert.deepEqual(calls, [["history", "thread-b"]]);
  assert.equal(service.snapshot().threads.length, 2);
});

test("timeline excludes private reasoning while preserving public commentary and stable identities", () => {
  const { service } = fixture();
  service.client.messages.set("thread-a", [
    { id: "private-a", ref_seq: 1, role: "analysis", text: "secret reasoning" },
    { id: "public-a", ref_seq: 2, role: "commentary", text: "Public progress" },
    { id: "user-a", ref_seq: 3, role: "user", text: "Same text" },
    { id: "user-b", ref_seq: 4, role: "user", text: "Same text" },
  ]);
  const messages = service.snapshot().messages;
  assert.deepEqual(messages.map(({ id, role, text }) => ({ id, role, text })), [
    { id: "message:public-a", role: "assistant", text: "Public progress" },
    { id: "message:user-a", role: "user", text: "Same text" },
    { id: "message:user-b", role: "user", text: "Same text" },
  ]);
  assert.equal(JSON.stringify(messages).includes("secret reasoning"), false);
});
