import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/main/credential-store.ts", import.meta.url).pathname],
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
      encryptString(value) { return Buffer.from(`encrypted:${value}`, "utf8"); },
      decryptString(value) {
        const decoded = value.toString("utf8");
        if (!decoded.startsWith("encrypted:")) throw new Error("bad ciphertext");
        return decoded.slice(10);
      },
    },
  };
  const module = { exports: {} };
  const require = (id) => id === "electron" ? electron : actualRequire(id);
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  return new module.exports.CredentialStore();
};

const connection = {
  version: 1,
  baseUrl: "https://example.com",
  id: "abcdef0123456789abcdef01",
  token: "ha_dev_abcdef0123456789abcdef01_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
};

test("credential store persists only an encrypted envelope and round-trips a connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-credential-test-"));
  try {
    const store = loadStore(directory);
    await store.saveConnection(connection);
    const disk = await readFile(join(directory, "connection.secure.json"), "utf8");
    assert.equal(disk.includes(connection.token), false);
    assert.match(disk, /"encrypted"/);
    assert.deepEqual(await store.load(), { version: 1, connection });
    await store.delete();
    assert.equal(await store.load(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential store rejects unavailable encryption and malformed envelopes without plaintext fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-credential-test-"));
  try {
    const unavailable = loadStore(directory, false);
    await assert.rejects(unavailable.saveConnection(connection), /secure storage unavailable/i);
    const store = loadStore(directory);
    await writeFile(join(directory, "connection.secure.json"), '{"version":1,"encrypted":"not-valid"}', { mode: 0o600 });
    await assert.rejects(store.load(), /secure storage unavailable/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
