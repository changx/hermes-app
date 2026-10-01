import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/main/connection-service.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", external: ["electron"], write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopConnectionService } = module.exports;
const fixture = () => {
  const service = new DesktopConnectionService(() => {});
  const calls = [];
  const client = {
    threads: new Map([["a", { read_ref: 0 }], ["b", { read_ref: 0 }]]),
    async markRead(thread, ref) { calls.push([thread, ref]); this.threads.get(thread).read_ref = ref; },
  };
  service.client = client;
  service.selectedThreadId = "a";
  return { service, client, calls };
};

test("acknowledgement feedback and 1000 identical snapshots settle at one read request", async () => {
  const { service, client, calls } = fixture();
  client.markRead = async function(thread, ref) {
    calls.push([thread, ref]);
    this.threads.get(thread).read_ref = ref;
    // Mirrors synchronous subscriber publication from HermesClient.markRead.
    await service.markVisible(ref);
  };
  await service.markVisible(10);
  for (let i = 0; i < 1000; i++) await service.markVisible(10);
  await service.markVisible(9);
  assert.deepEqual(calls, [["a", 10]]);
  await service.markVisible(11);
  service.selectedThreadId = "b";
  await service.markVisible(10);
  assert.deepEqual(calls, [["a", 10], ["a", 11], ["b", 10]]);
});

test("duplicates racing an acknowledgement are suppressed; failures can retry", async () => {
  const { service, client, calls } = fixture();
  let rejectRequest;
  client.markRead = (thread, ref) => {
    calls.push([thread, ref]);
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  };
  const first = service.markVisible(10);
  await Promise.all(Array.from({ length: 100 }, () => service.markVisible(10)));
  assert.equal(calls.length, 1);
  rejectRequest(new Error("offline"));
  await first;
  client.markRead = async function(thread, ref) { calls.push([thread, ref]); this.threads.get(thread).read_ref = ref; };
  await service.markVisible(10);
  assert.equal(calls.length, 2);
});

test("a replacement connection is not blocked by an old pending read", async () => {
  const { service, client } = fixture();
  let finish;
  client.markRead = () => new Promise((resolve) => { finish = resolve; });
  const old = service.markVisible(10);
  const replacement = fixture();
  service.client = replacement.client;
  await service.markVisible(10);
  assert.deepEqual(replacement.calls, [["a", 10]]);
  finish();
  await old;
});

test("invalid refs and missing selection never issue reads", async () => {
  const { service, calls } = fixture();
  for (const ref of [0, -1, NaN, Infinity, 1.5]) await service.markVisible(ref);
  service.selectedThreadId = undefined;
  await service.markVisible(10);
  assert.equal(calls.length, 0);
});

test("renderer read effect keys on the visible ref rather than cloned message arrays", async () => {
  const source = await readFile(new URL("../src/renderer/shell.tsx", import.meta.url), "utf8");
  assert.match(source, /\[following, latestVisibleRef, snapshot.selectedThreadId, snapshot.connectionState\]/);
  assert.doesNotMatch(source, /\[following, snapshot.messages, snapshot.selectedThreadId\]/);
});
