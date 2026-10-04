import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { WebSocketServer } from "ws";

const desktopRoot = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [new URL("../src/main/transport.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { mainTransport, normalizeBaseUrl } = module.exports;

test("HTTP history accepts a complete snapshot larger than the ordinary reply limit", async (t) => {
  const payload = { complete: true, messages: [{ text: "历史".repeat(40_000) }], next_cursor: null, older_cursor: null };
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { http } = mainTransport(`http://127.0.0.1:${server.address().port}`, true);
  const reply = await http.request("GET", "/v1/threads/th_test/messages?full=true", "test-token");
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, payload);
});

test("reply limits count UTF-8 bytes and only successful history GETs get the larger budget", async (t) => {
  const server = createServer((request, response) => {
    const status = request.url.includes("error") ? 503 : 200;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ text: "汉".repeat(30_000) }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { http } = mainTransport(`http://127.0.0.1:${server.address().port}`, true);
  for (const [method, path] of [
    ["GET", "/v1/snapshot"], ["POST", "/v1/threads/th_test/messages"],
    ["GET", "/v1/threads/th_test/messages/other"], ["GET", "/v1/threads/th_test/messages?error=true"],
  ]) await assert.rejects(http.request(method, path, "test-token"), /response is too large/);
  const reply = await http.request("GET", "/v1/threads/th_test/messages?latest=true", "test-token");
  assert.equal(reply.body.text, "汉".repeat(30_000));
});

test("history streaming rejects beyond 64 MiB and cancels without consuming the entire response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let pulled = 0, cancelled = false;
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } });
  const { http } = mainTransport("https://example.com");
  await assert.rejects(http.request("GET", "/v1/threads/th_test/messages?full=true", "test-token"), /response is too large/);
  assert.equal(cancelled, true);
  assert.ok(pulled <= 66, `read ${pulled} chunks`);
});

test("streaming preserves split Unicode, exact ordinary byte boundary and cancellation", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { http } = mainTransport("https://example.com");
  const raw = new TextEncoder().encode(JSON.stringify({ text: "😀历史" }));
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { for (const byte of raw) controller.enqueue(new Uint8Array([byte])); controller.close(); },
  }), { headers: { "content-type": "application/json" } });
  assert.deepEqual((await http.request("GET", "/v1/snapshot", "test-token")).body, { text: "😀历史" });
  globalThis.fetch = async () => new Response("a".repeat(64 * 1024));
  assert.equal((await http.request("GET", "/v1/snapshot", "test-token")).body.length, 64 * 1024);
  globalThis.fetch = async () => new Response("a".repeat(64 * 1024 + 1));
  await assert.rejects(http.request("GET", "/v1/snapshot", "test-token"), /response is too large/);
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException("aborted", "AbortError")); },
  }));
  await assert.rejects(http.request("GET", "/v1/threads/th_test/messages?full=true", "test-token"), /aborted/);
});

test("production base URL accepts only a credential-free HTTPS origin", () => {
  assert.equal(normalizeBaseUrl("https://Example.COM/"), "https://example.com");
  for (const value of ["http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com/?token=secret", "file:///tmp/x"]) {
    assert.throws(() => normalizeBaseUrl(value));
  }
  assert.equal(normalizeBaseUrl("http://127.0.0.1:9000", true), "http://127.0.0.1:9000");
  assert.throws(() => normalizeBaseUrl("http://192.168.1.2:9000", true));
});

test("main transport authenticates HTTP and WebSocket with headers, never URL credentials", async (t) => {
  const observed = [];
  const server = createServer((request, response) => {
    observed.push({ kind: "http", url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  const webSockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    observed.push({ kind: "websocket", url: request.url, authorization: request.headers.authorization });
    webSockets.handleUpgrade(request, socket, head, (ws) => {
      webSockets.emit("connection", ws, request);
      ws.send("ready");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { webSockets.close(); server.close(); });
  const address = server.address();
  assert.equal(typeof address, "object");
  const transport = mainTransport(`http://127.0.0.1:${address.port}`, true);
  const token = "test-secret-never-in-url";
  const reply = await transport.http.request("GET", "/v1/snapshot", token);
  assert.deepEqual(reply.body, { ok: true });

  const controller = new AbortController();
  const socket = await transport.socket.connect("/v1/events", token, controller.signal);
  const message = await new Promise((resolve) => socket.onMessage(resolve));
  assert.equal(message, "ready");
  socket.close();
  assert.deepEqual(observed, [
    { kind: "http", url: "/v1/snapshot", authorization: `Bearer ${token}` },
    { kind: "websocket", url: "/v1/events", authorization: `Bearer ${token}` },
  ]);
  assert.equal(observed.some((item) => item.url.includes(token)), false);
});
