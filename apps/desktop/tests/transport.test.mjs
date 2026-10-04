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
  const reply = await transport.http.request("GET", "/v1/catalogue", token);
  assert.deepEqual(reply.body, { ok: true });

  const controller = new AbortController();
  const socket = await transport.socket.connect("/v1/live", token, controller.signal);
  const message = await new Promise((resolve) => socket.onMessage(resolve));
  assert.equal(message, "ready");
  socket.close();
  assert.deepEqual(observed, [
    { kind: "http", url: "/v1/catalogue", authorization: `Bearer ${token}` },
    { kind: "websocket", url: "/v1/live", authorization: `Bearer ${token}` },
  ]);
  assert.equal(observed.some((item) => item.url.includes(token)), false);
});
