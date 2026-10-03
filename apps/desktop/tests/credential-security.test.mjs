import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const store = await readFile(new URL("../src/main/credential-store.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8");
const shared = await readFile(new URL("../src/shared/desktop-api.ts", import.meta.url), "utf8");
const renderer = await Promise.all([
  "../src/renderer/shell.tsx",
  "../src/renderer/desktop-store.ts",
  "../src/renderer/desktop-store-core.ts",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("credential persistence requires Electron secure storage and has no plaintext fallback", () => {
  assert.match(store, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(store, /safeStorage\.encryptString/);
  assert.match(store, /safeStorage\.decryptString/);
  assert.match(store, /encrypted:\s*string/);
  assert.match(store, /mode:\s*0o600/);
  assert.match(store, /rename\(temporary, destination\)/);
  assert.doesNotMatch(store, /localStorage|sessionStorage|writeFile\([^,]+,\s*JSON\.stringify\(verified\)/);
});

test("credential IPC is fixed-purpose, sender-checked, and never exposes a token getter", () => {
  assert.match(main, /trustedSender\(event\)/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.doesNotMatch(preload, /getToken|credential|deviceToken|process\.env/);
  assert.doesNotMatch(shared, /\btoken\b|deviceToken|\bsecret\b/i);
  assert.doesNotMatch(renderer.join("\n"), /localStorage|sessionStorage|indexedDB|\btoken\b|deviceToken|\bsecret\b/i);
});

test("forget connection closes the client, clears identity projections, and deletes secure state", async () => {
  const service = await readFile(new URL("../src/main/connection-service.ts", import.meta.url), "utf8");
  const forget = service.slice(service.indexOf("async forgetConnection"), service.indexOf("async selectChannel"));
  assert.match(forget, /this\.client\?\.close\(\)/);
  assert.match(forget, /this\.client = null/);
  assert.match(forget, /this\.connection = null/);
  assert.match(forget, /this\.listedThreads\.clear\(\)/);
  assert.match(forget, /this\.selectedChannelId = undefined/);
  assert.match(forget, /this\.selectedThreadId = undefined/);
  assert.match(forget, /await this\.store\.delete\(\)/);
});

test("starting a different identity closes the old client before clearing projections", async () => {
  const service = await readFile(new URL("../src/main/connection-service.ts", import.meta.url), "utf8");
  const start = service.slice(service.indexOf("private async startClient"), service.indexOf("private connectionError"));
  assert.ok(start.indexOf("this.client?.close()") < start.indexOf("this.listedThreads.clear()"));
  assert.match(start, /this\.selectedChannelId = undefined/);
  assert.match(start, /this\.selectedThreadId = undefined/);
  assert.match(start, /client = new LivePageClient/);
});
