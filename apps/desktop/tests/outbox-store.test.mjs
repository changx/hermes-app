import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/main/outbox-store.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  write: false,
});
const actualRequire = createRequire(import.meta.url);
const loadStore = (directory, available = true) => {
  const electron = {
    app: { getPath(name) { assert.equal(name, "userData"); return directory; } },
    safeStorage: {
      isEncryptionAvailable() { return available; },
      encryptString(value) { return Buffer.from(`cipher:${value}`, "utf8"); },
      decryptString(value) {
        const decoded = value.toString("utf8");
        if (!decoded.startsWith("cipher:")) throw new Error("bad ciphertext");
        return decoded.slice(7);
      },
    },
  };
  const module = { exports: {} };
  const require = (id) => id === "electron" ? electron : actualRequire(id);
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  return new module.exports.OutboxStore();
};

const identityA = "abcdef0123456789abcdef01";
const identityB = "1234567890abcdef12345678";
const message = Object.freeze({
  version: 1,
  id: "desktop:12345678-1234-4234-8234-123456789abc",
  threadId: "thread-a",
  text: "Queued text that must not be stored in plaintext",
  attachmentIds: ["att_one"],
  createdAt: 123,
  state: "pending",
});

test("outbox encrypts records, isolates identities, replaces by stable id, and clears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-outbox-test-"));
  try {
    const store = loadStore(directory);
    await store.put(identityA, message);
    const disk = await readFile(join(directory, "outbox.secure.json"), "utf8");
    assert.equal(disk.includes(message.text), false);
    assert.match(disk, /"encrypted"/);
    assert.deepEqual(await store.list(identityB), []);
    assert.deepEqual(await store.list(identityA), [message]);

    const updated = { ...message, state: "unknown", receiptId: "receipt-a" };
    await store.put(identityA, updated);
    assert.deepEqual(await store.list(identityA), [updated]);
    await store.remove(identityA, message.id);
    assert.deepEqual(await store.list(identityA), []);
    await assert.rejects(readFile(join(directory, "outbox.secure.json")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("outbox rejects unavailable encryption, malformed envelopes, and invalid records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-outbox-test-"));
  try {
    await assert.rejects(loadStore(directory, false).put(identityA, message), /outbox unavailable/);
    const store = loadStore(directory);
    await assert.rejects(store.put(identityA, { ...message, id: "bad" }), /invalid outbox record/);
    await writeFile(join(directory, "outbox.secure.json"), '{"version":1,"encrypted":"broken"}', { mode: 0o600 });
    await assert.rejects(store.list(identityA), /outbox unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
