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
const request = { baseUrl: "https://example.com", code: "ABCD-EFGH-JKLM-NPQR", deviceName: "Test Mac" };

const fixture = () => {
  const published = [];
  const writes = { pairing: [], connection: [], deletes: 0 };
  const service = new DesktopConnectionService((value) => published.push(value));
  service.store = {
    async load() { return null; },
    async savePairing(value) { writes.pairing.push(value); },
    async saveConnection(value) { writes.connection.push(value); },
    async delete() { writes.deletes += 1; },
  };
  service.startClient = async function(connection) {
    this.connection = connection;
    this.phase = "connected";
    this.changed();
  };
  return { service, published, writes };
};

const response = (status, body = null) => new Response(body === null ? "" : JSON.stringify(body), {
  status,
  headers: body === null ? {} : { "content-type": "application/json" },
});

test("pairing validates input before creating or storing a credential", async (t) => {
  const { service, writes } = fixture();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  await service.pair({ ...request, code: "not-a-code" });
  assert.equal(writes.pairing.length, 0);
  assert.match(service.snapshot().errorMessage, /complete one-time pairing code/i);
  assert.equal(JSON.stringify(service.snapshot()).includes("ha_dev_"), false);
});

test("expired pairing deletes the pending credential and reports a safe error", async (t) => {
  const { service, writes } = fixture();
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => ++call === 1 ? response(401) : response(400));
  await service.pair(request);
  assert.equal(writes.pairing.length, 1);
  assert.equal(writes.connection.length, 0);
  assert.equal(writes.deletes, 1);
  assert.match(service.snapshot().errorMessage, /invalid or expired/i);
  assert.equal(JSON.stringify(service.snapshot()).includes(writes.pairing[0].connection.token), false);
});

test("successful pairing verifies capabilities before promoting the credential", async (t) => {
  const { service, writes } = fixture();
  let call = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    call += 1;
    if (call === 1) return response(401);
    if (call === 2) {
      const payload = JSON.parse(init.body);
      return response(201, { device_id: payload.device_token.slice(7, 31) });
    }
    return response(200, { protocol: 1, durable_sync: true });
  });
  await service.pair(request);
  assert.equal(call, 3);
  assert.equal(writes.connection.length, 1);
  assert.equal(writes.connection[0].token, writes.pairing[0].connection.token);
  assert.equal(service.snapshot().phase, "connected");
  assert.equal(JSON.stringify(service.snapshot()).includes(writes.connection[0].token), false);
});

test("duplicate pairing requests do not create concurrent exchanges and cancellation clears pending state", async (t) => {
  const { service, writes } = fixture();
  let releaseSave;
  service.store.savePairing = async (value) => {
    writes.pairing.push(value);
    await new Promise((resolve) => { releaseSave = resolve; });
  };
  t.mock.method(globalThis, "fetch", (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }));
  const first = service.pair(request);
  await Promise.resolve();
  await service.pair(request);
  assert.equal(writes.pairing.length, 1);
  releaseSave();
  while (!service.pairingController) await new Promise((resolve) => setImmediate(resolve));
  await service.cancelPairing();
  await first;
  assert.equal(service.snapshot().phase, "unpaired");
  assert.equal(writes.deletes, 1);
});

test("read-only projection loads threads for the selected channel and the selected conversation", async () => {
  const { service } = fixture();
  const calls = [];
  service.phase = "connected";
  service.client = {
    channels: new Map([
      ["channel-a", { id: "channel-a", name: "Alpha" }],
      ["channel-b", { id: "channel-b", name: "Beta" }],
    ]),
    threads: new Map(),
    messages: new Map(),
    supportsLatest: true,
    async listThreads(channelId) {
      calls.push(["threads", channelId]);
      return { threads: [{ id: "thread-a", project_id: channelId, title: "First", unread_count: 2, last_message_at: 10 }], next_cursor: null };
    },
    async historyWindow(threadId) {
      calls.push(["history", threadId]);
      this.messages.set(threadId, [{ id: "message-a", ref_seq: 7, role: "assistant", text: "Visible reply" }]);
      service.changed();
      return { messages: this.messages.get(threadId) };
    },
    async markRead(threadId, ref) { calls.push(["read", threadId, ref]); },
  };
  await service.selectChannel("channel-a");
  assert.deepEqual(calls, [["threads", "channel-a"]]);
  assert.equal(service.snapshot().threads[0].unreadCount, 2);
  await service.selectThread("thread-a");
  assert.deepEqual(calls, [["threads", "channel-a"], ["history", "thread-a"], ["read", "thread-a", 7]]);
  assert.deepEqual(service.snapshot().messages, [{ id: "message-a", role: "assistant", text: "Visible reply" }]);
  await service.selectChannel("channel-b");
  assert.equal(service.snapshot().selectedThreadId, undefined);
  assert.equal(service.snapshot().messages.length, 0);
});
