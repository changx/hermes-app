import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const result = await build({ entryPoints: [new URL("../src/renderer/thread-navigation.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false });
const { threadWindow, orderedThreads } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const now = 1_800_000_000_000;
const row = (id, at, channelId = "a") => ({ id, title: id, channelId, lastMessageAt: at === undefined ? undefined : at / 1000, unreadCount: 0, running: false });
test("recent tree excludes older and unknown activity; newest first, exact cutoff included", () => {
  const rows = [row("old", now - 86_400_001), row("new", now), row("edge", now - 86_400_000), row("missing", undefined), row("other", now, "b")];
  assert.deepEqual(threadWindow(rows, "a", now).rows.map((x) => x.id), ["new", "edge"]);
  assert.equal(threadWindow(rows, "a", now).hasMore, true);
  assert.deepEqual(threadWindow(rows, "a", now, 1).rows.map((x) => x.id), ["new", "edge", "old", "missing"]);
  assert.equal(threadWindow(rows, "a", now, 1).hasMore, false);
});
test("large recent lists and older lists grow by at most 24 without duplicates", () => {
  const rows = Array.from({ length: 80 }, (_, i) => row(String(i), now - i));
  assert.equal(threadWindow(rows, "a", now).rows.length, 24);
  assert.equal(threadWindow(rows, "a", now, 1).rows.length, 48);
  assert.equal(threadWindow(rows, "a", now, 2).rows.length, 72);
  const last = threadWindow(rows, "a", now, 3);
  assert.equal(last.rows.length, 80);
  assert.equal(last.hasMore, false);
  assert.equal(new Set(last.rows.map((x) => x.id)).size, 80);
  const old = rows.map((x) => ({ ...x, lastMessageAt: (now - 90_000_000) / 1000 }));
  assert.equal(threadWindow(old, "a", now).rows.length, 0);
  assert.equal(threadWindow(old, "a", now, 1).rows.length, 24);
});
test("live activity reorders stably without mutating snapshot", () => {
  const rows = [row("z", now), row("a", now)];
  assert.deepEqual(orderedThreads(rows).map((x) => x.id), ["a", "z"]);
  assert.deepEqual(rows.map((x) => x.id), ["z", "a"]);
  assert.deepEqual(threadWindow([row("z", now + 1), row("a", now)], "a", now).rows.map((x) => x.id), ["z", "a"]);
});
test('all Running sessions remain ahead of recent idle sessions, including more than 24 old tasks', () => {
  const running = Array.from({length:30},(_,i)=>({...row(`running-${i}`,now-100_000_000-i),running:true,markers:['work']}));
  const idle = Array.from({length:40},(_,i)=>({...row(`idle-${i}`,now-i),markers:['work']}));
  const first=threadWindow([...idle,...running],'a',now);
  assert.equal(first.rows.length,54);assert.ok(first.rows.slice(0,30).every(item=>item.running));
  assert.deepEqual(first.rows.slice(0,30).map(item=>item.id),running.map(item=>item.id));
  assert.equal(threadWindow([...idle,...running],'a',now,0,{labels:['work'],noLabels:false}).rows.length,54);
});
