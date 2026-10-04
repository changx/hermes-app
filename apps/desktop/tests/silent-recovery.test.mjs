import assert from "node:assert/strict";
import { withPages } from './page-fixture.mjs';
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("../../../", import.meta.url).pathname;
const bundle = await build({ stdin: { contents: 'export { DesktopConnectionService } from "./apps/desktop/src/main/connection-service"; export { HttpError, TimeoutError, ProtocolError } from "@hermes-app/client";', resolveDir: root }, bundle: true, platform: "node", format: "cjs", external: ["electron"], write: false });
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { DesktopConnectionService, HttpError, TimeoutError, ProtocolError } = mod.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));
const fixture = () => {
  const snapshots = [], sends = [], writes = [];
  const service = new DesktopConnectionService(value => snapshots.push(value));
  service.phase = "connected";
  service.connectionState = "online";
  service.connection = { id: "abcdef0123456789abcdef01", token: "hidden" };
  service.selectedChannelId = "channel-a";
  service.selectedThreadId = "thread-a";
  service.listedThreads.set("thread-a", { id: "thread-a", project_id: "channel-a", title: "First" });
  service.outboxStore = { async put(_id, item) { writes.push(structuredClone(item)); }, async remove() {}, async clear() {} };
  service.client = {
    channels: new Map([["channel-a", { id: "channel-a", name: "Alpha" }], ["channel-b", { id: "channel-b", name: "Beta" }]]),
    threads: new Map(), messages: new Map(), receipts: new Map(), interactions: new Map(), attachments: new Map(), supportsLatest: true,
    isCatalogueReady: true, isThreadAvailable(id) { return service.listedThreads.has(id) || this.threads.has(id); },
    closeConversation() { this.messages.clear(); },
    async openConversation(id) { const page = await this.historyWindow(id); this.currentOlderCursor = page.older_cursor; },
    rememberAcceptedInput() {},
    async send(thread, id, text, attachments) { sends.push([thread, id, text, attachments]); return { id: "receipt-a", state: "queued" }; },
    async historyWindow() { return { older_cursor: null }; },
    close() {}, async retryNow() {},
  };
  withPages(service.client);
  service.pageStates.set('thread-a', { loading: false });
  return { service, snapshots, sends, writes };
};

test("transient timeouts, busy servers and network errors have no user-facing connection banner", () => {
  const { service } = fixture();
  for (const error of [new TimeoutError("timed out"), new HttpError(429), new HttpError(503), new Error("fetch failed")]) assert.equal(service.connectionError(error), undefined);
  assert.match(service.connectionError(new HttpError(401)), /no longer authorized/);
  assert.match(service.connectionError(new HttpError(403)), /no longer authorized/);
  assert.match(service.connectionError(new ProtocolError("invalid hello")), /administrator/);
});

test("failed history retries in background without losing messages or displaying an error", async () => {
  const { service, snapshots } = fixture();
  service.client.messages.set("thread-a", [{ id: "m1", ref_seq: 1, role: "assistant", text: "Still readable" }]);
  let attempts = 0;
  service.client.historyWindow = async () => { if (++attempts === 1) throw new TimeoutError("timeout"); return { older_cursor: "older" }; };
  await service.selectThread("thread-a");
  assert.equal(attempts, 2);
  assert.equal(service.olderCursor, "older");
  assert.ok(snapshots.every(s => !s.errorMessage && s.messages[0].text === "Still readable"));
  service.close();
});

test("channel selection performs no catalogue or body reads", async () => {
  const { service } = fixture();
  service.client.listThreads = async () => { throw Error('unexpected business read'); };
  const old = service.selectChannel("channel-a");
  await service.selectChannel("channel-b");

  await old;
  assert.equal(service.selectedChannelId, "channel-b");
  assert.deepEqual([...service.listedThreads.keys()], ["thread-a"]);
  service.close();
});

test("late history does not overwrite the active conversation's pagination", async () => {
  const { service } = fixture();
  service.listedThreads.set("thread-b", { id: "thread-b", project_id: "channel-a", title: "Second" });
  let release;
  service.client.historyWindow = async id => id === "thread-a" ? await new Promise(resolve => { release = resolve; }) : { older_cursor: "current" };
  const old = service.selectThread("thread-a");
  await service.selectThread("thread-b");
  release({ older_cursor: "stale" });
  await old;
  assert.equal(service.olderCursor, "current");
  service.close();
});

test("HTTP-only send failure recovers on a timer with the identical ID and payload", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { service, sends } = fixture();
  let attempt = 0;
  service.client.send = async (...args) => { sends.push(args); if (++attempt === 1) throw new TimeoutError("lost ACK"); return { id: "receipt-a", state: "queued", durable:true, thread_id:args[0], client_message_id:args[1], ref_seq:7 }; };
  await service.sendMessage({ text: "Exact original", attachmentIds: [] });
  assert.equal(service.snapshot().errorMessage, undefined);
  assert.equal(service.outbox[0].state, "pending");
  t.mock.timers.tick(5000);
  await turn();
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0], sends[1]);
  service.close();
});

