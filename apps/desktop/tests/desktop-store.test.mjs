import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/renderer/desktop-store-core.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DesktopSnapshotStore } = module.exports;

const snapshot = (revision, label = "Offline") => ({
  revision,
  phase: "connected",
  connectionState: "suspended",
  connectionLabel: label,
  channels: [],
  threads: [],
  messages: [],
});

test("desktop external store keeps stable snapshots and releases bridge listeners", async () => {
  let bridgeListener;
  let subscriptions = 0;
  let removals = 0;
  const api = {
    getSnapshot: async () => snapshot(1),
    subscribe(listener) { subscriptions += 1; bridgeListener = listener; return () => { removals += 1; }; },
  };
  const store = new DesktopSnapshotStore(api);
  let firstNotices = 0;
  let secondNotices = 0;
  const removeFirst = store.subscribe(() => { firstNotices += 1; });
  const removeSecond = store.subscribe(() => { secondNotices += 1; });
  await Promise.resolve();
  assert.equal(subscriptions, 1);
  assert.equal(firstNotices, 1);
  assert.equal(secondNotices, 1);
  const stable = store.getSnapshot();
  assert.equal(store.getSnapshot(), stable);
  bridgeListener(snapshot(1, "duplicate"));
  assert.equal(store.getSnapshot(), stable);
  assert.equal(firstNotices, 1);
  bridgeListener(snapshot(2, "Online"));
  assert.notEqual(store.getSnapshot(), stable);
  assert.equal(firstNotices, 2);
  assert.equal(secondNotices, 2);
  removeFirst();
  assert.equal(removals, 0);
  removeSecond();
  assert.equal(removals, 1);
});