test("unknown execution is checked only on explicit recovery, never polled or re-executed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { service, sends } = fixture();
  service.client.send = async (...args) => { sends.push(args); return { id: "receipt-a", state: "unknown", durable:true, thread_id:args[0], client_message_id:args[1] }; };
  let queried = 0;
  service.client.getReceipt = async () => { queried++; return { id: "receipt-a", state: "unknown", durable:true, thread_id:'thread-a', client_message_id:service.outbox[0].id }; };
  await service.sendMessage({ text: "Only once", attachmentIds: [] });
  t.mock.timers.tick(5000);
  await turn();
  assert.equal(sends.length, 1);
  assert.equal(queried, 0);
  await service.retryMessage(service.outbox[0].id);
  assert.equal(queried, 1);
  service.close();
});

test("authorization and permanent send failure are actionable, not described as safely queued", async () => {
  for (const error of [new HttpError(401), new HttpError(400)]) {
    const { service } = fixture();
    service.client.send = async () => { throw error; };
    await service.sendMessage({ text: "Cannot send", attachmentIds: [] });
    assert.equal(service.outbox[0].state, "blocked");
    assert.match(service.snapshot().errorMessage, /authorized|could not be sent/);
    assert.equal(service.outboxTimer, undefined);
    service.close();
  }
});

test("close cancels read recovery and send timers, including late send completion", async () => {
  const { service } = fixture();
  service.client.historyWindow = async () => { throw new TimeoutError("timeout"); };
  const read = service.selectThread("thread-a");
  await turn();
  assert.equal(service.readJobs.size, 1);
  service.close();
  await read;
  assert.equal(service.readJobs.size, 0);
  assert.equal(service.outboxTimer, undefined);
  const next = fixture().service;
  let release;
  next.client.send = async () => await new Promise(resolve => { release = resolve; });
  const send = next.sendMessage({ text: "Late", attachmentIds: [] });
  await turn();
  next.close();
  release({ id: "receipt-a", state: "queued" });
  await send;
  assert.equal(next.outboxTimer, undefined);
});

test("wake refreshes a live connection but does not retry revoked or permanently stopped connections", async () => {
  const { service } = fixture();
  let attempts = 0;
  service.client.retryNow = async () => { attempts++; };
  await service.resumeConnection();
  service.connectionState = "blocked";
  await service.resumeConnection();
  service.connectionState = "suspended";
  await service.resumeConnection();
  assert.equal(attempts, 1);
  service.close();
});

test("channel navigation uses the directory without a redundant list request", async () => {
  const { service } = fixture();
  let attempts = 0;
  service.client.listThreads = async () => {
    if (++attempts === 1) throw new TimeoutError("timeout");
    return { threads: [{ id: "recovered", project_id: "channel-a", title: "Recovered" }], next_cursor: null };
  };
  await service.selectChannel("channel-a");
  assert.equal(attempts, 0);
  assert.equal(service.snapshot().errorMessage, undefined);
  assert.ok(service.listedThreads.has("thread-a"));
  service.close();
});

test("full history retries without hiding already visible content", async () => {
  const { service } = fixture();
  service.olderCursor = "before-original";
  const cursors = [];
  service.client.loadFullHistory = async (id) => {
    cursors.push(id);
    if (cursors.length === 1) throw new TimeoutError("timeout");

  };
  service.client.acquirePage('thread-a');
  await service.loadOlder();
  assert.deepEqual(cursors, ["thread-a", "thread-a"]);
  assert.equal(service.olderCursor, undefined);
  assert.equal(service.snapshot().loadingHistory, false);
  assert.equal(service.snapshot().errorMessage, undefined);
  service.close();
});

test("concurrent send recovery owns only one in-flight request and late ACK cannot revive confirmed outbox", async () => {
  const { service, sends } = fixture();
  let release;
  service.client.send = async (...args) => { sends.push(args); return await new Promise(resolve => { release = resolve; }); };
  const send = service.sendMessage({ text: "Single owner", attachmentIds: [] });
  await turn();
  const pending = service.outbox[0];
  await service.deliver(pending);
  assert.equal(sends.length, 1);
  service.client.messages.set("thread-a", [{ id: "confirmed", ref_seq: 1, role: "user", text: pending.text, client_message_id: pending.id }]);
  assert.equal(service.outbox.length, 1, 'a body row is not durable local ACK cleanup');
  release({ id: "receipt-a", state: "queued", durable:true, thread_id:pending.threadId, client_message_id:pending.id, ref_seq:1 });
  await send;
  assert.equal(service.outbox.length, 0);
  service.close();
});

test("send throttling respects Retry-After instead of hammering a busy server", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { service, sends } = fixture();
  service.client.send = async (...args) => { sends.push(args); throw new HttpError(429, 20_000); };
  await service.sendMessage({ text: "Wait safely", attachmentIds: [] });
  t.mock.timers.tick(5000);
  await turn();
  assert.equal(sends.length, 1);
  t.mock.timers.tick(15000);
  await turn();
  assert.equal(sends.length, 2);
  assert.equal(service.snapshot().errorMessage, undefined);
  service.close();
});

test("normal desktop header has no technical connection status or manual reconnect control", async () => {
  const source = await readFile(new URL("../src/renderer/shell.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("snapshot.connectionLabel"), false);
  assert.equal(source.includes('title="Retry connection"'), false);
});
